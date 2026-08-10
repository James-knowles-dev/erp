# Shopify Multi-ERP Connector — Development Spec

Companion to `erp-connector-spec.md` (positioning, competitive analysis, feature list, wizard UX). This document is the technical build spec: architecture, data model, adapter contract, APIs, infrastructure, and testing.

---

## 1. Tech stack recommendation

- **App framework**: Remix, following Shopify's own recommended app template (Node.js/TypeScript, embedded in the Shopify admin via App Bridge). This is the path of least resistance for a Shopify-native app and keeps the wizard UI inside the merchant's normal admin rather than a separate portal, which is itself part of the differentiation.
- **Primary datastore**: PostgreSQL. Relational fits the data here well (connections, mappings, sync records with clear foreign-key relationships), and reconciliation queries benefit from real joins rather than a document store.
- **Job queue**: Redis + BullMQ (or equivalent) for the sync engine. Every order-sync, inventory-pull, and reconciliation pass is a queued, retryable job, not a synchronous request.
- **Background workers**: a separate worker process from the web app, so a slow ERP API response never blocks the merchant-facing admin UI.
- **Hosting**: Railway. The web app and worker deploy as two separate services within one Railway project (built from a Dockerfile for full control, or Railway's default Nixpacks builder if that's simpler to maintain), connected over Railway's private networking to Railway's managed Postgres and Redis plugins. This gets the web app + worker + Postgres + Redis shape from §2 running as one project with no separate infra to provision, and each service scales independently as sync volume grows.
- **Error tracking**: Sentry or equivalent, with correlation IDs threading through every sync job so a failure can be traced end to end.
- **Encryption**: ERP credentials encrypted at rest via a managed KMS key, never logged in plaintext at any layer.

---

## 2. System architecture (high level)

```
Shopify Store
   |  (webhooks: orders/create, orders/updated, refunds/create, etc.)
   v
Webhook Receiver (Remix route)
   | verifies HMAC, enqueues job
   v
Job Queue (Redis/BullMQ)
   |
   v
Sync Worker
   | transforms Shopify payload -> Canonical Model
   | applies merchant's field mapping + edge-case rules
   v
ERP Adapter (NetSuite / Acumatica / Business Central / Sage / Brightpearl)
   | pushes to ERP API, returns ERP document reference
   v
Postgres (sync_jobs, reconciliation_records, activity_log updated)

Separately, on a schedule:

ERP Adapter -- pulls inventory deltas --> Canonical Model --> Shopify Admin API (inventory update)

Reconciliation Worker (runs every N minutes)
   compares Shopify order data against sync_jobs/ERP confirmation records
   flags discrepancies -> activity_log + alerting
```

Each ERP adapter is a self-contained module implementing a common interface (Section 4) — the sync worker and reconciliation worker never talk to an ERP directly, only through that interface.

---

## 3. Canonical data model

These are the shapes every adapter must translate to and from. Kept deliberately close to how Shopify represents things, since Shopify is the one constant across every deployment.

