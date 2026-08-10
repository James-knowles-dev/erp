# Shopify Multi-ERP Connector — Full Product Spec

## 1. Positioning statement

A Shopify-native app that connects to the major mid-market ERPs (NetSuite, Business Central, Acumatica, Sage) through one consistent, self-serve configuration experience, priced transparently, and scoped honestly to the standard 70% of order-to-cash flows so agencies keep the billable custom work. Lives inside the Shopify admin rather than being a separate portal to log into.

---

## 2. Competitive landscape

This is a more crowded space than the retention or accounting ideas, so it's worth being precise about who else is here and where each one is weak.

### Celigo (integrator.io)
The most established player for Shopify-NetSuite specifically. It's the top-rated iPaaS on G2, with a decade-long Oracle partnership, 200+ prebuilt flows, AI-assisted error handling, and flat-rate pricing based on endpoints and flows rather than per transaction.
- **Weakness 1 — pricing**: While not the cheapest, you get what you pay for is the consistent theme in reviews; pricing may be exorbitant for small businesses, and tiers are Free/Professional/Premium/Enterprise with real cost jumps between them.
- **Weakness 2 — sync cadence**: Its default sync is batch-polling on a schedule, not continuous real-time, so buyers are told to confirm the cadence fits how fast their stock actually moves.
- **Weakness 3 — coverage depth**: Celigo's default Shopify app covers the essentials (orders, inventory, customers) well, but it's Patchworks that provisions entire order-to-cash sequences including credit memos, partial fulfillments, and multi-location logic more comprehensively out of the box.
- **Weakness 4 — manual gaps still exist**: one long-term user's honest complaint: some flows still require manual handling with no built-in control, so mistakes can slip through — i.e. it's not a fully closed loop even for an established, well-regarded tool.
- Single-ERP-strong (NetSuite), not built as a multi-ERP-from-one-UI product.

### Patchworks
The closest thing to a direct multi-system competitor, positioned as Shopify-native. Its blueprint approach means faster time-to-value, often a matter of days, for entire order-to-cash sequences, though heavy customisation may still require Patchworks' own team.
- **Weakness 1 — pricing opacity**: Shopify's own App Store listing shows "Free to install" with billing only activating after a discussion with Patchworks — there is no published, self-serve price a merchant can see before talking to sales.
- **Weakness 2 — too much for smaller merchants**: Patchworks may not be suitable for very small businesses with minimal integration requirements, or those without a strong reliance on digital tooling, since its capabilities can feel excessive for simple setups.
- **Weakness 3 — cost as a stated limitation**: reviewers directly flag that the cost of the platform can be a limiting factor for small businesses, and that a more flexible pricing structure would help.
- Zero reviews on the Shopify App Store itself at time of research — it's sold almost entirely through partner-led enterprise deals, not discovered and self-installed.

### DCKAP Integrator
Best fit for distributors that want a NetSuite connector built around distribution, connecting to Shopify, Magento, and BigCommerce from one dashboard, though it leans batch-first so buyers need to confirm the sync cadence matches their stock velocity.
- Same batch-vs-real-time weakness as Celigo's default.
- Distribution-specific framing, not a general mid-market multi-ERP product.

### General iPaaS (Boomi, Jitterbit, Workato, SnapLogic)
Broad, enterprise-wide integration platforms that happen to support Shopify and ERPs as one of hundreds of possible connections, rather than being built for this specific pairing.
- Genuinely powerful and flexible, but that flexibility is the weakness for this use case: a merchant or agency has to build the Shopify-to-ERP flow themselves inside a general-purpose platform, rather than getting a pre-shaped, opinionated flow for this specific job.
- Pricing and implementation complexity scale with the platform's generality — you're paying for capability you don't need.

### Native vendor connectors (Acumatica Cloud ERP app, Microsoft's Business Central Shopify Connector)
Both Acumatica and Microsoft ship their own free/low-cost native Shopify connectors directly.
- **Real strength**: genuinely real-time, bidirectional, and free or near-free to install, since the vendor built it themselves.
- **Weakness 1 — single-ERP only**: each is built for exactly one ERP, so an agency managing clients across Acumatica, Business Central, and NetSuite still has to learn and operate three completely different tools with three different UIs and mapping conventions.
- **Weakness 2 — unproven at the review level**: the Acumatica native app currently shows 0 reviews on the Shopify App Store, so real-world reliability at scale is unverified despite the real-time claim.
- **Weakness 3 — no agency layer**: these are single-store, single-vendor tools with no concept of managing several client instances from one place.

