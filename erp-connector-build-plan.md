# Shopify Multi-ERP Connector — Milestone 0–1 Build Plan

Companion to `erp-connector-spec.md` and `erp-connector-dev-spec.md`. This document scopes the first two milestones from the dev spec's build table (§17) into concrete tasks, rough effort, dependencies, and the decisions that need answers before (or during) the build — not just a restatement of milestone scope.

**Effort estimates are engineer-days of focused work**, not calendar time — calendar time depends on team size and how much runs in parallel, which is itself an open question below.

---

## 1. Decisions to resolve now — these block real work, not just polish

| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | **Pricing tiers**: actual order-volume breakpoints and dollar amounts per tier | Blocks the Shopify Billing API `AppSubscription` implementation in M0 — "tiered by order volume" (product spec §9) has no numbers attached anywhere in either spec | Resolve before M0's billing tasks start; doesn't block the rest of M0, so sequence billing work last within the milestone if this drags |
| D2 | **Encryption approach for credentials at rest** | Both specs say "encrypted at rest via a managed KMS key" — written when AWS ECS was still an option. Railway has no native KMS service, so this needs a concrete answer: (a) use a cloud KMS (AWS KMS or GCP Cloud KMS) purely for key management while the app itself stays on Railway, or (b) envelope-encrypt with a master key held in Railway's encrypted service variables. Blocks `access_token_encrypted` (M0) and `credentials_encrypted` (M1) | (a) if there's any appetite for a second cloud account — a real KMS gives key rotation and audit logging that a Railway env var can't. (b) is faster to ship and fine for v1 if rotation isn't urgent yet, but should be treated as a named tech-debt item, not a permanent answer |
| D3 | **NetSuite auth method**: Token-Based Auth (TBA) vs OAuth 2.0 | Adapter table (dev spec §4) lists both as options without picking one. TBA is the more common path for third-party integrations and avoids NetSuite's OAuth integration-record approval step; OAuth 2.0 is more modern but adds setup friction per customer. Blocks the NetSuite adapter's `authenticate()` implementation (M1) | Start with TBA for v1 — matches how "most third-party connectors, including established ones, actually operate" per the dev spec's own vendor-program section (§12). Revisit OAuth 2.0 later if a specific customer or NetSuite policy change forces it |
| D4 | **NetSuite sandbox/developer account access** | Not a decision so much as a lead-time risk — the adapter can't be built or tested against anything real without one, and getting one arranged can take longer than the engineering work itself | **Start this today, in parallel with M0** — don't wait for M0 to finish. Treat it as the single most schedule-sensitive item in this plan |
| D5 | **Team size / velocity** | Every estimate below is in engineer-days; calendar time depends entirely on how many people are on this and how much M0 and the NetSuite sandbox request can overlap | Flagged here so the estimates below aren't misread as calendar weeks — see §4 for a sequencing suggestion either way |

---

## 2. Milestone 0 — Shopify app scaffold, OAuth, embedded shell, Billing

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

## 3. Milestone 1 — Canonical model, Postgres schema, NetSuite adapter v1

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

## 4. Suggested sequencing

- **Day 1**: kick off the NetSuite sandbox request (D4) and start the canonical data model package — neither depends on anything else being done first.
- **M0 and the early, sandbox-independent parts of M1** (canonical model, migrations, auth research spike) can run in parallel if there are two engineers; a single engineer should do M0 first since M1's adapter work is largely blocked on sandbox access arriving anyway.
- Resolve D1 (pricing) and D2 (encryption approach) before their respective tasks come up in the table above — neither blocks the start of M0, but both block finishing it.
- Don't start `pushOrder()` until the field-mapping default template exists — building against guessed NetSuite field shapes is the likely source of rework the dev spec's risk section warns about.

## 5. Explicitly out of scope for M0–M1

Called out so it's clear what "done" does and doesn't include at the end of these two milestones:
- Any wizard UI beyond the empty admin shell (steps 1–8 are M2/M3)
- The sync engine, job queue, or webhook receiver (M3)
- Reconciliation, activity log UI, or monitoring dashboards (M4)
- Any adapter other than NetSuite (Acumatica is M5)
- Agency features of any kind (M8)

---

*Total for M0+M1 combined: ~27–32 engineer-days, before D1/D2/D3 decisions or D4's lead time are factored into calendar schedule.*
