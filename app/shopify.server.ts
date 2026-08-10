import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Plan names, tiered by order volume per erp-connector-spec.md §9. The amounts, order-volume
// breakpoints, and even the tier names below are PLACEHOLDERS -- see decision D1 in
// erp-connector-build-plan.md. Nothing here should be treated as real pricing until that's
// resolved; update both this file and the `terms` strings together when it is.
export const BILLING_PLANS = {
  STARTER: "Starter",
  GROWTH: "Growth",
  SCALE: "Scale",
} as const;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    // Usage-based with a capped monthly amount, per erp-connector-dev-spec.md §13's billing
    // model. PLACEHOLDER numbers -- see decision D1.
    [BILLING_PLANS.STARTER]: {
      lineItems: [
        {
          amount: 99, // PLACEHOLDER capped monthly amount, pending D1
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: "PLACEHOLDER: up to 500 synced orders per month, pending pricing decision D1",
        },
      ],
    },
    [BILLING_PLANS.GROWTH]: {
      lineItems: [
        {
          amount: 299, // PLACEHOLDER capped monthly amount, pending D1
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: "PLACEHOLDER: up to 2,500 synced orders per month, pending pricing decision D1",
        },
      ],
    },
    [BILLING_PLANS.SCALE]: {
      lineItems: [
        {
          amount: 799, // PLACEHOLDER capped monthly amount, pending D1
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: "PLACEHOLDER: up to 10,000 synced orders per month, pending pricing decision D1",
        },
      ],
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