```typescript
interface CanonicalOrder {
  id: string;                    // Shopify order ID
  shopId: string;
  createdAt: string;
  currency: string;
  exchangeRateAtTransaction?: number;
  customer: CanonicalCustomer;
  billingAddress: CanonicalAddress;
  shippingAddress: CanonicalAddress;
  lineItems: CanonicalLineItem[];
  discounts: CanonicalDiscount[];
  taxLines: CanonicalTaxLine[];
  shippingLines: CanonicalShippingLine[];
  giftCards: CanonicalGiftCard[];
  financialStatus: 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'voided';
  fulfillmentStatus: 'unfulfilled' | 'partial' | 'fulfilled';
  fulfillments: CanonicalFulfillment[];
  isB2B: boolean;
  companyId?: string;            // for B2B/wholesale customers
}

interface CanonicalLineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  isBundle: boolean;
  bundleComponents?: { sku: string; quantity: number }[];
  taxable: boolean;
  fulfillableQuantity: number;
  fulfilledQuantity: number;
}

interface CanonicalAddress {
  name?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode?: string;
  countryCode: string;
  zip: string;
  phone?: string;
}

interface CanonicalDiscount {
  code?: string;
  type: 'percentage' | 'fixed_amount' | 'free_shipping';
  value: number;
  appliesTo: 'order' | 'line_item' | 'shipping';
  targetLineItemSkus?: string[];
}

interface CanonicalTaxLine {
  title: string;
  rate: number;
  amount: number;
  jurisdiction?: string;
}

interface CanonicalShippingLine {
  title: string;
  amount: number;
  carrierService?: string;
}

interface CanonicalGiftCard {
  code: string;
  amountUsed: number;
}

interface CanonicalFulfillment {
  id: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';
  lineItems: { sku: string; quantity: number }[];
  trackingNumber?: string;
  shippedAt?: string;
}

interface CanonicalRefund {
  orderId: string;
  refundId: string;
  lineItems: { sku: string; quantity: number; amount: number }[];
  reason?: string;
  targetErpDocumentType: 'credit_memo' | 'reversed_invoice' | 'cancelled_order';
  // resolved by the adapter based on the order's ERP-side state at refund time
  originalErpDocumentId: string;
  // The ERP-side document id being credited/reversed/cancelled. Added during Milestone 1 --
  // without it an adapter has no way to know which ERP record a refund applies to. The sync
  // worker (Milestone 3) resolves this from sync_jobs.erp_document_ref before calling pushRefund().
}

interface CanonicalCustomer {
  id: string;
  email: string;
  isGuest: boolean;
  companyName?: string;
  netTermsDays?: number;
  priceListId?: string;
  tags: string[];               // used for routing rules (e.g. tag -> ERP customer ID)
}

interface CanonicalInventoryLevel {
  sku: string;
  locationId: string;           // Shopify location
  erpWarehouseId: string;       // mapped ERP warehouse
  available: number;
  safetyStockBuffer: number;
  lastUpdated: string;
}

interface CanonicalProduct {
  sku: string;
  title: string;
  variantOf?: string;
  customFields: Record<string, string | number>;
}
```

---

## 4. Adapter contract

Every ERP adapter implements this interface. This is the piece of engineering that determines whether "add another ERP later" is actually cheap.

```typescript
interface ERPAdapter {
  // Connection
  authenticate(credentials: ERPCredentials): Promise<ConnectionResult>;
  testConnection(): Promise<{ success: boolean; message?: string }>;

  // Mapping
  getDefaultFieldMappings(): FieldMappingTemplate;
  validateMapping(mapping: FieldMapping[]): ValidationIssue[];

  // Orders
  pushOrder(order: CanonicalOrder, mapping: FieldMapping[]): Promise<ERPDocumentRef>;
  pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef>;
  getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus>;

  // Inventory
  pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]>;
  supportsInventoryWebhooks(): boolean;   // if true, register a push subscription instead of polling

  // Customers
  pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef>;
  findCustomer(email: string): Promise<ERPDocumentRef | null>;

  // Products
  pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]>;

  // Rate limiting (adapter-specific backoff strategy)
  getRateLimitPolicy(): RateLimitPolicy;
}
```

Supporting types referenced above:

