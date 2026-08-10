// Pure canonical-model <-> NetSuite transform functions -- no network calls, so these are
// unit-testable without a live NetSuite account. Payload shapes are built from NetSuite's
// documented REST Record API examples (POST /record/v1/salesOrder), not verified against a real
// sandbox yet -- see decision D4 in erp-connector-build-plan.md. Known open questions are called
// out inline rather than silently assumed correct.

import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { NetSuiteItemIdMap } from "./types";

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (typeof next !== "object" || next === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

export interface NetSuiteSalesOrderPayload {
  entity: { id: string };
  item: { items: Array<Record<string, unknown>> };
  [key: string]: unknown;
}

export function canonicalOrderToSalesOrder(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  itemIds: NetSuiteItemIdMap,
  customerId: string,
): NetSuiteSalesOrderPayload {
  const payload: Record<string, unknown> = {};

  const headerFields: Array<[string, unknown]> = [
    ["order.id", order.id],
    // NetSuite's trandate wants a plain date; Shopify's createdAt is a full timestamp.
    ["order.createdAt", order.createdAt.slice(0, 10)],
    // TODO(D4): NetSuite's `currency` field is typically a reference to a currency record's
    // internal id (e.g. {"id": "1"} for USD), not the raw ISO code. Passing the ISO code
    // through as-is until this can be verified/resolved against a real account.
    ["order.currency", order.currency],
    ["customer.id", { id: customerId }],
  ];

  for (const [shopifyField, value] of headerFields) {
    const erpField = findErpField(mapping, shopifyField);
    if (erpField) setPath(payload, erpField, value);
  }

  const skuTarget = findErpField(mapping, "lineItem.sku") ?? "item";
  const qtyTarget = findErpField(mapping, "lineItem.quantity") ?? "quantity";
  const rateTarget = findErpField(mapping, "lineItem.unitPrice") ?? "rate";

  const items = order.lineItems.map((lineItem) => {
    const netsuiteItemId = itemIds[lineItem.sku];
    if (!netsuiteItemId) {
      throw new Error(
        `No NetSuite item id found for SKU "${lineItem.sku}" -- resolve item ids via ` +
          `resolveItemIds() before calling pushOrder().`,
      );
    }
    const line: Record<string, unknown> = {};
    setPath(line, skuTarget, { id: netsuiteItemId });
    setPath(line, qtyTarget, lineItem.quantity);
    setPath(line, rateTarget, lineItem.unitPrice);
    return line;
  });

  payload.item = { items };

  return payload as NetSuiteSalesOrderPayload;
}

export interface NetSuiteRefundOperation {
  // TODO(D4): NetSuite doesn't have a first-class "reversed invoice" record type the way the
  // canonical model's targetErpDocumentType implies -- reversing a released invoice is normally
  // also done via a credit memo in NetSuite's own model. Treating 'reversed_invoice' the same as
  // 'credit_memo' here is a best-effort interpretation of erp-connector-spec.md §7.2's governed
  // cases, pending verification against a real account.
  method: "POST" | "PATCH";
  recordType: "creditMemo" | "salesOrder";
  payload: Record<string, unknown>;
}

export function canonicalRefundToNetSuiteOperation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
  itemIds: NetSuiteItemIdMap,
): NetSuiteRefundOperation {
  const skuTarget = findErpField(mapping, "lineItem.sku") ?? "item";
  const qtyTarget = findErpField(mapping, "lineItem.quantity") ?? "quantity";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice": {
      const items = refund.lineItems.map((lineItem) => {
        const netsuiteItemId = itemIds[lineItem.sku];
        if (!netsuiteItemId) {
          throw new Error(`No NetSuite item id found for SKU "${lineItem.sku}" in refund.`);
        }
        const line: Record<string, unknown> = {};
        setPath(line, skuTarget, { id: netsuiteItemId });
        setPath(line, qtyTarget, lineItem.quantity);
        return line;
      });

      return {
        method: "POST",
        recordType: "creditMemo",
        payload: {
          createdfrom: { id: refund.originalErpDocumentId },
          item: { items },
          memo: refund.reason,
        },
      };
    }
    case "cancelled_order":
      return {
        method: "PATCH",
        recordType: "salesOrder",
        payload: { id: refund.originalErpDocumentId, orderstatus: "cancelled" },
      };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