### EDI/specialist connectors (TrueCommerce, In-Synch)
Focused on specific transaction types (EDI compliance, Magento-NetSuite specifically) — not directly competing for the general mid-market Shopify-ERP use case, but worth knowing they exist if a client's requirement turns out to be EDI-specific.

### The whitespace this leaves
No player currently offers: **one consistent UI across the 4-6 ERPs that actually cover the mid-market, self-serve onboarding without a sales call, transparent published pricing, real-time sync as the default rather than an upsell, and a built-in agency multi-client layer.** Every existing option makes you trade off at least two of those five.

---

## 3. Differentiation strategy

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

## 4. Target customer

- **Primary**: Shopify merchants doing roughly $1M–$20M in annual revenue, running one of the 4-6 supported ERPs, currently either quoted $20K-$150K for a custom/partner-led integration or limping along on manual CSV exports and spreadsheets.
- **Secondary**: agencies serving several clients in that revenue band, currently either subcontracting ERP integration work entirely or avoiding it because it doesn't fit their normal service model.
- **Explicitly not the target initially**: SAP/enterprise-tier merchants with heavy ERP customisation — that's Celigo/Boomi/partner-led territory and not worth competing for on day one.

---

## 5. Which ERPs to start with

1. **NetSuite** — largest install base among growing Shopify merchants
2. **Microsoft Dynamics 365 Business Central** — strong mid-market manufacturing/distribution presence, and Microsoft's own native connector proves the demand exists but leaves the multi-ERP and agency gaps open
3. **Acumatica** — cloud-native, friendliest API of the group, and its own native app's real-time claim with zero reviews suggests the market wants this but doesn't yet trust an option
4. **Sage (Intacct and/or 300)** — widely used among established SMBs; treat Intacct and 300 as two separate adapters since their APIs differ substantially
5. **Brightpearl** — already ecommerce-oriented, natural fit for Shopify-heavy merchants
6. **SAP Business One** — hold for a later phase; more expensive to build well due to data-model edge cases, and it pulls toward the enterprise segment we're deliberately not targeting first

Start with NetSuite, Business Central, and Acumatica for the v1 build — that covers the three most-requested systems and gives enough adapter variety to prove the canonical-model pattern holds up before adding Sage and Brightpearl.

---

## 6. Core architecture

One internal canonical data model (orders, inventory, customers, fulfillment, pricing, returns/credit memos) with a thin adapter per ERP translating to and from that ERP's native structure. Adding an ERP later means writing a new adapter against an already-proven model, not rebuilding the product.

Each adapter needs to independently handle:
- Authentication (OAuth where available, API key/token elsewhere)
- The ERP's native object model for orders, items, customers, and inventory
- Rate limits and API quotas specific to that ERP
- Sandbox/test environment support, since almost every mid-market ERP implementation goes through a staging phase before going live

---

## 7. Full functional spec

### 7.1 Onboarding and setup — a step-by-step wizard, not a settings page

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

### 7.2 Order flow (Shopify → ERP)
- Standard orders, near-real-time via webhooks
- Partial fulfillments
- Partial refunds and full refunds, each producing the correct ERP document type (credit memo vs. reversed invoice vs. cancelled unshipped order, matching the governed cases an ERP actually expects — refunded orders should follow governed cases: closing and refunding unprocessed sales orders, deleting unconfirmed shipments, creating credit memos for shipped or invoiced orders, or reversing released invoices, so that every refund is mirrored by the correct ERP document)
- Gift cards
- Discounts and promotions, mapped to how the ERP represents them (not just netted into a lower line total, which breaks margin reporting)
- Draft orders / manually created orders
- Multi-currency orders, using the actual conversion rate applied at the time of the transaction, not a daily average
- Order edits made after initial sync (address changes, added/removed line items before fulfillment)

