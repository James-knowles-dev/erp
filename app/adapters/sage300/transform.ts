// Pure canonical-model <-> Sage 300 transform functions -- no network calls, unit-testable
// without a live install. Payload shapes built from Sage's Web API Developer/Endpoint Reference
// PDFs (2026-08-10 research), not verified against a live install -- see decision D4 in
// erp-connector-build-plan.md.

import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { Sage300ItemIdMap } from "./types";

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

export interface Sage300OrderDetail {
  ItemNumber: string;
  [key: string]: unknown;
}

export interface Sage300OrderPayload {
  CustomerNumber: string;
  OrderDate: string;
  OEOrderDetails: { OEOrderDetail: Sage300OrderDetail[] };
  [key: string]: unknown;
}

export function canonicalOrderToSage300Order(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  itemIds: Sage300ItemIdMap,
  customerNumber: string,
): Sage300OrderPayload {
  const payload: Record<string, unknown> = {};

  const customerField = findErpField(mapping, "customer.id") ?? "CustomerNumber";
  payload[customerField] = customerNumber;

  const dateField = findErpField(mapping, "order.createdAt") ?? "OrderDate";
  payload[dateField] = order.createdAt.slice(0, 10);

  const currencyField = findErpField(mapping, "order.currency") ?? "CurrencyCode";
  payload[currencyField] = order.currency;

  const skuField = findErpField(mapping, "lineItem.sku") ?? "ItemNumber";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "QuantityOrdered";
  const priceField = findErpField(mapping, "lineItem.unitPrice") ?? "UnitPrice";

  const details = order.lineItems.map((lineItem) => {
    const itemNumber = itemIds[lineItem.sku];
    if (!itemNumber) {
      throw new Error(
        `No Sage 300 item found for SKU "${lineItem.sku}" -- resolve item numbers via ` +
          `resolveItemIds() before calling pushOrder().`,
      );
    }
    return {
      ItemNumber: itemNumber,
      [skuField]: itemNumber,
      [qtyField]: lineItem.quantity,
      [priceField]: lineItem.unitPrice,
    };
  });

  payload.OEOrderDetails = { OEOrderDetail: details };

  return payload as Sage300OrderPayload;
}

export type Sage300RefundOperation =
  | { type: "credit_note"; payload: Record<string, unknown> }
  | { type: "cancel_order"; orderNumber: string };

export function canonicalRefundToSage300Operation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
  itemIds: Sage300ItemIdMap,
): Sage300RefundOperation {
  const skuField = findErpField(mapping, "lineItem.sku") ?? "ItemNumber";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "QuantityOrdered";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice": {
      const details = refund.lineItems.map((lineItem) => {
        const itemNumber = itemIds[lineItem.sku];
        if (!itemNumber) {
          throw new Error(`No Sage 300 item found for SKU "${lineItem.sku}" in refund.`);
        }
        return { ItemNumber: itemNumber, [skuField]: itemNumber, [qtyField]: lineItem.quantity };
      });

      return {
        type: "credit_note",
        payload: {
          // TODO(D4): OECreditDebitNotes' field for referencing the original order/invoice being
          // credited wasn't confirmed by research -- FromOrderNumber is a plausible guess based on
          // Sage 300's general "From{Entity}" cross-reference naming convention seen elsewhere in
          // the Endpoint Reference, not verified against a live install.
          FromOrderNumber: refund.originalErpDocumentId,
          OEDocumentDetails: { OEDocumentDetail: details },
        },
      };
    }
    case "cancelled_order":
      return { type: "cancel_order", orderNumber: refund.originalErpDocumentId };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
