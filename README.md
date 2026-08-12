# Shopify Multi-ERP Connector

Scaffolded from Shopify's official Remix app template. This single file is the complete
documentation for this project — project status and how to run it, followed by the full product
spec, technical dev spec, and Milestone 0-1 build plan that guided the build. (These used to be
four separate files; consolidated here on 2026-08-11 so there's one place to look, not four.)

## Contents

- [Project status](#project-status)
- [What's not done yet, and why](#whats-not-done-yet-and-why)
- [Known documentation gaps](#known-documentation-gaps)
- [To actually run this](#to-actually-run-this)
- [Running the real-Postgres integration suite](#running-the-real-postgres-integration-suite)
- [Node version](#node-version)
- [Product Spec](#product-spec)
- [Development Spec](#development-spec)
- [Build Plan (Milestone 0-1 scoping)](#build-plan-milestone-0-1-scoping)

---

## Project status

**Done: Milestones 0-9, plus a post-Milestone-9 hardening pass.**

- Remix app scaffold on Postgres, OAuth install, embedded admin shell, mandatory GDPR webhooks,
  encrypted-credential storage (with key rotation), Billing API plumbing (Milestone 0)
- Canonical data model and the `ERPAdapter` contract (Milestone 1)
- The full 8-step onboarding wizard at `/app/connect`: pick ERP, connect, environment, field
  mapping, edge-case rules, backfill window, pre-flight check, go live (Milestones 2-3)
- Sync engine: `orders/create` webhook receiver, a BullMQ queue backed by Redis, and an in-process
  worker that pushes orders to the connected ERP once a connection has gone live, with DB-level
  dedup and per-resource ordering (Milestone 3)
- Reconciliation worker, activity log, and vendor-monitoring alerts (Milestone 4)
- Six ERP adapters, all built from vendor documentation and **none yet verified against a real
  account** — see decision D4 in the [Build Plan](#build-plan-milestone-0-1-scoping) and the
  `TODO(D4)` markers throughout each adapter. This is the single biggest open risk in the whole
  build:
  - NetSuite (OAuth 2.0) — Milestone 1
  - Acumatica (OAuth 2.0) — Milestone 5
  - Business Central (OAuth 2.0 / Azure AD) — Milestone 6
  - Sage Intacct (session-based XML gateway) — Milestone 9
  - Sage 300 (Basic Auth, self-hosted) — Milestone 9
  - Brightpearl (OAuth 2.0) — Milestone 9
- Parallel-run / cutover ("shadow sync") mode, so a merchant can compare ERP output against
  Shopify before going fully live (Milestone 7)
- Agency layer: multi-client dashboard with its own login (separate from Shopify's embedded
  session), mapping templates, white-label reports (Milestone 8)
- Post-Milestone-9 hardening pass (tracked as F1-F16 against an `erp-connector-fixes-spec.md`
  working doc that was never checked into this repo — see [Known documentation
  gaps](#known-documentation-gaps) below): SSRF guards on merchant-supplied ERP URLs, encryption
  key rotation, real GDPR data-request/redact handling (previously stubs), DB-level sync dedup
  proven under real concurrency, full pagination on the reconciliation job, and expanded test
  coverage (route-level auth tests for the API-key, agency-session, and internal-dashboard guards).
- 2026-08-12 hardening pass, from an independent code review of the areas above: Slack/email
  alert channels for `sync_failed`/`reconciliation_alert` (previously only reached agencies via a
  generic signed-JSON webhook or the in-app activity log — see `channelKind` on
  `WebhookSubscription`); billing usage recording wired into the worker (see the Pricing (D1) note
  below); a missing/invalid `REDIS_URL` no longer crashes the whole web process at boot, only the
  sync/reconciliation/webhook-delivery workers; and a job resumed mid-flight after an apparent
  process crash (status still `processing` on re-entry) is now dead-lettered for manual review
  instead of silently retried, since no adapter-side idempotency key exists yet to rule out a
  duplicate ERP push.

`npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass locally as of
this commit.

## What's not done yet, and why

- **Nothing has been exercised against a real ERP account, for any of the six adapters.** Every
  adapter, its OAuth/session flow, and its push/pull payload shapes are built from each vendor's
  documented API, not a live sandbox — see decision D4 in the [Build Plan](#build-plan-milestone-0-1-scoping)
  and the `TODO(D4)` comments in each adapter's client/transform/auth files. Until at least one
  adapter is proven against a real account, none of the six integrations should be treated as
  trustworthy end-to-end.
- **The sync worker runs in-process**, not as the separate Railway service the dev spec's
  architecture calls for, and processes jobs at global concurrency 1 (simplest correct way to keep
  same-order jobs in sequence without BullMQ Pro's job-groups feature) — a deliberate scope
  decision for now (see the Build Plan's Milestone 3 notes), not a rewrite to change later. As of
  the 2026-08-12 pass below, a missing/invalid `REDIS_URL` no longer crashes the whole web process
  at boot — it only disables sync/reconciliation/webhook-delivery, logging clearly instead.
- **Pricing (D1) is still a placeholder.** Billing defaults to test mode
  (`SHOPIFY_BILLING_TEST_MODE`) so step 8 won't attempt a real charge until real tiers/prices are
  decided. `recordOrderSyncUsage` is now wired into the worker and called after every successful
  push (`ORDER_SYNC_USAGE_PRICE_USD` env var, defaulting unset/0 so it stays a no-op until an
  operator sets a real price) — the plumbing is real, but per Milestone 9's own caveat pattern for
  the ERP adapters, it hasn't been exercised against a live store with an active usage subscription
  and should be smoke-tested before being trusted in production.
- The field-mapping UI is a plain text field per row, not an ERP-schema-aware dropdown.
- Reconciliation now pages through its full 7-day window rather than stopping at 250 orders (fixed
  2026-08-11), but that window is still fixed at 7 days; older discrepancies need a separate,
  less-frequent wider sweep that isn't built.

## Known documentation gaps

- The product spec, dev spec, and build plan used to be three separate files
  (`erp-connector-spec.md`, `erp-connector-dev-spec.md`, `erp-connector-build-plan.md`). They were
  briefly deleted from the repo in the post-M9 hardening commit (evidently unintentional — that
  same commit still edits `erp-connector-dev-spec.md`'s content before removing the file), restored
  from git history, and then folded into this single README on 2026-08-11 at the user's request.
  Code comments written before that date that cite e.g. "erp-connector-dev-spec.md §14" have been
  updated to point at this file's Development Spec section instead — the section numbers
  (§1-§17 for the dev spec, §1-§13 for the product spec, §1-§5 for the build plan) are unchanged,
  only the filename changed.
- `erp-connector-fixes-spec.md`, referenced by dozens of code comments as the source of the F1-F16
  hardening-pass items, was never actually committed to this repo (confirmed via `git log --all`).
  Those comments are accurate about *what* changed and *why*, but the spec document itself doesn't
  exist here to cross-reference — treat those references as historical context only.

## To actually run this

1. **Create the Shopify app** in the [Partner Dashboard](https://partners.shopify.com), or run
   `npm run config:link` if one already exists. This gets you a `client_id` for `shopify.app.toml`
   and the API key/secret for `.env`.
2. **Provision Postgres and Redis on Railway** and copy both connection strings.
3. Copy `.env.example` to `.env` and fill in `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
   `DATABASE_URL`, `REDIS_URL`, and `ENCRYPTION_MASTER_KEY` (generate with
   `openssl rand -base64 32`). **`REDIS_URL` is required, not optional** — the sync worker boots
   eagerly at server startup (`app/sync/worker.server.ts`, imported from `entry.server.tsx`) and
   the process crashes immediately without it.
4. Run migrations: `npx prisma migrate dev`.
5. `npm run dev` (this is `shopify app dev` — it'll prompt you to log in to Partners and pick or
   create a dev store the first time).

## Running the real-Postgres integration suite

`npm run test` (used above and in CI) never touches a real database. One suite needs one anyway —
`app/sync/queue.dedup.integration.test.ts` proves the `SyncJob` unique constraint actually blocks a
duplicate webhook under real concurrency, which a mocked test can't demonstrate. To run it locally:

```sh
docker compose -f docker-compose.test.yml up -d
DATABASE_URL="postgresql://postgres:postgres@localhost:55432/erp_test" npm run test:integration
```

This also runs in CI as a separate `test-integration` job (see `.github/workflows/ci.yml`), against
a Postgres service container rather than the compose file above.

## Node version

This machine had no Node install; `nvm` was installed to `~/.nvm` and Node 24 (LTS) set as
default. Run `nvm use` in new shells if it's not already active.

---

## Product Spec

### 1. Positioning statement

A Shopify-native app that connects to the major mid-market ERPs (NetSuite, Business Central, Acumatica, Sage) through one consistent, self-serve configuration experience, priced transparently, and scoped honestly to the standard 70% of order-to-cash flows so agencies keep the billable custom work. Lives inside the Shopify admin rather than being a separate portal to log into.

---

### 2. Competitive landscape

This is a more crowded space than the retention or accounting ideas, so it's worth being precise about who else is here and where each one is weak.

#### Celigo (integrator.io)
The most established player for Shopify-NetSuite specifically. It's the top-rated iPaaS on G2, with a decade-long Oracle partnership, 200+ prebuilt flows, AI-assisted error handling, and flat-rate pricing based on endpoints and flows rather than per transaction.
- **Weakness 1 — pricing**: While not the cheapest, you get what you pay for is the consistent theme in reviews; pricing may be exorbitant for small businesses, and tiers are Free/Professional/Premium/Enterprise with real cost jumps between them.
- **Weakness 2 — sync cadence**: Its default sync is batch-polling on a schedule, not continuous real-time, so buyers are told to confirm the cadence fits how fast their stock actually moves.
- **Weakness 3 — coverage depth**: Celigo's default Shopify app covers the essentials (orders, inventory, customers) well, but it's Patchworks that provisions entire order-to-cash sequences including credit memos, partial fulfillments, and multi-location logic more comprehensively out of the box.
- **Weakness 4 — manual gaps still exist**: one long-term user's honest complaint: some flows still require manual handling with no built-in control, so mistakes can slip through — i.e. it's not a fully closed loop even for an established, well-regarded tool.
- Single-ERP-strong (NetSuite), not built as a multi-ERP-from-one-UI product.

#### Patchworks
The closest thing to a direct multi-system competitor, positioned as Shopify-native. Its blueprint approach means faster time-to-value, often a matter of days, for entire order-to-cash sequences, though heavy customisation may still require Patchworks' own team.
- **Weakness 1 — pricing opacity**: Shopify's own App Store listing shows "Free to install" with billing only activating after a discussion with Patchworks — there is no published, self-serve price a merchant can see before talking to sales.
- **Weakness 2 — too much for smaller merchants**: Patchworks may not be suitable for very small businesses with minimal integration requirements, or those without a strong reliance on digital tooling, since its capabilities can feel excessive for simple setups.
- **Weakness 3 — cost as a stated limitation**: reviewers directly flag that the cost of the platform can be a limiting factor for small businesses, and that a more flexible pricing structure would help.
- Zero reviews on the Shopify App Store itself at time of research — it's sold almost entirely through partner-led enterprise deals, not discovered and self-installed.

#### DCKAP Integrator
Best fit for distributors that want a NetSuite connector built around distribution, connecting to Shopify, Magento, and BigCommerce from one dashboard, though it leans batch-first so buyers need to confirm the sync cadence matches their stock velocity.
- Same batch-vs-real-time weakness as Celigo's default.
- Distribution-specific framing, not a general mid-market multi-ERP product.

#### General iPaaS (Boomi, Jitterbit, Workato, SnapLogic)
Broad, enterprise-wide integration platforms that happen to support Shopify and ERPs as one of hundreds of possible connections, rather than being built for this specific pairing.
- Genuinely powerful and flexible, but that flexibility is the weakness for this use case: a merchant or agency has to build the Shopify-to-ERP flow themselves inside a general-purpose platform, rather than getting a pre-shaped, opinionated flow for this specific job.
- Pricing and implementation complexity scale with the platform's generality — you're paying for capability you don't need.

#### Native vendor connectors (Acumatica Cloud ERP app, Microsoft's Business Central Shopify Connector)
Both Acumatica and Microsoft ship their own free/low-cost native Shopify connectors directly.
- **Real strength**: genuinely real-time, bidirectional, and free or near-free to install, since the vendor built it themselves.
- **Weakness 1 — single-ERP only**: each is built for exactly one ERP, so an agency managing clients across Acumatica, Business Central, and NetSuite still has to learn and operate three completely different tools with three different UIs and mapping conventions.
- **Weakness 2 — unproven at the review level**: the Acumatica native app currently shows 0 reviews on the Shopify App Store, so real-world reliability at scale is unverified despite the real-time claim.
- **Weakness 3 — no agency layer**: these are single-store, single-vendor tools with no concept of managing several client instances from one place.

#### EDI/specialist connectors (TrueCommerce, In-Synch)
Focused on specific transaction types (EDI compliance, Magento-NetSuite specifically) — not directly competing for the general mid-market Shopify-ERP use case, but worth knowing they exist if a client's requirement turns out to be EDI-specific.

#### The whitespace this leaves
No player currently offers: **one consistent UI across the 4-6 ERPs that actually cover the mid-market, self-serve onboarding without a sales call, transparent published pricing, real-time sync as the default rather than an upsell, and a built-in agency multi-client layer.** Every existing option makes you trade off at least two of those five.

---

### 3. Differentiation strategy

Stated directly, mapped to the specific weaknesses above:

| Competitor weakness | Our answer |
|---|---|
| Pricing requires a sales call (Patchworks) or is exorbitant at small scale (Celigo) | Published, self-serve pricing visible before signup, tiered by order volume, no "talk to sales" gate |
| Batch-polling sync, not real-time by default (Celigo, DCKAP) | Real-time webhook-driven sync as the standard behaviour wherever the connected ERP's own API supports it, not a premium add-on — see the caveat below for the ERPs where this isn't fully achievable at launch |
| Single-ERP tools force agencies to learn N different UIs (native connectors) | One consistent mapping and dashboard UI regardless of which of the 4-6 ERPs a client uses |
| General iPaaS requires building the flow yourself (Boomi, Jitterbit, Workato) | Pre-built, opinionated flows per ERP out of the box; configuration, not construction |
| Too much platform for smaller merchants (Patchworks) | Scoped deliberately to the standard order-to-cash 70%, so a $500K/year merchant isn't buying enterprise iPaaS capability they'll never touch |
| No agency multi-client view exists anywhere in this list | Built in from Phase 3, not bolted on |
| Manual gaps still slip through even in mature tools (Celigo user complaint) | Reconciliation is a first-class, always-on feature, not an afterthought |

The honest positioning line: **not the deepest, most customisable platform (that's Celigo/Boomi's territory for genuine enterprise complexity), but the fastest to a trustworthy, transparent, real-time connection for the mid-market merchant or the agency serving several of them.**

**Honest caveat on the real-time claim**: "real-time by default" depends on what the connected ERP's own API actually allows, not just on this app's architecture. Per the adapter notes in the development spec (§4 there), NetSuite's webhook capability requires setup on the customer's own NetSuite instance before it's live, and Sage Intacct and Sage 300 have no native webhook support at all, so those connections run on scheduled polling regardless of what this app does. The always-on reconciliation job (§7.6) is what closes that gap for polling-based or webhook-pending connections — it should be marketed as the safety net, not hidden as an implementation detail. External copy (App Store listing, sales conversations) should say "real-time where the ERP supports it, reconciled continuously everywhere" rather than an unqualified "real-time by default" that the NetSuite and Sage adapters can't fully back up.

---

### 4. Target customer

- **Primary**: Shopify merchants doing roughly $1M–$20M in annual revenue, running one of the 4-6 supported ERPs, currently either quoted $20K-$150K for a custom/partner-led integration or limping along on manual CSV exports and spreadsheets.
- **Secondary**: agencies serving several clients in that revenue band, currently either subcontracting ERP integration work entirely or avoiding it because it doesn't fit their normal service model.
- **Explicitly not the target initially**: SAP/enterprise-tier merchants with heavy ERP customisation — that's Celigo/Boomi/partner-led territory and not worth competing for on day one.

---

### 5. Which ERPs to start with

1. **NetSuite** — largest install base among growing Shopify merchants
2. **Microsoft Dynamics 365 Business Central** — strong mid-market manufacturing/distribution presence, and Microsoft's own native connector proves the demand exists but leaves the multi-ERP and agency gaps open
3. **Acumatica** — cloud-native, friendliest API of the group, and its own native app's real-time claim with zero reviews suggests the market wants this but doesn't yet trust an option
4. **Sage (Intacct and/or 300)** — widely used among established SMBs; treat Intacct and 300 as two separate adapters since their APIs differ substantially
5. **Brightpearl** — already ecommerce-oriented, natural fit for Shopify-heavy merchants
6. **SAP Business One** — hold for a later phase; more expensive to build well due to data-model edge cases, and it pulls toward the enterprise segment we're deliberately not targeting first

Start with NetSuite, Business Central, and Acumatica for the v1 build — that covers the three most-requested systems and gives enough adapter variety to prove the canonical-model pattern holds up before adding Sage and Brightpearl.

---

### 6. Core architecture

One internal canonical data model (orders, inventory, customers, fulfillment, pricing, returns/credit memos) with a thin adapter per ERP translating to and from that ERP's native structure. Adding an ERP later means writing a new adapter against an already-proven model, not rebuilding the product.

Each adapter needs to independently handle:
- Authentication (OAuth where available, API key/token elsewhere)
- The ERP's native object model for orders, items, customers, and inventory
- Rate limits and API quotas specific to that ERP
- Sandbox/test environment support, since almost every mid-market ERP implementation goes through a staging phase before going live

---

### 7. Full functional spec

#### 7.1 Onboarding and setup — a step-by-step wizard, not a settings page

This is the single most important design decision in the whole product. Every competitor researched either requires a sales call (Patchworks), a partner-led implementation (Celigo, DCKAP for anything beyond the basics), or is a single-ERP tool with no real onboarding flow at all (native connectors). None of them are a genuine self-serve wizard. That's the gap this app should own.

The wizard, step by step:

1. **Pick your ERP.** One screen, logos for the supported ERPs, nothing else. Sets the whole rest of the flow.
2. **Connect.** OAuth where the ERP supports it (Business Central, NetSuite via SuiteTalk OAuth); credential/API-key entry with clear field labels and a link to "where do I find this" instructions where OAuth isn't available. A "Test Connection" button that has to succeed before the wizard lets the merchant continue — never let someone configure 40 field mappings and only then discover the credentials were wrong. For NetSuite specifically, this step should also check whether the customer's NetSuite instance has the SuiteScript webhook setup needed for real-time sync, and offer guided instructions to enable it, rather than silently falling back to polling with no explanation.
3. **Choose environment.** Sandbox/test instance first, or go straight to production. Default to sandbox with a clear one-line explanation of why, and a visible toggle to switch to production once they're confident.
4. **Field mapping, with defaults already filled in.** A paired-row list, not a drag-and-drop canvas — Shopify field on the left, a dropdown to select the matching ERP field on the right, with every common field pre-mapped based on that ERP's standard structure already selected. Rows are grouped into collapsible sections (Order, Customer, Product, Inventory) so a merchant isn't scrolling past every field an ERP like NetSuite exposes to find the handful that matter, with a search box for jumping straight to a specific one. Each row shows a live preview value pulled from one of the merchant's own recent orders next to the mapping, so they see real data rather than an abstract label. Anything unmapped that the ERP actually requires is shown in red at the top of the list before they can proceed, not discovered later as a failed sync. This deliberately avoids a drag-and-drop connector UI: that pattern suits a developer building an arbitrary integration flow, not the ops person this wizard is designed for, and it doesn't fit naturally into Shopify's own Polaris design system.
5. **Choose what happens with edge cases**, as plain yes/no or multiple-choice questions rather than technical settings: "If an order can't fully ship, what should happen?" / "If a customer doesn't exist yet in [ERP], should we create one automatically?" This is where backorder handling, guest-customer handling, and similar decisions get made in language a non-technical ops person can answer confidently.
6. **Pick a historical backfill window** (none / last 30 days / last 90 days / custom range), so the merchant isn't stuck syncing forward only from install day.
7. **Pre-flight check.** Before the first live sync, the app runs a dry validation pass and shows a plain-English summary: "12 of your last 50 orders would sync cleanly. 2 would need attention because [reason]." This is the moment that earns trust — showing the merchant real evidence it works against their real data before anything goes live.
8. **Go live.** One clear action to flip from sandbox/dry-run to live sync, with a confirmation step so it's a deliberate decision, not an accidental toggle.

Design principles behind the wizard:
- **No step requires developer knowledge.** The target user completing this alone is an ops or finance person, not an engineer — this is explicitly what separates it from "just another iPaaS platform" that assumes someone technical is building the flow.
- **Every step can be left and resumed.** Nobody should have to complete the whole thing in one sitting; progress saves automatically.
- **The agency version of the wizard is the same wizard**, just launched from the agency dashboard against a specific client's store, with the option to start from a saved mapping template instead of step 4's blank defaults.

#### 7.2 Order flow (Shopify → ERP)
- Standard orders, near-real-time via webhooks
- Partial fulfillments
- Partial refunds and full refunds, each producing the correct ERP document type (credit memo vs. reversed invoice vs. cancelled unshipped order, matching the governed cases an ERP actually expects — refunded orders should follow governed cases: closing and refunding unprocessed sales orders, deleting unconfirmed shipments, creating credit memos for shipped or invoiced orders, or reversing released invoices, so that every refund is mirrored by the correct ERP document)
- Gift cards
- Discounts and promotions, mapped to how the ERP represents them (not just netted into a lower line total, which breaks margin reporting)
- Draft orders / manually created orders
- Multi-currency orders, using the actual conversion rate applied at the time of the transaction, not a daily average
- Order edits made after initial sync (address changes, added/removed line items before fulfillment)

#### 7.3 Inventory flow (ERP → Shopify)
- Real-time stock level updates on every change where the connected ERP's API supports push/webhook-driven updates; scheduled polling with a short interval as the fallback for ERPs that don't (Sage Intacct, Sage 300 — see the caveat in §3), rather than a blanket claim of real-time everywhere
- Multi-location / multi-warehouse mapping, with Shopify locations mapped explicitly to ERP warehouses
- Safety stock / buffer quantity handling, so Shopify doesn't show sellable stock the ERP is holding back
- Backorder handling — what happens to a Shopify order when the ERP shows negative or zero stock, configurable per merchant preference (allow oversell vs. block)
- Kitting / bundles / assemblies — many ERPs treat a bundle as a single manufactured item with component consumption; this needs explicit mapping logic rather than assuming a 1:1 SKU relationship
- Serial and lot number tracking passthrough, for merchants in regulated or traceable-goods categories

#### 7.4 Customer flow (bidirectional)
- New customer creation reflected in both directions
- B2B / wholesale customers with company records, not just individual contacts
- Customer-specific price lists and net-terms status pulled from the ERP and reflected in what that customer sees on the storefront
- Guest checkout handling — configurable whether guest orders create a full ERP customer record or route to a default account

#### 7.5 Product/catalog flow
- Product and variant sync, ERP as source of truth or Shopify as source of truth, configurable per merchant (some manufacturers manage the catalog in the ERP, some ecommerce-first brands manage it in Shopify)
- Custom/ERP-specific fields, not just the standard set, mapped through the same field-mapping UI used for orders

#### 7.6 Reconciliation and monitoring
- **Always-on reconciliation job**: compares Shopify's order record against what actually landed in the ERP, on a short interval, not just nightly, since Shopify only retries failed webhooks for up to 48 hours, so a job that catches what a webhook silently dropped is required, not optional. This job is also the primary integrity mechanism, not just a backstop, for any adapter running on scheduled polling rather than webhooks — see §3.
- **Discrepancy flagging with explanation**: when something doesn't match, state why (timing lag, currency conversion difference, a webhook that failed and was caught by reconciliation) rather than just showing a red flag
- **Sync activity log**: plain-language view of what synced, when, and what failed, usable by an ops person, not just a developer
- **Alerting**: configurable notifications (email, Slack) when a sync failure or unresolved discrepancy crosses a threshold

#### 7.7 Extensibility (this is what lets agencies do their billable 30%)
- **Webhook/event hooks for custom logic**: expose events (order received, inventory updated, sync failed) that an agency's own script or middleware can subscribe to, so custom business logic (loyalty rules, custom tax handling, non-standard pricing) can be layered on without forking the core adapter
- **API access to the canonical model**: so an agency building something bespoke on top isn't fighting the ERP's native API directly, but working against the same clean internal model the app itself uses

#### 7.8 Agency layer
- **Multi-client connected dashboard**: sync health, reconciliation status, and alerts across every client instance from one login
- **Reusable mapping templates**: save a completed field mapping for a given ERP and reuse it as the starting point for the next client on the same ERP
- **White-label reporting**: agency branding on exported reconciliation/sync reports (see the `agencies.branding_config` field and the `GET /api/agency/reports/:shopId` endpoint in the development spec)
- **Role-based access**: agency staff get scoped access to client instances without needing the client's own login credentials — backed by the `agency_users` and `agency_user_client_access` tables in the development spec, so individual staff members (not just the agency as a whole) can be added, removed, and scoped to specific clients

---

### 8. Non-functional requirements

- **Uptime target**: match or exceed the 99.9% uptime standard competitors like Patchworks already advertise — this is table stakes for anything touching order and inventory data, not a differentiator
- **Security**: OAuth wherever the ERP supports it, encrypted credential storage, no plaintext API keys ever logged
- **Data retention and compliance**: clear policy on how long historical sync data is retained, and GDPR-appropriate handling for any customer PII passing through the sync
- **Rate limit handling**: each adapter needs its own backoff/retry logic tuned to that specific ERP's API limits, since a NetSuite rate-limit response and an Acumatica one behave differently
- **Adapter versioning**: ERPs update their APIs; each adapter needs a versioning and deprecation strategy so a NetSuite API change doesn't silently break every merchant's sync overnight
- **Testing**: each adapter needs its own automated test suite against that ERP's sandbox, run on a schedule, so an ERP-side API change is caught before a merchant reports broken orders

---

### 9. Pricing strategy

The clearest differentiation lever, given how consistently competitors are criticised for opacity:

- **Published, self-serve pricing** visible on the app listing and website — no "request a demo" gate before a merchant can see a number
- **Tiered by order volume**, not by which ERP is connected — the value to the merchant doesn't change based on which system it happens to be, so don't price as if it does
- **Agency multi-client add-on**: small per-connected-store fee for the dashboard, reusable templates, and white-label reporting
- **No implementation fee for standard flows** — if a merchant fits the standard 70%, self-serve onboarding should get them live without paying for guided setup; guided/assisted onboarding can be a paid option for those who want it, not a mandatory gate

---

### 10. Support model

- **Self-serve tier (default)**: documentation, in-app help within the wizard itself (contextual explanations at each step, not a separate help centre), and standard ticket-based support.
- **Assisted onboarding (paid add-on)**: for merchants who want a guided setup call rather than the self-serve wizard alone — this exists deliberately as an optional upsell, not a mandatory gate, which is itself part of the differentiation against Patchworks' sales-call-first model.
- **Agency support**: agencies get a direct escalation path distinct from individual merchant support, since an issue affecting one client's sync is often relevant context for the agency managing several.
- **Migration support**: merchants moving off an existing connector (Celigo, a custom build, manual processes) are flagged during onboarding so they get the parallel-run/cutover flow rather than a standard first-time setup — see the development spec for the technical detail.

### 11. Success metrics

What "working" looks like, to check against honestly rather than just shipping and hoping:

- **Time to first successful live sync**, from install to a merchant completing wizard step 8 — this is the number that validates or invalidates the entire self-serve wizard premise
- **Reconciliation discrepancy rate** across live connections — the product's core trust claim is a low, explained discrepancy rate, so this should be tracked and defended, not just built and forgotten
- **Support ticket volume per adapter**, to catch a specific ERP's integration quietly becoming harder to use than the others
- **Self-serve completion rate** (merchants who complete the wizard without needing the paid assisted-onboarding add-on) — a declining rate here is an early signal the wizard itself needs simplifying before adding more ERPs

### 12. Risks and honest challenges

- **This is a harder build than the retention or accounting apps.** Each ERP adapter is a genuine, ongoing engineering commitment, not a one-time integration. Budget for adapter maintenance as an ongoing cost, not a sunk one.
- **Established players have real depth** (Celigo's decade of NetSuite-specific refinement, Patchworks' order-to-cash sequence coverage). Competing on breadth of edge-case handling from day one isn't realistic — the differentiation has to come from pricing transparency, real-time-by-default, and the multi-ERP-plus-agency layer nobody else combines, not from out-featuring Celigo on NetSuite specifically in year one.
- **Native vendor connectors are free or near-free.** For a merchant on Acumatica alone with no agency involvement, the free native app may be genuinely good enough — the multi-ERP and agency angle is what justifies paying for this instead.
- **Sandbox/testing infrastructure is a real cost** that's easy to underestimate — building it properly (rather than skipping it to ship faster) is precisely what earns trust against "just another connector" scepticism.
- **The "real-time by default" claim is only fully true for a subset of the roadmap.** NetSuite requires customer-side webhook setup and both Sage adapters are polling-only (see §3). This is a genuine gap against the marketing claim, not just a technical footnote, and should be scoped honestly in App Store copy and sales conversations rather than discovered by a merchant after go-live.

---

### 13. Suggested build order

1. **NetSuite adapter v1**: canonical model, field-mapping UI, order/inventory/customer sync, sandbox support, real-time webhooks (including the guided SuiteScript webhook setup flagged in §7.1 step 2). This is the highest-demand ERP, so validate the whole approach against the toughest, most established competitive field (Celigo) first — a deliberate trade-off against building the easier, friendlier-API adapter (Acumatica) first, made explicitly here and in the development spec's milestone rationale.
2. **Reconciliation and alerting**, before calling v1 done — this is the trust-earning feature, not an add-on.
3. **Acumatica adapter**, proving the canonical-model-plus-adapter pattern holds for a second, differently-shaped ERP without a rebuild. Its friendlier API means this adapter should move faster than NetSuite did, banking back some of the schedule spent validating the harder case first.
4. **Business Central adapter**, third proof point, plus the extensibility hooks (webhook/API access) so agencies can start layering custom logic.
5. **Agency multi-client dashboard and reusable mapping templates**, once there are enough single-store paying installs across at least two ERPs to justify it.
6. **Sage and Brightpearl adapters**, expanding coverage once the core product and agency layer are proven.
7. **SAP Business One**, only if there's clear demand pulling toward the enterprise segment — otherwise stay disciplined about the mid-market focus that's the actual differentiation.

---

## Development Spec

Companion to the Product Spec above (positioning, competitive analysis, feature list, wizard UX). This document is the technical build spec: architecture, data model, adapter contract, APIs, infrastructure, and testing.

---

### 1. Tech stack recommendation

- **App framework**: Remix, following Shopify's own recommended app template (Node.js/TypeScript, embedded in the Shopify admin via App Bridge). This is the path of least resistance for a Shopify-native app and keeps the wizard UI inside the merchant's normal admin rather than a separate portal, which is itself part of the differentiation.
- **Primary datastore**: PostgreSQL. Relational fits the data here well (connections, mappings, sync records with clear foreign-key relationships), and reconciliation queries benefit from real joins rather than a document store.
- **Job queue**: Redis + BullMQ (or equivalent) for the sync engine. Every order-sync, inventory-pull, and reconciliation pass is a queued, retryable job, not a synchronous request.
- **Background workers**: a separate worker process from the web app, so a slow ERP API response never blocks the merchant-facing admin UI.
- **Hosting**: Railway. The web app and worker deploy as two separate services within one Railway project (built from a Dockerfile for full control, or Railway's default Nixpacks builder if that's simpler to maintain), connected over Railway's private networking to Railway's managed Postgres and Redis plugins. This gets the web app + worker + Postgres + Redis shape from §2 running as one project with no separate infra to provision, and each service scales independently as sync volume grows.
- **Error tracking**: Sentry or equivalent, with correlation IDs threading through every sync job so a failure can be traced end to end.
- **Encryption**: ERP credentials encrypted at rest via a managed KMS key, never logged in plaintext at any layer.

---

### 2. System architecture (high level)

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

### 3. Canonical data model

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

### 4. Adapter contract

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
| Sage Intacct | Sender ID/password + session-based API | Limited native webhook support, likely polling-based | Treat as a separate adapter from Sage 300 — different API entirely. **Built, Milestone 9** (`app/adapters/sageintacct/`): the Sender ID/password are *this app's* Partner Program credentials (env vars, shared across every merchant), not merchant-entered — each merchant separately authorizes that Sender ID inside their own Intacct company and gives us a Company ID/User ID/User Password. No OAuth-style redirect exists for this flow; see the adapter's auth.server.ts for how the wizard's redirect/callback route still accommodates that. |
| Sage 300 | API key-based | No native webhooks, polling required | **Built, Milestone 9** (`app/adapters/sage300/`): more precisely HTTP Basic Auth, not a distinct API-key header (confirmed via research, not just guessed). Sage 300 is typically self-hosted per customer rather than vendor-hosted — the merchant supplies their own (already-internet-reachable) Web API server URL, which is a materially different trust/reachability model than every other adapter here. |
| Brightpearl | OAuth 2.0 | REST API with webhook support | Already ecommerce-shaped data model, likely the easiest translation to canonical model. **Built, Milestone 9** (`app/adapters/brightpearl/`): the OAuth client_id/secret belong to *this app* (registered once in Brightpearl's Developer Area), not to each merchant's own instance — a merchant only enters their Brightpearl account code, closer to a Shopify-style "install this app" OAuth model than NetSuite/Acumatica/Business Central's per-merchant Integration records. |

---

### 5. Database schema (Postgres)

```sql
-- Shopify store record
CREATE TABLE shops (
  id UUID PRIMARY KEY,
  shopify_domain TEXT UNIQUE NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL,
  plan_tier TEXT NOT NULL,
  agency_invite_code TEXT UNIQUE,           -- added in Milestone 8: neither spec says how an
                                             -- agency actually gets linked to a client shop --
                                             -- filled in as a merchant-generated, single-use code
                                             -- (app/models/agency.server.ts) the merchant shares
                                             -- with their agency, who redeems it from their own
                                             -- dashboard (§7.8 assumes a link already exists)
  agency_invite_code_used_at TIMESTAMPTZ
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
  went_live_at TIMESTAMPTZ,            -- added in Milestone 3: distinct from 'active' status
                                        -- (Milestone 2, OAuth succeeded) -- this is wizard step 8
                                        -- specifically; the sync worker only pushes to the ERP
                                        -- once this is set, keeping steps 1-7 free per product
                                        -- spec §9
  shadow_mode_started_at TIMESTAMPTZ   -- added in Milestone 7 (§14 below): set without
                                        -- went_live_at means shadow-syncing (orders transformed
                                        -- and logged, never pushed) during a parallel run; both
                                        -- set means live
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
  completed_at TIMESTAMPTZ,
  mode TEXT NOT NULL DEFAULT 'live'   -- added in Milestone 7: 'live' | 'shadow' -- set once at
                                       -- enqueue time from the connection's state (§14)
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
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,        -- scrypt, not the invited_at/accepted_at invite-link flow
                                       -- this table originally specified. Built instead as
                                       -- self-serve signup + password login (agency.signup.tsx /
                                       -- agency.login.tsx / app/utils/agencyAuth.server.ts) --
                                       -- the simpler of two reasonable readings of §7.8, which
                                       -- doesn't specify how an agency account is created in the
                                       -- first place. KNOWN GAP: only the 'owner' role can be
                                       -- created this way today -- there's no UI yet for an owner
                                       -- to invite 'admin'/'staff' teammates onto an existing
                                       -- agency, though the role column and
                                       -- agency_user_client_access scoping both already support it.
  role TEXT NOT NULL,                 -- 'owner' | 'admin' | 'staff' -- 'owner'/'admin' see every linked client; 'staff' is scoped via agency_user_client_access
  created_at TIMESTAMPTZ NOT NULL
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
  created_from_connection_id UUID REFERENCES erp_connections(id),
  created_at TIMESTAMPTZ NOT NULL
);
```

---

### 6. Internal API endpoints (wizard + dashboard frontend)

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

Built in Milestone 8 as server-rendered `agency.*` Remix routes under cookie-session auth
(`app/utils/agencyAuth.server.ts`), not a literal `/api/agency/*` JSON API -- this whole section
was always this doc's rough interface sketch rather than a literal route table (the wizard steps
above were built the same way, as `/app/connect/...` Remix routes). Two differences worth calling
out specifically: reports export as CSV (`?format=csv`), not PDF -- no PDF library was added for
this -- and there's no `POST /api/agency/users` staff-invite equivalent yet (see the `agency_users`
comment in §5): only self-serve owner signup exists in v1.

---

### 7. Sync engine behaviour

- **Idempotency**: every job is keyed by a combination of Shopify resource ID + event type, so a webhook redelivery (Shopify can and does redeliver) never double-processes.
- **Retry policy**: exponential backoff, capped attempts (e.g. 5), then moved to `dead_letter` status and surfaced in the activity log for manual review rather than retried forever.
- **Ordering**: order-related jobs for the same order ID process in sequence, not in parallel, to avoid a refund processing before its original order sync completes.
- **Fallback for ERPs without webhook support** (Sage Intacct, Sage 300), or where webhook setup hasn't yet been completed on the customer's own instance (NetSuite, until the guided SuiteScript webhook setup in the wizard's connect step is done): scheduled polling with a delta cursor (last-successful-sync timestamp) rather than full-table pulls every time. The reconciliation job (§8) is the primary integrity backstop for these connections, not an optional extra — see the product spec's caveat on the "real-time by default" claim (§3 there).

---

### 8. Reconciliation job design

Runs on a short interval (e.g. every 15 minutes), not just nightly:

1. Pull Shopify's order list for the relevant window via the Admin API.
2. For each order, look up its corresponding `sync_jobs` record and confirmed `erp_document_ref`.
3. If no confirmed record exists past a reasonable time threshold, flag as `discrepancy` with reason `sync_not_confirmed`.
4. If a confirmed record exists, compare Shopify's order total against the ERP-reported total (pulled via the adapter's `getOrderStatus`); flag mismatches with a specific reason (`currency_conversion`, `tax_mismatch`, `partial_refund_pending`) rather than a generic "doesn't match."
5. Write results to `reconciliation_records` and `activity_log`; trigger alerts for anything crossing a configurable threshold (e.g. more than 2% of orders in `discrepancy` state over a rolling 24 hours).

---

### 9. Security and compliance

- Shopify OAuth for app install, session tokens via App Bridge for the embedded admin UI — standard Shopify app requirements.
- Mandatory Shopify GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) implemented from day one — required for public App Store listing.
- ERP credentials encrypted at rest via KMS-managed key; decrypted only in-memory at the moment of an API call, never logged.
- Per-ERP OAuth used wherever available (Business Central, Acumatica, Brightpearl) in preference to long-lived static API keys.
- Principle of least privilege: request only the Shopify Admin API scopes and ERP API permissions actually needed for the connected features.

---

### 10. Testing strategy

- **Unit tests** for every adapter's canonical-model transform functions (Shopify to canonical, and canonical to ERP-native and back), independent of any live API call.
- **Contract tests against ERP sandboxes**, run on a schedule (e.g. nightly CI job), to catch an upstream ERP API change before a merchant reports a broken sync.
- **End-to-end wizard test** (Playwright) simulating the full onboarding flow against a test Shopify store and each ERP's sandbox.
- **Load testing** the sync engine for burst order volume (flash-sale scenarios), since queue backpressure under load is a realistic failure mode for any merchant running a promotion.

---

### 11. Adapter versioning and maintenance

- Each adapter is versioned independently; a feature flag per connection allows rolling out an adapter update to a subset of connections before a full rollout.
- A deprecation policy (e.g. minimum 60 days notice) for dropping support for an old ERP API version, communicated to affected merchants/agencies in advance.
- Ongoing maintenance budget should be planned per adapter, not just initial build time — this is flagged as a real risk in the product spec and it's worth restating here at the technical level: an ERP adapter is a standing commitment, not a one-off deliverable.

---

### 12. ERP vendor partner and marketplace programs — do we actually need them?

This is worth resolving explicitly, because getting it wrong either delays launch by months for no reason, or means missing a real distribution channel later.

**The important distinction**: building against an ERP's public API (OAuth or token-based, registered per customer in their own ERP instance) is different from listing on that ERP's own marketplace as a certified partner. This app only needs the former to ship.

- **NetSuite**: Distributing a packaged, NetSuite-side "SuiteApp" through SuiteApp.com requires SuiteCloud Developer Network (SDN) membership, and admission is selective — NetSuite's own partners describe certification as taking several weeks and unable to start until an application and full documentation are complete, adding 4-8 weeks on top of development time. **None of this is required** for an external Shopify app calling NetSuite's REST/SuiteTalk APIs using a token registered directly in a customer's own NetSuite account — that's how most third-party connectors, including established ones, actually operate.
- **Microsoft (Business Central)**: Listing on Microsoft AppSource requires joining the ISV Connect program, ongoing app recertification, and a revenue-share arrangement with Microsoft (10-20% depending on tier) on marketplace transactions. Again, not required to simply call the Business Central OData/REST API against a customer's own tenant using Azure AD OAuth.
- **Acumatica**: Similarly has an application-based ISV program for marketplace listing, separate from simply calling its REST API against a customer's own instance.
- **Sage, Brightpearl**: ~~No evidence of a mandatory certification gate for basic API access; check each at build time, but expect the same pattern.~~ **Correction, Milestone 9**: this prediction was wrong for these two specifically, in a way that matters for basic API access itself, not just marketplace listing. Both Sage Intacct and Brightpearl authenticate third-party apps using credentials that belong to *this app* (not to each merchant's own instance, unlike NetSuite/Acumatica/Business Central's per-merchant Integration records) — a Sage Intacct **Sender ID/password issued via Sage's Partner Program**, and a Brightpearl **OAuth client_id/secret issued by registering as a developer/app in Brightpearl's Developer Area**. Neither of these is a growth-channel/marketplace-listing decision that can be deferred -- **no merchant can connect either ERP at all until these are obtained** (`SAGE_INTACCT_SENDER_ID`/`SAGE_INTACCT_SENDER_PASSWORD` and `BRIGHTPEARL_CLIENT_ID`/`BRIGHTPEARL_CLIENT_SECRET` in `.env.example` are currently unset in every environment, including production). Sage 300 is unaffected -- it authenticates with per-merchant Basic Auth credentials against their own self-hosted server, no partner registration needed.

**Recommendation**: build and ship v1 against public APIs only, with no ERP vendor *marketplace* certification pursued initially. Validate demand through the Shopify App Store and direct outreach first. Treat each ERP's own marketplace listing as a *later, optional* growth channel, budgeted separately, since each comes with its own timeline (weeks of certification) and, in Microsoft's case, an ongoing revenue share that changes the unit economics for any sale sourced through AppSource specifically. This is still true for NetSuite/Business Central/Acumatica/Sage 300 -- but for Sage Intacct and Brightpearl specifically, registering for baseline API *access* (not marketplace listing) is now a blocking prerequisite, in the same spirit as decision D4's NetSuite sandbox lead-time risk in the Build Plan below: start it as early as possible, in parallel with other work, since it depends on an external party's process rather than engineering time.

---

### 13. Billing implementation

- Use the **Shopify Billing API** (`AppSubscription` / usage-based billing) rather than an external payment processor — this keeps billing inside the merchant's normal Shopify invoice, which is expected behaviour for a Shopify App Store listing and avoids a second checkout flow.
- Tiered pricing by order volume maps to Shopify's usage-based billing capped amount model: set a capped monthly amount per tier, with usage records submitted as orders sync.
- Agency multi-client add-on bills as a separate recurring `AppSubscription` line, scoped to the agency's own linking account rather than any individual client shop.
- Free sandbox/dry-run usage (wizard steps 1-7) should not trigger billing at all — the merchant should only start being charged once they hit step 8 and go live, matching the "no implementation fee for standard flows" pricing principle in the product spec.

---

### 14. Migration and cutover from an existing connector

A meaningful share of the realistic early customer base will already have something in place (a legacy custom build, an existing Celigo/DCKAP setup they're unhappy with, or a spreadsheet-and-manual-entry process). Cutover needs explicit handling, not just first-time setup:

- **Parallel-run mode**: allow the new connection to sync in a "shadow" state (writing to a staging area or dry-run log only, not actually pushing to the ERP) while an existing connector is still live, so the merchant can compare outputs before switching over.
- **Cutover checklist**: a clear "disable old connector, activate this one" moment, with the reconciliation job immediately running against the cutover window to catch anything that fell in the gap between the two systems.
- **Duplicate-prevention**: since the old connector may have already pushed some orders to the ERP, the pre-flight check (wizard step 7) should detect and flag orders that already have an ERP document reference, rather than creating duplicates.

---

### 15. Observability and monitoring (vendor-side, not just merchant-facing)

Distinct from the merchant-facing activity log and alerting already specified — this is what the team building and running the app needs to watch:

- **Sync success rate per adapter**, tracked separately per ERP, since a dip specific to one adapter (e.g. after an ERP-side API change) needs to be caught before it's a widespread complaint.
- **Queue depth and processing latency**, to catch backpressure building up before it becomes a merchant-visible delay.
- **Per-ERP API error rate and rate-limit hit frequency**, since this is the earliest signal of an upstream API change or a merchant on a plan tier with a lower rate limit than expected.
- **Dead-letter queue size**, reviewed regularly — a growing dead-letter queue for one adapter is the leading indicator of a systemic problem with that ERP's integration, not just isolated one-off failures.

---

### 16. Disaster recovery and data integrity

- **Postgres backups**: Railway's Postgres supports point-in-time recovery via pgBackRest (weekly full + daily incremental backups, ~4-week restore window), but it's an opt-in setting per service, not on by default — enabling PITR on the production Postgres service is a launch-blocking checklist item, not an assumption. Given this database is the source of truth for what has and hasn't synced, data loss here risks duplicate or missing ERP documents, not just inconvenience.
- **Queue durability**: confirm the Railway Redis service's persistence (AOF or RDB volume) is enabled rather than assuming the default configuration protects against data loss on restart, so an in-flight job isn't silently lost on a worker or Redis restart.
- **Replay capability**: ability to manually re-trigger a sync for a specific order or a specific time window, needed both for disaster recovery and for the ordinary case of fixing a merchant's mapping error after the fact without a full re-onboarding.

---

### 17. Technical build milestones

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
| 9 | Sage (Intacct and 300 as separate adapters) + Brightpearl — **done** |
| 10 | SAP Business One, only if demand clearly justifies the added complexity |
| — | Ongoing, not gated to a milestone: evaluate ERP marketplace certification (NetSuite SDN, Microsoft AppSource, Acumatica ISV) as a distribution channel once core product-market fit is proven |

---

## Build Plan (Milestone 0-1 scoping)

Companion to the Product Spec and Development Spec above. This document scopes the first two milestones from the dev spec's build table (§17) into concrete tasks, rough effort, dependencies, and the decisions that need answers before (or during) the build — not just a restatement of milestone scope.

**Effort estimates are engineer-days of focused work**, not calendar time — calendar time depends on team size and how much runs in parallel, which is itself an open question below.

---

### 1. Decisions to resolve now — these block real work, not just polish

| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | **Pricing tiers**: actual order-volume breakpoints and dollar amounts per tier | Blocks the Shopify Billing API `AppSubscription` implementation in M0 — "tiered by order volume" (product spec §9) has no numbers attached anywhere in either spec | Resolve before M0's billing tasks start; doesn't block the rest of M0, so sequence billing work last within the milestone if this drags |
| D2 | **Encryption approach for credentials at rest** | Both specs say "encrypted at rest via a managed KMS key" — written when AWS ECS was still an option. Railway has no native KMS service, so this needs a concrete answer: (a) use a cloud KMS (AWS KMS or GCP Cloud KMS) purely for key management while the app itself stays on Railway, or (b) envelope-encrypt with a master key held in Railway's encrypted service variables. Blocks `access_token_encrypted` (M0) and `credentials_encrypted` (M1) | (a) if there's any appetite for a second cloud account — a real KMS gives key rotation and audit logging that a Railway env var can't. (b) is faster to ship and fine for v1 if rotation isn't urgent yet, but should be treated as a named tech-debt item, not a permanent answer |
| D3 | **NetSuite auth method**: Token-Based Auth (TBA) vs OAuth 2.0 | ~~Originally recommended TBA~~ **Superseded 2026-08-10**: NetSuite's 2027.1 release (early 2027, ~6 months out) blocks creating *new* TBA integrations entirely (existing ones keep working, but nothing new can be built on it from that point). Starting this adapter on TBA now would mean redoing the auth layer within months. | **Use OAuth 2.0 Authorization Code Grant** instead — matches the interactive "Connect" step already designed into the wizard (product spec §7.1 step 2: merchant logs into their NetSuite and consents, same shape as the Shopify OAuth install itself). Exact endpoint domains in the adapter are built from documented patterns and still need verification against a real sandbox once D4 is resolved. |
| D4 | **NetSuite sandbox/developer account access** | Not a decision so much as a lead-time risk — the adapter can't be built or tested against anything real without one, and getting one arranged can take longer than the engineering work itself | **Start this today, in parallel with M0** — don't wait for M0 to finish. Treat it as the single most schedule-sensitive item in this plan |
| D5 | **Team size / velocity** | Every estimate below is in engineer-days; calendar time depends entirely on how many people are on this and how much M0 and the NetSuite sandbox request can overlap | Flagged here so the estimates below aren't misread as calendar weeks — see §4 for a sequencing suggestion either way |

---

### 2. Milestone 0 — Shopify app scaffold, OAuth, embedded shell, Billing

Per dev spec §17: *"Shopify app scaffold (Remix template), OAuth install, embedded admin shell, Shopify Billing API integration (sandbox usage free, billing starts at go-live)."*

| Task | Effort | Depends on | Notes |
|---|---|---|---|
| Repo + Railway project setup: git init, Railway project with a Postgres service, base Remix + TypeScript + ESLint/Prettier config | 1 day | — | Establishes the hosting shape from dev spec §1 |
| Shopify Partner app registration + dev store | 0.5 day | — | Can happen same day as repo setup, different person if available |
| OAuth install flow (`@shopify/shopify-app-remix` + Prisma session storage on Postgres) | 2 days | Repo setup | The actual "installable app" milestone — nothing else works until this does |
| `shops` table + migration (id, shopify_domain, access_token_encrypted, installed_at, plan_tier) | 0.5 day | OAuth flow scaffolding | Small, but blocks storing a real install |
| Encryption utility for `access_token_encrypted` | 1–2 days | **D2 decision** | Reused as-is for `credentials_encrypted` in M1, so worth doing properly once here |
| Embedded admin shell: App Bridge + Polaris nav shell + placeholder Home route | 1.5 days | OAuth flow | This is the shell the wizard (M2) mounts into later — no wizard content yet |
| Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) | 1 day | OAuth flow | Required for App Store listing eligibility; the dev spec calls this out as "day one," and it's easy to let it slide to later milestones since it's not customer-visible — don't let it slide |
| Shopify Billing API integration: `AppSubscription` creation, capped usage-based billing config, usage-record submission stub | 2–3 days | **D1 decision** | The "sandbox free, billing starts at go-live" gate itself can only be a stub here — the actual trigger point (wizard step 8) doesn't exist until M3 |
| Basic CI (lint, typecheck, build on PR) | 0.5 day | Repo setup | Not named in the dev spec's milestone table but worth calling out explicitly rather than letting it happen ad hoc |
| Deploy to a Railway staging environment | 0.5 day | Everything above | First real "it's live somewhere" checkpoint |

**Milestone 0 total: ~11–13 engineer-days.**

---

### 3. Milestone 1 — Canonical model, Postgres schema, NetSuite adapter v1

Per dev spec §17 (updated for the NetSuite-first build order): *"Canonical data model + Postgres schema + NetSuite adapter (auth via TBA/OAuth, test connection, push order, pull inventory, guided SuiteScript webhook setup)."*

| Task | Effort | Depends on | Notes |
|---|---|---|---|
| Canonical data model as a shared TypeScript package (all types from dev spec §3, including the address/discount/tax/shipping/gift-card/fulfillment types, plus the adapter contract's supporting types from §4) | 1.5 days | — | Pure types, can start immediately, in parallel with M0 |
| Postgres migrations: `erp_connections`, `field_mappings`, `edge_case_rules` | 1 day | M0's Postgres setup | `sync_jobs`, `reconciliation_records`, `activity_log` are needed by M3/M4, not M1 — recommend creating tables when the milestone that uses them lands, not speculatively upfront |
| Apply the M0 encryption utility to `erp_connections.credentials_encrypted` | 0.5 day | M0 encryption utility | Should be nearly free if M0 built it generically |
| NetSuite auth research spike + `authenticate()` / `testConnection()` implementation | 2–3 days | **D3 decision**, D4 (sandbox access) | The first real integration work; NetSuite's auth quirks are the most common source of adapter delay per the dev spec's own risk notes |
| `getDefaultFieldMappings()` — NetSuite sales order object research + default mapping template | 2 days | Sandbox access | Needs real NetSuite object shapes, not just docs |
| `pushOrder()` | 3–4 days | Canonical model, field mappings | The single meatiest piece — mapping line items, discounts, tax lines, shipping lines, and gift cards onto a NetSuite SalesOrder |
| `pullInventoryDeltas()` | 2 days | Sandbox access | Simpler than order push; a good second task to parallelize against `pushOrder()` if there are two engineers |
| `getRateLimitPolicy()` + backoff handling | 1 day | — | Small but easy to skip; NetSuite's rate-limit behavior is called out in dev spec §4 as adapter-specific |
| Guided SuiteScript webhook setup instructions (the check + guided instructions flagged in product spec §7.1 step 2) | 1–2 days | `authenticate()` | Straddles M1 (capability check) and M2 (wizard UI) — build the check here, wire it into the wizard step when M2 starts |
| Unit tests for NetSuite canonical-model transform functions (both directions) | 2 days | `pushOrder()`, `pullInventoryDeltas()` | Per dev spec §10, independent of any live API call |
| First live contract-test smoke check against the NetSuite sandbox | 1 day | Sandbox access | Not the full scheduled CI job from §10 yet — just proof the adapter talks to a real instance before calling M1 done |

**Milestone 1 total: ~16–19 engineer-days**, not counting D4's lead time, which should already be running in parallel.

---

### 4. Suggested sequencing

- **Day 1**: kick off the NetSuite sandbox request (D4) and start the canonical data model package — neither depends on anything else being done first.
- **M0 and the early, sandbox-independent parts of M1** (canonical model, migrations, auth research spike) can run in parallel if there are two engineers; a single engineer should do M0 first since M1's adapter work is largely blocked on sandbox access arriving anyway.
- Resolve D1 (pricing) and D2 (encryption approach) before their respective tasks come up in the table above — neither blocks the start of M0, but both block finishing it.
- Don't start `pushOrder()` until the field-mapping default template exists — building against guessed NetSuite field shapes is the likely source of rework the dev spec's risk section warns about.

### 5. Explicitly out of scope for M0–M1

Called out so it's clear what "done" does and doesn't include at the end of these two milestones:
- Any wizard UI beyond the empty admin shell (steps 1–8 are M2/M3)
- The sync engine, job queue, or webhook receiver (M3)
- Reconciliation, activity log UI, or monitoring dashboards (M4)
- Any adapter other than NetSuite (Acumatica is M5)
- Agency features of any kind (M8)

---

*Total for M0+M1 combined: ~27–32 engineer-days, before D1/D2/D3 decisions or D4's lead time are factored into calendar schedule.*