### 7.3 Inventory flow (ERP → Shopify)
- Real-time stock level updates on every change where the connected ERP's API supports push/webhook-driven updates; scheduled polling with a short interval as the fallback for ERPs that don't (Sage Intacct, Sage 300 — see the caveat in §3), rather than a blanket claim of real-time everywhere
- Multi-location / multi-warehouse mapping, with Shopify locations mapped explicitly to ERP warehouses
- Safety stock / buffer quantity handling, so Shopify doesn't show sellable stock the ERP is holding back
- Backorder handling — what happens to a Shopify order when the ERP shows negative or zero stock, configurable per merchant preference (allow oversell vs. block)
- Kitting / bundles / assemblies — many ERPs treat a bundle as a single manufactured item with component consumption; this needs explicit mapping logic rather than assuming a 1:1 SKU relationship
- Serial and lot number tracking passthrough, for merchants in regulated or traceable-goods categories

### 7.4 Customer flow (bidirectional)
- New customer creation reflected in both directions
- B2B / wholesale customers with company records, not just individual contacts
- Customer-specific price lists and net-terms status pulled from the ERP and reflected in what that customer sees on the storefront
- Guest checkout handling — configurable whether guest orders create a full ERP customer record or route to a default account

### 7.5 Product/catalog flow
- Product and variant sync, ERP as source of truth or Shopify as source of truth, configurable per merchant (some manufacturers manage the catalog in the ERP, some ecommerce-first brands manage it in Shopify)
- Custom/ERP-specific fields, not just the standard set, mapped through the same field-mapping UI used for orders

### 7.6 Reconciliation and monitoring
- **Always-on reconciliation job**: compares Shopify's order record against what actually landed in the ERP, on a short interval, not just nightly, since Shopify only retries failed webhooks for up to 48 hours, so a job that catches what a webhook silently dropped is required, not optional. This job is also the primary integrity mechanism, not just a backstop, for any adapter running on scheduled polling rather than webhooks — see §3.
- **Discrepancy flagging with explanation**: when something doesn't match, state why (timing lag, currency conversion difference, a webhook that failed and was caught by reconciliation) rather than just showing a red flag
- **Sync activity log**: plain-language view of what synced, when, and what failed, usable by an ops person, not just a developer
- **Alerting**: configurable notifications (email, Slack) when a sync failure or unresolved discrepancy crosses a threshold

### 7.7 Extensibility (this is what lets agencies do their billable 30%)
- **Webhook/event hooks for custom logic**: expose events (order received, inventory updated, sync failed) that an agency's own script or middleware can subscribe to, so custom business logic (loyalty rules, custom tax handling, non-standard pricing) can be layered on without forking the core adapter
- **API access to the canonical model**: so an agency building something bespoke on top isn't fighting the ERP's native API directly, but working against the same clean internal model the app itself uses

### 7.8 Agency layer
- **Multi-client connected dashboard**: sync health, reconciliation status, and alerts across every client instance from one login
- **Reusable mapping templates**: save a completed field mapping for a given ERP and reuse it as the starting point for the next client on the same ERP
- **White-label reporting**: agency branding on exported reconciliation/sync reports (see the `agencies.branding_config` field and the `GET /api/agency/reports/:shopId` endpoint in the development spec)
- **Role-based access**: agency staff get scoped access to client instances without needing the client's own login credentials — backed by the `agency_users` and `agency_user_client_access` tables in the development spec, so individual staff members (not just the agency as a whole) can be added, removed, and scoped to specific clients

---

## 8. Non-functional requirements

- **Uptime target**: match or exceed the 99.9% uptime standard competitors like Patchworks already advertise — this is table stakes for anything touching order and inventory data, not a differentiator
- **Security**: OAuth wherever the ERP supports it, encrypted credential storage, no plaintext API keys ever logged
- **Data retention and compliance**: clear policy on how long historical sync data is retained, and GDPR-appropriate handling for any customer PII passing through the sync
- **Rate limit handling**: each adapter needs its own backoff/retry logic tuned to that specific ERP's API limits, since a NetSuite rate-limit response and an Acumatica one behave differently
- **Adapter versioning**: ERPs update their APIs; each adapter needs a versioning and deprecation strategy so a NetSuite API change doesn't silently break every merchant's sync overnight
- **Testing**: each adapter needs its own automated test suite against that ERP's sandbox, run on a schedule, so an ERP-side API change is caught before a merchant reports broken orders

---

## 9. Pricing strategy

The clearest differentiation lever, given how consistently competitors are criticised for opacity:

- **Published, self-serve pricing** visible on the app listing and website — no "request a demo" gate before a merchant can see a number
- **Tiered by order volume**, not by which ERP is connected — the value to the merchant doesn't change based on which system it happens to be, so don't price as if it does
- **Agency multi-client add-on**: small per-connected-store fee for the dashboard, reusable templates, and white-label reporting
- **No implementation fee for standard flows** — if a merchant fits the standard 70%, self-serve onboarding should get them live without paying for guided setup; guided/assisted onboarding can be a paid option for those who want it, not a mandatory gate

---

## 10. Support model

- **Self-serve tier (default)**: documentation, in-app help within the wizard itself (contextual explanations at each step, not a separate help centre), and standard ticket-based support.
- **Assisted onboarding (paid add-on)**: for merchants who want a guided setup call rather than the self-serve wizard alone — this exists deliberately as an optional upsell, not a mandatory gate, which is itself part of the differentiation against Patchworks' sales-call-first model.
- **Agency support**: agencies get a direct escalation path distinct from individual merchant support, since an issue affecting one client's sync is often relevant context for the agency managing several.
- **Migration support**: merchants moving off an existing connector (Celigo, a custom build, manual processes) are flagged during onboarding so they get the parallel-run/cutover flow rather than a standard first-time setup — see the development spec for the technical detail.

## 11. Success metrics

What "working" looks like, to check against honestly rather than just shipping and hoping:

- **Time to first successful live sync**, from install to a merchant completing wizard step 8 — this is the number that validates or invalidates the entire self-serve wizard premise
- **Reconciliation discrepancy rate** across live connections — the product's core trust claim is a low, explained discrepancy rate, so this should be tracked and defended, not just built and forgotten
- **Support ticket volume per adapter**, to catch a specific ERP's integration quietly becoming harder to use than the others
- **Self-serve completion rate** (merchants who complete the wizard without needing the paid assisted-onboarding add-on) — a declining rate here is an early signal the wizard itself needs simplifying before adding more ERPs

## 12. Risks and honest challenges

- **This is a harder build than the retention or accounting apps.** Each ERP adapter is a genuine, ongoing engineering commitment, not a one-time integration. Budget for adapter maintenance as an ongoing cost, not a sunk one.
- **Established players have real depth** (Celigo's decade of NetSuite-specific refinement, Patchworks' order-to-cash sequence coverage). Competing on breadth of edge-case handling from day one isn't realistic — the differentiation has to come from pricing transparency, real-time-by-default, and the multi-ERP-plus-agency layer nobody else combines, not from out-featuring Celigo on NetSuite specifically in year one.
- **Native vendor connectors are free or near-free.** For a merchant on Acumatica alone with no agency involvement, the free native app may be genuinely good enough — the multi-ERP and agency angle is what justifies paying for this instead.
- **Sandbox/testing infrastructure is a real cost** that's easy to underestimate — building it properly (rather than skipping it to ship faster) is precisely what earns trust against "just another connector" scepticism.
- **The "real-time by default" claim is only fully true for a subset of the roadmap.** NetSuite requires customer-side webhook setup and both Sage adapters are polling-only (see §3). This is a genuine gap against the marketing claim, not just a technical footnote, and should be scoped honestly in App Store copy and sales conversations rather than discovered by a merchant after go-live.

---

## 13. Suggested build order

1. **NetSuite adapter v1**: canonical model, field-mapping UI, order/inventory/customer sync, sandbox support, real-time webhooks (including the guided SuiteScript webhook setup flagged in §7.1 step 2). This is the highest-demand ERP, so validate the whole approach against the toughest, most established competitive field (Celigo) first — a deliberate trade-off against building the easier, friendlier-API adapter (Acumatica) first, made explicitly here and in the development spec's milestone rationale.
2. **Reconciliation and alerting**, before calling v1 done — this is the trust-earning feature, not an add-on.
3. **Acumatica adapter**, proving the canonical-model-plus-adapter pattern holds for a second, differently-shaped ERP without a rebuild. Its friendlier API means this adapter should move faster than NetSuite did, banking back some of the schedule spent validating the harder case first.
4. **Business Central adapter**, third proof point, plus the extensibility hooks (webhook/API access) so agencies can start layering custom logic.
5. **Agency multi-client dashboard and reusable mapping templates**, once there are enough single-store paying installs across at least two ERPs to justify it.
6. **Sage and Brightpearl adapters**, expanding coverage once the core product and agency layer are proven.
7. **SAP Business One**, only if there's clear demand pulling toward the enterprise segment — otherwise stay disciplined about the mid-market focus that's the actual differentiation.
