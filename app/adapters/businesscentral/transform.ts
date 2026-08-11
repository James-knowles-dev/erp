// Pure canonical-model <-> Business Central transform functions -- no network calls, unit-
// testable without a live environment. Payload shapes built from Microsoft's documented v2.0
// salesOrders/salesOrderLines API (2026-08-10 research), not verified against a real environment
// -- see decision D4 in README.md's Build Plan.

import type { CanonicalAddress, CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { BusinessCentralItemIdMap } from "./types";

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

// erp-connector-fixes-spec.md F7: billTo/shipTo flat fields are Business Central's documented
// v2.0 salesOrders entity address fields (2026-08-10 research) -- TODO(D4): the region/state field
// (billToState/shipToState here) is the one most likely to be wrong; some BC environments expose
// it as "County" instead, a naming quirk specific to this API.
const ADDRESS_FIELDS: [keyof CanonicalAddress, string][] = [
  ["address1", "AddressLine1"],
  ["address2", "AddressLine2"],
  ["city", "City"],
  ["provinceCode", "State"],
  ["zip", "PostCode"],
  ["countryCode", "Country"],
];

function setAddress(
  payload: Record<string, unknown>,
  mapping: FieldMapping[],
  canonicalPrefix: "billingAddress" | "shippingAddress",
  address: CanonicalAddress,
): void {
  for (const [canonicalKey] of ADDRESS_FIELDS) {
    const value = address[canonicalKey];
    if (!value) continue;
    const erpField = findErpField(mapping, `${canonicalPrefix}.${canonicalKey}`);
    if (erpField) payload[erpField] = value;
  }
}

export interface BusinessCentralSalesOrderLine {
  itemId: string;
  lineType: "Item";
  lineObjectNumber: string;
  quantity: number;
  unitPrice: number;
}

export interface BusinessCentralSalesOrderPayload {
  customerNumber: string;
  orderDate: string;
  currencyCode: string;
  salesOrderLines: BusinessCentralSalesOrderLine[];
  [key: string]: unknown;
}

// TODO(D4): Business Central has no equivalent of NetSuite's custbody_shopify_order_id or
// Acumatica's UsrShopifyOrderId reachable via the standard REST API -- custom fields need an AL
// extension published to the environment first, which isn't something this adapter can do on the
// merchant's behalf. Traceability back to the Shopify order relies entirely on our own sync_jobs
// table rather than a field visible on the Business Central record itself. Not required for
// correctness (duplicate-detection in preflight.server.ts already only reads our own database),
// but a real UX gap versus the other two adapters if a merchant goes looking at the record itself.
export function canonicalOrderToSalesOrder(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  itemIds: BusinessCentralItemIdMap,
  customerNumber: string,
): BusinessCentralSalesOrderPayload {
  const payload: Record<string, unknown> = {};

  // erp-connector-fixes-spec.md F7: previously dropped entirely. Unlike NetSuite/Acumatica's
  // custbody_/Usr-prefixed custom fields (which a merchant can add through the UI), Business
  // Central custom fields need an AL extension published to the environment first (same gap the
  // header comment above already documents for shopifyOrderId) -- there's no safe default target
  // to invent here, so these stay unmapped (erpField: "") by default in getDefaultFieldMappings,
  // computed but only actually set on the payload if a merchant/agency retargets them to a real
  // field once they've published one. Percentage-type discounts are excluded from discountTotal,
  // same as the other adapters (see CanonicalDiscount).
  const shippingTotal = order.shippingLines.reduce((sum, s) => sum + s.amount, 0);
  const taxTotal = order.taxLines.reduce((sum, t) => sum + t.amount, 0);
  const discountTotal = order.discounts
    .filter((d) => d.type !== "percentage")
    .reduce((sum, d) => sum + d.value, 0);
  const giftCardTotal = order.giftCards.reduce((sum, g) => sum + g.amountUsed, 0);

  const headerFields: Array<[string, unknown]> = [
    ["order.createdAt", order.createdAt.slice(0, 10)],
    ["order.currency", order.currency],
    ["customer.id", customerNumber],
    ["order.shippingTotal", shippingTotal],
    ["order.taxTotal", taxTotal],
    ["order.discountTotal", discountTotal],
    ["order.giftCardTotal", giftCardTotal],
  ];
  if (order.exchangeRateAtTransaction != null) {
    headerFields.push(["order.exchangeRate", order.exchangeRateAtTransaction]);
  }

  for (const [shopifyField, value] of headerFields) {
    const erpField = findErpField(mapping, shopifyField);
    if (erpField) payload[erpField] = value;
  }

  setAddress(payload, mapping, "billingAddress", order.billingAddress);
  setAddress(payload, mapping, "shippingAddress", order.shippingAddress);

  const skuField = findErpField(mapping, "lineItem.sku") ?? "lineObjectNumber";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "quantity";
  const priceField = findErpField(mapping, "lineItem.unitPrice") ?? "unitPrice";

  const salesOrderLines = order.lineItems.map((lineItem) => {
    const itemId = itemIds[lineItem.sku];
    if (!itemId) {
      throw new Error(
        `No Business Central item id found for SKU "${lineItem.sku}" -- resolve item ids via ` +
          `resolveItemIds() before calling pushOrder().`,
      );
    }
    return {
      itemId,
      lineType: "Item" as const,
      [skuField]: lineItem.sku,
      [qtyField]: lineItem.quantity,
      [priceField]: lineItem.unitPrice,
    };
  });

  payload.salesOrderLines = salesOrderLines;

  return payload as BusinessCentralSalesOrderPayload;
}

export interface BusinessCentralRefundOperation {
  // TODO(D4): Business Central's natural equivalent of a credit memo is the salesCreditMemos
  // entity (a distinct resource from salesOrders, unlike NetSuite/Acumatica which both reuse
  // their sales order record type with a different OrderType/record subtype). Cancelling an
  // unshipped order updates the original salesOrder's status instead. Best-effort interpretation
  // of README.md's Product Spec §7.2's governed cases, pending verification against a real
  // environment.
  method: "POST" | "PATCH";
  entity: "salesCreditMemos" | "salesOrders";
  payload: Record<string, unknown>;
}

export function canonicalRefundToBusinessCentralOperation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
  itemIds: BusinessCentralItemIdMap,
): BusinessCentralRefundOperation {
  const skuField = findErpField(mapping, "lineItem.sku") ?? "lineObjectNumber";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "quantity";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice": {
      const salesCreditMemoLines = refund.lineItems.map((lineItem) => {
        const itemId = itemIds[lineItem.sku];
        if (!itemId) {
          throw new Error(`No Business Central item id found for SKU "${lineItem.sku}" in refund.`);
        }
        return {
          itemId,
          lineType: "Item" as const,
          [skuField]: lineItem.sku,
          [qtyField]: lineItem.quantity,
        };
      });

      return {
        method: "POST",
        entity: "salesCreditMemos",
        payload: { salesCreditMemoLines },
      };
    }
    case "cancelled_order":
      return {
        method: "PATCH",
        entity: "salesOrders",
        payload: { id: refund.originalErpDocumentId, status: "Cancelled" },
      };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