```typescript
interface ERPCredentials {
  authType: 'oauth2' | 'api_key' | 'token_based' | 'session';
  values: Record<string, string>;   // shape varies per adapter; encrypted at rest before this ever hits an adapter
}

interface ConnectionResult {
  success: boolean;
  erpInstanceId?: string;
  message?: string;
}

interface FieldMapping {
  shopifyField: string;
  erpField: string;
  transformRule?: string;
  isRequired: boolean;
}

interface FieldMappingTemplate {
  entityType: 'order' | 'customer' | 'product' | 'inventory';
  mappings: FieldMapping[];
}

interface ValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

interface ERPDocumentRef {
  documentType: string;      // e.g. 'sales_order', 'invoice', 'credit_memo'
  documentId: string;
  documentUrl?: string;      // deep link into the ERP UI, where available
}

interface ERPOrderStatus {
  erpDocumentRef: ERPDocumentRef;
  status: string;            // ERP-native status string, adapter-specific
  total: number;
  lastUpdated: string;
}

interface RateLimitPolicy {
  requestsPerWindow: number;
  windowSeconds: number;
  backoffStrategy: 'exponential' | 'fixed';
}
```

Adapter-specific notes to build against:

| ERP | Auth | Real-time capability | Notes |
|---|---|---|---|
| NetSuite | OAuth 2.0 Authorization Code Grant (TBA ruled out -- blocked for new integrations from NetSuite's 2027.1 release, see build-plan decision D3) | SuiteScript-based webhooks possible but require setup on the NetSuite side | Most mature ecosystem to reference (Celigo, FarApp docs) for expected object shapes |
| Business Central | Azure AD OAuth 2.0 | Native webhook/change-tracking support via OData | Microsoft's own connector proves the API supports real-time; build against the same endpoints |
| Acumatica | OAuth 2.0 | REST API, generally the friendliest of the group, webhook support for order events | Friendliest API of the group — would be the lowest-risk *first* adapter on engineering merits alone, but the product spec's build order (§13 there) puts NetSuite first instead, to validate the canonical model against the toughest, highest-demand competitive case immediately. Expect to bank schedule margin back here once this adapter is up second. |
| Sage Intacct | Sender ID/password + session-based API | Limited native webhook support, likely polling-based | Treat as a separate adapter from Sage 300 — different API entirely |
| Sage 300 | API key-based | No native webhooks, polling required | |
| Brightpearl | OAuth 2.0 | REST API with webhook support | Already ecommerce-shaped data model, likely the easiest translation to canonical model |

---

## 5. Database schema (Postgres)

```sql
-- Shopify store record
CREATE TABLE shops (
  id UUID PRIMARY KEY,
  shopify_domain TEXT UNIQUE NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL,
  plan_tier TEXT NOT NULL
);

-- One ERP connection per shop (a shop could theoretically connect more than one, though v1 assumes one active connection)
CREATE TABLE erp_connections (
  id UUID PRIMARY KEY,
  shop_id UUID REFERENCES shops(id),
  erp_type TEXT NOT NULL,             -- 'netsuite' | 'acumatica' | 'business_central' | 'sage_intacct' | 'sage_300' | 'brightpearl'
  environment TEXT NOT NULL,          -- 'sandbox' | 'production'
  credentials_encrypted TEXT,         -- nullable: a connection exists in 'pending' status (wizard
                                       -- step 1) before step 2 collects any credentials
  status TEXT NOT NULL,               -- 'pending' | 'active' | 'error' | 'disabled'
  connected_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  backfill_window TEXT,                -- added in Milestone 3: 'none' | '30d' | '90d' | custom ISO
                                        -- range -- §6 lists a PUT .../backfill-window endpoint but
                                        -- the original schema had nowhere to persist its value
  went_live_at TIMESTAMPTZ             -- added in Milestone 3: distinct from 'active' status
                                        -- (Milestone 2, OAuth succeeded) -- this is wizard step 8
                                        -- specifically; the sync worker only pushes to the ERP
                                        -- once this is set, keeping steps 1-7 free per product
                                        -- spec §9
);

CREATE TABLE field_mappings (
  id UUID PRIMARY KEY,
  connection_id UUID REFERENCES erp_connections(id),
  shopify_field TEXT NOT NULL,
  erp_field TEXT NOT NULL,
  transform_rule TEXT,                -- optional, e.g. a currency conversion or lookup rule
  is_required BOOLEAN DEFAULT FALSE
);

CREATE TABLE edge_case_rules (
  id UUID PRIMARY KEY,
  connection_id UUID REFERENCES erp_connections(id),
  rule_key TEXT NOT NULL,             -- e.g. 'backorder_behavior', 'guest_customer_handling'
  rule_value TEXT NOT NULL
);

CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY,
  connection_id UUID REFERENCES erp_connections(id),
  entity_type TEXT NOT NULL,          -- 'order' | 'refund' | 'inventory' | 'customer' | 'product'
  direction TEXT NOT NULL,            -- 'shopify_to_erp' | 'erp_to_shopify'
  shopify_reference_id TEXT,
  erp_document_ref TEXT,
  status TEXT NOT NULL,               -- 'queued' | 'processing' | 'success' | 'failed' | 'dead_letter'
  attempts INT DEFAULT 0,
  last_error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE reconciliation_records (
  id UUID PRIMARY KEY,
  connection_id UUID REFERENCES erp_connections(id),
  shopify_order_id TEXT NOT NULL,
  shopify_total NUMERIC,
  erp_total NUMERIC,
  status TEXT NOT NULL,               -- 'matched' | 'discrepancy' | 'pending'
  discrepancy_reason TEXT,
  checked_at TIMESTAMPTZ
);

CREATE TABLE activity_log (
  id UUID PRIMARY KEY,
  connection_id UUID REFERENCES erp_connections(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,             -- 'info' | 'warning' | 'error'
  occurred_at TIMESTAMPTZ
);

-- Agency layer
CREATE TABLE agencies (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  branding_config JSONB              -- logo, colours for white-label reports
);

CREATE TABLE agency_client_links (
  id UUID PRIMARY KEY,
  agency_id UUID REFERENCES agencies(id),
  shop_id UUID REFERENCES shops(id),
  role TEXT NOT NULL                  -- 'admin' | 'viewer' (the agency's own access level on this client, unrelated to which staff member is acting)
);

-- Individual agency staff members, distinct from agency_client_links (which links the agency as a whole to a client)
CREATE TABLE agency_users (
  id UUID PRIMARY KEY,
  agency_id UUID REFERENCES agencies(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,                 -- 'owner' | 'admin' | 'staff' -- 'owner'/'admin' see every linked client; 'staff' is scoped via agency_user_client_access
  invited_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

-- Per-client scoping for 'staff'-role agency_users; absence of a row means no access for that user to that client
CREATE TABLE agency_user_client_access (
  id UUID PRIMARY KEY,
  agency_user_id UUID REFERENCES agency_users(id),
  agency_client_link_id UUID REFERENCES agency_client_links(id)
);

CREATE TABLE mapping_templates (
  id UUID PRIMARY KEY,
  agency_id UUID REFERENCES agencies(id),
  erp_type TEXT NOT NULL,
  template JSONB NOT NULL,
  created_from_connection_id UUID REFERENCES erp_connections(id)
);
```

---

## 6. Internal API endpoints (wizard + dashboard frontend)

The mapping UI (step 4) is a Polaris `ResourceList` or `IndexTable`, not a custom canvas: one row per Shopify field, grouped by entity type with collapsible section headers, a `Select` or searchable `Combobox` per row for the ERP field choice, and a small preview column populated by the endpoint below. This keeps the whole wizard consistent with Shopify's own admin components rather than introducing a bespoke drag-and-drop interaction that would need its own accessibility and mobile handling built from scratch.

```
POST   /api/erp-connections                    # step 1-2: create connection, submit credentials
POST   /api/erp-connections/:id/test            # step 2: test connection button
PUT    /api/erp-connections/:id/environment     # step 3: sandbox vs production
GET    /api/erp-connections/:id/default-mappings
PUT    /api/erp-connections/:id/mappings        # step 4
GET    /api/erp-connections/:id/mappings/preview?sampleOrderId=   # step 4: live preview value per mapped field
PUT    /api/erp-connections/:id/edge-case-rules # step 5
PUT    /api/erp-connections/:id/backfill-window # step 6
POST   /api/erp-connections/:id/preflight       # step 7: dry-run check
POST   /api/erp-connections/:id/activate        # step 8: go live

GET    /api/sync-activity?connectionId=
GET    /api/reconciliation?connectionId=&status=discrepancy

# Agency
GET    /api/agency/clients
POST   /api/agency/clients/:shopId/link
GET    /api/agency/mapping-templates?erpType=
POST   /api/agency/mapping-templates
GET    /api/agency/reports/:shopId?format=pdf         # white-label reconciliation/sync report, branded via agencies.branding_config
GET    /api/agency/users                              # list agency_users (staff)
POST   /api/agency/users                               # invite a staff member, sets role
PUT    /api/agency/users/:id/client-access             # set which clients a 'staff'-role user can see (agency_user_client_access)
```

---

## 7. Sync engine behaviour

- **Idempotency**: every job is keyed by a combination of Shopify resource ID + event type, so a webhook redelivery (Shopify can and does redeliver) never double-processes.
- **Retry policy**: exponential backoff, capped attempts (e.g. 5), then moved to `dead_letter` status and surfaced in the activity log for manual review rather than retried forever.
- **Ordering**: order-related jobs for the same order ID process in sequence, not in parallel, to avoid a refund processing before its original order sync completes.
- **Fallback for ERPs without webhook support** (Sage Intacct, Sage 300), or where webhook setup hasn't yet been completed on the customer's own instance (NetSuite, until the guided SuiteScript webhook setup in the wizard's connect step is done): scheduled polling with a delta cursor (last-successful-sync timestamp) rather than full-table pulls every time. The reconciliation job (§8) is the primary integrity backstop for these connections, not an optional extra — see the product spec's caveat on the "real-time by default" claim (§3 there).

---

## 8. Reconciliation job design

Runs on a short interval (e.g. every 15 minutes), not just nightly:

1. Pull Shopify's order list for the relevant window via the Admin API.
2. For each order, look up its corresponding `sync_jobs` record and confirmed `erp_document_ref`.
3. If no confirmed record exists past a reasonable time threshold, flag as `discrepancy` with reason `sync_not_confirmed`.
4. If a confirmed record exists, compare Shopify's order total against the ERP-reported total (pulled via the adapter's `getOrderStatus`); flag mismatches with a specific reason (`currency_conversion`, `tax_mismatch`, `partial_refund_pending`) rather than a generic "doesn't match."
5. Write results to `reconciliation_records` and `activity_log`; trigger alerts for anything crossing a configurable threshold (e.g. more than 2% of orders in `discrepancy` state over a rolling 24 hours).

---

## 9. Security and compliance

- Shopify OAuth for app install, session tokens via App Bridge for the embedded admin UI — standard Shopify app requirements.
- Mandatory Shopify GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) implemented from day one — required for public App Store listing.
- ERP credentials encrypted at rest via KMS-managed key; decrypted only in-memory at the moment of an API call, never logged.
- Per-ERP OAuth used wherever available (Business Central, Acumatica, Brightpearl) in preference to long-lived static API keys.
- Principle of least privilege: request only the Shopify Admin API scopes and ERP API permissions actually needed for the connected features.

