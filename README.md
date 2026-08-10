# Shopify Multi-ERP Connector

Scaffolded from Shopify's official Remix app template. See `erp-connector-spec.md` (product),
`erp-connector-dev-spec.md` (technical), and `erp-connector-build-plan.md` (milestone scoping)
for everything else — this file only covers running what's built so far.

## What's done (Milestones 0-3)

- Remix app scaffold on Postgres, OAuth install, embedded admin shell, mandatory GDPR webhooks,
  encrypted-credential storage, Billing API plumbing (Milestone 0)
- Canonical data model, `ERPAdapter` contract, and a NetSuite adapter (OAuth 2.0, order push,
  inventory pull) -- unverified against a real NetSuite account, see decision D4 (Milestone 1)
- The full 8-step onboarding wizard at `/app/connect`: pick ERP, connect (NetSuite OAuth),
  environment, field mapping, edge-case rules, backfill window, pre-flight check, go live
  (Milestones 2-3)
- Sync engine: `orders/create` webhook receiver, a BullMQ queue backed by Redis, and an in-process
  worker that pushes orders to NetSuite once a connection has gone live (Milestone 3)

`npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass locally as of
this commit.

## What's not done yet, and why

- **Nothing has been exercised against a real NetSuite account.** The adapter, OAuth flow, and
  order-push payload shapes are built from NetSuite's documented API, not a live sandbox -- see
  decision D4 in `erp-connector-build-plan.md`. This is the biggest open risk in the whole build.
- **The sync worker runs in-process**, not as the separate Railway service the dev spec's
  architecture calls for -- a deliberate scope decision for now (build-plan Milestone 3 notes),
  not a rewrite to change later.
- **Pricing (D1) is still a placeholder.** Billing defaults to test mode
  (`SHOPIFY_BILLING_TEST_MODE`) so step 8 won't attempt a real charge until that's resolved.
- Several smaller scope cuts are called out inline in code comments where they matter (e.g. the
  field-mapping UI is a plain text field per row, not a NetSuite-schema-aware dropdown; the
  pre-flight check and backfill only look at Shopify's first page of orders).

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

## Node version

This machine had no Node install; `nvm` was installed to `~/.nvm` and Node 24 (LTS) set as
default. Run `nvm use` in new shells if it's not already active.
