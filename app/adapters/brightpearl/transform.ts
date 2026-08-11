// Pure canonical-model <-> Brightpearl transform functions -- no network calls, unit-testable
// without a live account. Payload shapes built from Brightpearl's documented sales-order/
// sales-credit REST API (api-docs.brightpearl.com, 2026-08-10 research), not verified against a
// live account -- see decision D4 in erp-connector-build-plan.md.

import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { BrightpearlProductIdMap } from "./types";

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

export interface BrightpearlSalesOrderRow {
  quantity: string; // Brightpearl's documented rows[] shape sends quantity as a string, not a number
  taxCode: string;
  [key: string]: unknown;
}

export interface BrightpearlSalesOrderPayload {
  customerId: number;
  currency: { code: string };
  rows: BrightpearlSalesOrderRow[];
  [key: string]: unknown;
}

// TODO(D4): no confirmed default/placeholder tax code -- "T0" (commonly a zero-rate code in UK
// Brightpearl installs) is a guess pending verification against a live account; edge-case-rule
// wiring for a merchant-chosen default isn't built yet (product spec §7.1 step 5).
const PLACEHOLDER_TAX_CODE = "T0";

export function canonicalOrderToBrightpearlSalesOrder(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  productIds: BrightpearlProductIdMap,
  contactId: string,
): BrightpearlSalesOrderPayload {
  const payload: Record<string, unknown> = {
    customerId: Number(contactId),
  };

  const createdAtField = findErpField(mapping, "order.createdAt") ?? "placedOn";
  payload[createdAtField] = order.createdAt;

  const currencyField = findErpField(mapping, "order.currency") ?? "currency";
  payload[currencyField] = { code: order.currency };

  const skuField = findErpField(mapping, "lineItem.sku") ?? "productId";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "quantity";
  const priceField = findErpField(mapping, "lineItem.unitPrice") ?? "unitPrice";

  payload.rows = order.lineItems.map((lineItem) => {
    const productId = productIds[lineItem.sku];
    if (!productId) {
      throw new Error(
        `No Brightpearl product id found for SKU "${lineItem.sku}" -- resolve product ids via ` +
          `resolveProductIds() before calling pushOrder().`,
      );
    }
    return {
      [skuField]: productId,
      [qtyField]: String(lineItem.quantity),
      [priceField]: lineItem.unitPrice,
      taxCode: PLACEHOLDER_TAX_CODE,
    };
  });

  return payload as BrightpearlSalesOrderPayload;
}

export type BrightpearlRefundOperation =
  | { type: "credit_note"; payload: Record<string, unknown> }
  // TODO(D4): statusId for a "cancelled" order state is inferred, not confirmed against a live
  // account's order-status configuration (Brightpearl order statuses are customizable per
  // account) -- see the note in client.server.ts's executeRefundOperation.
  | { type: "cancel_order"; orderId: string; statusId: string };

const CANCELLED_STATUS_ID_PLACEHOLDER = "6"; // TODO(D4): verify against the target account's Order Status settings

export function canonicalRefundToBrightpearlOperation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
  productIds: BrightpearlProductIdMap,
): BrightpearlRefundOperation {
  const skuField = findErpField(mapping, "lineItem.sku") ?? "productId";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "quantity";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice": {
      const rows = refund.lineItems.map((lineItem) => {
        const productId = productIds[lineItem.sku];
        if (!productId) {
          throw new Error(`No Brightpearl product id found for SKU "${lineItem.sku}" in refund.`);
        }
        return {
          [skuField]: productId,
          [qtyField]: String(lineItem.quantity),
          taxCode: PLACEHOLDER_TAX_CODE,
        };
      });

      return {
        type: "credit_note",
        payload: { parentId: Number(refund.originalErpDocumentId), rows },
      };
    }
    case "cancelled_order":
      return {
        type: "cancel_order",
        orderId: refund.originalErpDocumentId,
        statusId: CANCELLED_STATUS_ID_PLACEHOLDER,
      };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