---

## 10. Testing strategy

- **Unit tests** for every adapter's canonical-model transform functions (Shopify to canonical, and canonical to ERP-native and back), independent of any live API call.
- **Contract tests against ERP sandboxes**, run on a schedule (e.g. nightly CI job), to catch an upstream ERP API change before a merchant reports a broken sync.
- **End-to-end wizard test** (Playwright) simulating the full onboarding flow against a test Shopify store and each ERP's sandbox.
- **Load testing** the sync engine for burst order volume (flash-sale scenarios), since queue backpressure under load is a realistic failure mode for any merchant running a promotion.

---

## 11. Adapter versioning and maintenance

- Each adapter is versioned independently; a feature flag per connection allows rolling out an adapter update to a subset of connections before a full rollout.
- A deprecation policy (e.g. minimum 60 days notice) for dropping support for an old ERP API version, communicated to affected merchants/agencies in advance.
- Ongoing maintenance budget should be planned per adapter, not just initial build time — this is flagged as a real risk in the product spec and it's worth restating here at the technical level: an ERP adapter is a standing commitment, not a one-off deliverable.

---

## 12. ERP vendor partner and marketplace programs — do we actually need them?

This is worth resolving explicitly, because getting it wrong either delays launch by months for no reason, or means missing a real distribution channel later.

