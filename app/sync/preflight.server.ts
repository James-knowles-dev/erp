// Product spec §7.1 step 7: "12 of your last 50 orders would sync cleanly. 2 would need
// attention because [reason]." Dry-run only -- never calls the NetSuite adapter's push methods,
// just runs the same canonical-model transform and mapping validation that a real sync would use.
//
// Uses the Admin GraphQL API rather than REST: Shopify has been steadily narrowing REST Admin API
// access, and this app targets API version 2026-07 -- GraphQL is the reliably-supported path for
// an app built now, not a stylistic preference. That means orders fetched here are mapped from
// GraphQL's shape into the REST-webhook-shaped ShopifyOrderPayload that shopifyToCanonical.ts
// already expects (Milestone 3's webhook receiver gets real REST-shaped payloads directly from
// Shopify), rather than building a second parallel canonical transform for GraphQL specifically.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "./shopifyToCanonical";
import { validateMapping } from "../adapters/netsuite/mapping";
import type { FieldMapping } from "../adapters/types";
import db from "../db.server";

// Shared with backfill.server.ts (same field set: both need enough of the order to build a
// CanonicalOrder), which passes $query as a created_at date filter instead of leaving it null.
export const ORDERS_QUERY = `#graphql
  query RecentOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          currencyCode
          displayFinancialStatus
          displayFulfillmentStatus
          customer { id email }
          email
          totalDiscountsSet { shopMoney { amount } }
          taxLines { title rate priceSet { shopMoney { amount } } }
          lineItems(first: 50) {
            edges {
              node {
                sku
                quantity
                taxable
                fulfillableQuantity
                discountedUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

export interface GraphQLOrderNode {
  id: string;
  name: string;
  createdAt: string;
  currencyCode: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  customer: { id: string; email: string | null } | null;
  email: string | null;
  totalDiscountsSet: { shopMoney: { amount: string } };
  taxLines: { title: string; rate: number | null; priceSet: { shopMoney: { amount: string } } }[];
  lineItems: {
    edges: {
      node: {
        sku: string | null;
        quantity: number;
        taxable: boolean;
        fulfillableQuantity: number;
        discountedUnitPriceSet: { shopMoney: { amount: string } };
      };
    }[];
  };
}

export function gidToNumericId(gid: string): number {
  return Number(gid.split("/").pop());
}

export function toShopifyOrderPayload(node: GraphQLOrderNode): ShopifyOrderPayload {
  return {
    id: gidToNumericId(node.id),
    created_at: node.createdAt,
    currency: node.currencyCode,
    total_discounts: node.totalDiscountsSet.shopMoney.amount,
    customer: node.customer ? { id: gidToNumericId(node.customer.id), email: node.customer.email ?? undefined } : null,
    email: node.email ?? undefined,
    billing_address: null,
    shipping_address: null,
    line_items: node.lineItems.edges.map(({ node: li }) => ({
      sku: li.sku ?? undefined,
      quantity: li.quantity,
      price: li.discountedUnitPriceSet.shopMoney.amount,
      taxable: li.taxable,
      fulfillable_quantity: li.fulfillableQuantity,
      fulfillment_status: null,
    })),
    tax_lines: node.taxLines.map((t) => ({ title: t.title, price: t.priceSet.shopMoney.amount, rate: t.rate })),
    shipping_lines: [],
    financial_status: node.displayFinancialStatus.toLowerCase(),
    fulfillment_status:
      node.displayFulfillmentStatus === "FULFILLED"
        ? "fulfilled"
        : node.displayFulfillmentStatus === "PARTIALLY_FULFILLED"
          ? "partial"
          : null,
    fulfillments: [],
  };
}

export interface PreflightIssue {
  orderName: string;
  reasons: string[];
}

export interface PreflightReport {
  totalChecked: number;
  cleanCount: number;
  issues: PreflightIssue[];
}

export async function runPreflightCheck(
  admin: AdminApiContext,
  shopId: string,
  connectionId: string,
  mapping: FieldMapping[],
): Promise<PreflightReport> {
  const response = await admin.graphql(ORDERS_QUERY, { variables: { first: 50 } });
  const data = (await response.json()) as { data: { orders: { edges: { node: GraphQLOrderNode }[] } } };
  const orders = data.data.orders.edges.map((e) => e.node);

  const mappingIssues = validateMapping(mapping);
  const mappingErrors = mappingIssues.filter((i) => i.severity === "error").map((i) => i.message);

  const issues: PreflightIssue[] = [];
  let cleanCount = 0;

  for (const node of orders) {
    const reasons: string[] = [...mappingErrors];
    const payload = toShopifyOrderPayload(node);

    if (payload.line_items.some((li) => !li.sku)) {
      reasons.push("One or more line items has no SKU, which NetSuite needs to identify the item.");
    }

    // Duplicate-detection per erp-connector-dev-spec.md §15: an order that already has a
    // confirmed erp_document_ref (e.g. from a prior connector) would create a duplicate in
    // NetSuite if synced again.
    const existingSync = await db.syncJob.findFirst({
      where: {
        connectionId,
        entityType: "order",
        shopifyReferenceId: String(payload.id),
        erpDocumentRef: { not: null },
      },
    });
    if (existingSync) {
      reasons.push(
        `Already has a NetSuite document (${existingSync.erpDocumentRef}) from a previous sync -- syncing again would duplicate it.`,
      );
    }

    if (reasons.length > 0) {
      issues.push({ orderName: node.name, reasons });
    } else {
      // Transform errors (e.g. a genuinely malformed order) surface here rather than earlier,
      // since they're specific to this order, not a mapping-level problem shared by all of them.
      try {
        shopifyOrderToCanonical(shopId, payload);
        cleanCount += 1;
      } catch (err) {
        issues.push({
          orderName: node.name,
          reasons: [err instanceof Error ? err.message : "Unknown transform error."],
        });
      }
    }
  }

  return { totalChecked: orders.length, cleanCount, issues };
}
