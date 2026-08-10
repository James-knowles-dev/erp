# Shopify Multi-ERP Connector

Scaffolded from Shopify's official Remix app template. See `erp-connector-spec.md` (product),
`erp-connector-dev-spec.md` (technical), and `erp-connector-build-plan.md` (milestone scoping)
for everything else — this file only covers running what's built so far.

## What's done (Milestone 0)

- Remix app scaffold, switched from the template's default SQLite to Postgres (`prisma/schema.prisma`)
- OAuth install flow + embedded admin shell (App Bridge + Polaris), placeholder Home route
- Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) — registered
  in `shopify.app.toml`, handlers in `app/routes/webhooks.*`
- Encryption utility (`app/utils/encryption.server.ts`) — envelope encryption via a master key,
  per build-plan decision D2
- Billing API plumbing (`app/shopify.server.ts`, `app/utils/billing.server.ts`) — usage-based
  plans with **placeholder pricing**, not yet wired into any route (that's Milestone 3, wizard
  step 8)
- CI (`.github/workflows/ci.yml`): lint, typecheck, build on every PR

`npm run lint`, `npm run typecheck`, and `npm run build` all pass locally as of this commit.

## What's not done yet, and why

- **No live database migration has been run.** `prisma/migrations` doesn't exist yet — there's no
  Postgres instance to run `prisma migrate dev` against in this environment. Run it once you have
  a real `DATABASE_URL` (see below).
- **The app hasn't been installed on a real dev store.** `shopify app dev` needs an interactive
  Partner account login, which only you can do.
- **Pricing (D1) and the encryption approach (D2) are still open decisions**, currently filled
  with clearly-marked placeholders — see `erp-connector-build-plan.md` §1.

## To actually run this

1. **Create the Shopify app** in the [Partner Dashboard](https://partners.shopify.com), or run
   `npm run config:link` if one already exists. This gets you a `client_id` for `shopify.app.toml`
   and the API key/secret for `.env`.
2. **Provision Postgres on Railway** and copy its connection string.
3. Copy `.env.example` to `.env` and fill in `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
   `DATABASE_URL`, and `ENCRYPTION_MASTER_KEY` (generate with `openssl rand -base64 32`).
4. Run the first migration: `npx prisma migrate dev --name init`.
5. `npm run dev` (this is `shopify app dev` — it'll prompt you to log in to Partners and pick or
   create a dev store the first time).

## Node version

This machine had no Node install; `nvm` was installed to `~/.nvm` and Node 24 (LTS) set as
default. Run `nvm use` in new shells if it's not already active.