**The important distinction**: building against an ERP's public API (OAuth or token-based, registered per customer in their own ERP instance) is different from listing on that ERP's own marketplace as a certified partner. This app only needs the former to ship.

- **NetSuite**: Distributing a packaged, NetSuite-side "SuiteApp" through SuiteApp.com requires SuiteCloud Developer Network (SDN) membership, and admission is selective — NetSuite's own partners describe certification as taking several weeks and unable to start until an application and full documentation are complete, adding 4-8 weeks on top of development time. **None of this is required** for an external Shopify app calling NetSuite's REST/SuiteTalk APIs using a token registered directly in a customer's own NetSuite account — that's how most third-party connectors, including established ones, actually operate.
- **Microsoft (Business Central)**: Listing on Microsoft AppSource requires joining the ISV Connect program, ongoing app recertification, and a revenue-share arrangement with Microsoft (10-20% depending on tier) on marketplace transactions. Again, not required to simply call the Business Central OData/REST API against a customer's own tenant using Azure AD OAuth.
- **Acumatica**: Similarly has an application-based ISV program for marketplace listing, separate from simply calling its REST API against a customer's own instance.
- **Sage, Brightpearl**: No evidence of a mandatory certification gate for basic API access; check each at build time, but expect the same pattern.

**Recommendation**: build and ship v1 against public APIs only, with no ERP vendor certification pursued initially. Validate demand through the Shopify App Store and direct outreach first. Treat each ERP's own marketplace listing as a *later, optional* growth channel, budgeted separately, since each comes with its own timeline (weeks of certification) and, in Microsoft's case, an ongoing revenue share that changes the unit economics for any sale sourced through AppSource specifically.

---

## 13. Billing implementation

- Use the **Shopify Billing API** (`AppSubscription` / usage-based billing) rather than an external payment processor — this keeps billing inside the merchant's normal Shopify invoice, which is expected behaviour for a Shopify App Store listing and avoids a second checkout flow.
- Tiered pricing by order volume maps to Shopify's usage-based billing capped amount model: set a capped monthly amount per tier, with usage records submitted as orders sync.
- Agency multi-client add-on bills as a separate recurring `AppSubscription` line, scoped to the agency's own linking account rather than any individual client shop.
- Free sandbox/dry-run usage (wizard steps 1-7) should not trigger billing at all — the merchant should only start being charged once they hit step 8 and go live, matching the "no implementation fee for standard flows" pricing principle in the product spec.

---

## 14. Migration and cutover from an existing connector

A meaningful share of the realistic early customer base will already have something in place (a legacy custom build, an existing Celigo/DCKAP setup they're unhappy with, or a spreadsheet-and-manual-entry process). Cutover needs explicit handling, not just first-time setup:

- **Parallel-run mode**: allow the new connection to sync in a "shadow" state (writing to a staging area or dry-run log only, not actually pushing to the ERP) while an existing connector is still live, so the merchant can compare outputs before switching over.
- **Cutover checklist**: a clear "disable old connector, activate this one" moment, with the reconciliation job immediately running against the cutover window to catch anything that fell in the gap between the two systems.
- **Duplicate-prevention**: since the old connector may have already pushed some orders to the ERP, the pre-flight check (wizard step 7) should detect and flag orders that already have an ERP document reference, rather than creating duplicates.

---

## 15. Observability and monitoring (vendor-side, not just merchant-facing)

Distinct from the merchant-facing activity log and alerting already specified — this is what the team building and running the app needs to watch:

- **Sync success rate per adapter**, tracked separately per ERP, since a dip specific to one adapter (e.g. after an ERP-side API change) needs to be caught before it's a widespread complaint.
- **Queue depth and processing latency**, to catch backpressure building up before it becomes a merchant-visible delay.
- **Per-ERP API error rate and rate-limit hit frequency**, since this is the earliest signal of an upstream API change or a merchant on a plan tier with a lower rate limit than expected.
- **Dead-letter queue size**, reviewed regularly — a growing dead-letter queue for one adapter is the leading indicator of a systemic problem with that ERP's integration, not just isolated one-off failures.

---

## 16. Disaster recovery and data integrity

- **Postgres backups**: Railway's Postgres supports point-in-time recovery via pgBackRest (weekly full + daily incremental backups, ~4-week restore window), but it's an opt-in setting per service, not on by default — enabling PITR on the production Postgres service is a launch-blocking checklist item, not an assumption. Given this database is the source of truth for what has and hasn't synced, data loss here risks duplicate or missing ERP documents, not just inconvenience.
- **Queue durability**: confirm the Railway Redis service's persistence (AOF or RDB volume) is enabled rather than assuming the default configuration protects against data loss on restart, so an in-flight job isn't silently lost on a worker or Redis restart.
- **Replay capability**: ability to manually re-trigger a sync for a specific order or a specific time window, needed both for disaster recovery and for the ordinary case of fixing a merchant's mapping error after the fact without a full re-onboarding.

---

## 17. Technical build milestones

Updated to include billing integration and cutover support as explicit items, not implied work. Adapter order matches the product spec's build order (§13 there): NetSuite ships first despite being the harder adapter, to validate the canonical model against the highest-demand ERP and the toughest competitive case (Celigo) immediately, rather than de-risking the build with the friendliest API first.

| Milestone | Scope |
|---|---|
| 0 | Shopify app scaffold (Remix template), OAuth install, embedded admin shell, Shopify Billing API integration (sandbox usage free, billing starts at go-live) |
| 1 | Canonical data model + Postgres schema + NetSuite adapter (auth via TBA/OAuth, test connection, push order, pull inventory, guided SuiteScript webhook setup) |
| 2 | Wizard steps 1-4 (ERP select, connect, environment, field mapping with NetSuite defaults) |
| 3 | Sync engine (queue, webhook receiver, job processor) + wizard steps 5-8 (edge-case rules, backfill, preflight, go-live), including duplicate-detection in the pre-flight check |
| 4 | Reconciliation worker + activity log UI + vendor-side monitoring dashboard (sync success rate, queue depth, dead-letter size) |
| 5 | Second adapter (Acumatica) — friendliest API in the group, so this is where the team should expect to bank back schedule margin after the harder NetSuite build, proving the canonical model and wizard hold for a differently-shaped ERP |
| 6 | Third adapter (Business Central) + extensibility hooks (webhook/API access for agency custom logic) |
| 7 | Parallel-run/cutover mode, for merchants migrating off an existing connector |
| 8 | Agency dashboard: multi-client view, mapping templates, white-label reports, role-scoped staff access (`agency_users` / `agency_user_client_access`) |
| 9 | Sage (Intacct and 300 as separate adapters) + Brightpearl |
| 10 | SAP Business One, only if demand clearly justifies the added complexity |
| — | Ongoing, not gated to a milestone: evaluate ERP marketplace certification (NetSuite SDN, Microsoft AppSource, Acumatica ISV) as a distribution channel once core product-market fit is proven |
