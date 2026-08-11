// Pure canonical-model <-> Sage 300 transform functions -- no network calls, unit-testable
// without a live install. Payload shapes built from Sage's Web API Developer/Endpoint Reference
// PDFs (2026-08-10 research), not verified against a live install -- see decision D4 in
// README.md's Build Plan.

import type { CanonicalAddress, CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { Sage300ItemIdMap } from "./types";

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

// erp-connector-fixes-spec.md F7: address sub-fields. Ship-to has a default target (Sage 300's OE
// Order Entry screen has a per-order Ship-To address tab, unlike billing which normally just uses
// the customer record's own address with no per-order override) -- billing stays unmapped by
// default, see mapping.ts.
const ADDRESS_SUBFIELDS: (keyof CanonicalAddress)[] = [
  "address1",
  "address2",
  "city",
  "provinceCode",
  "zip",
  "countryCode",
];

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

  // erp-connector-fixes-spec.md F7: previously dropped entirely. No default target for any of
  // these totals (Sage 300's OE Order computes tax/discount from configured tax authorities and
  // per-line discount percentages, not a simple settable header total) -- only set if a merchant/
  // agency retargets the mapping to a field confirmed against their own install. Percentage-type
  // discounts are excluded from discountTotal, same as the other adapters (see CanonicalDiscount).
  const shippingTotal = order.shippingLines.reduce((sum, s) => sum + s.amount, 0);
  const taxTotal = order.taxLines.reduce((sum, t) => sum + t.amount, 0);
  const discountTotal = order.discounts
    .filter((d) => d.type !== "percentage")
    .reduce((sum, d) => sum + d.value, 0);
  const giftCardTotal = order.giftCards.reduce((sum, g) => sum + g.amountUsed, 0);

  const optionalHeaderFields: Array<[string, unknown]> = [
    ["order.shippingTotal", shippingTotal],
    ["order.taxTotal", taxTotal],
    ["order.discountTotal", discountTotal],
    ["order.giftCardTotal", giftCardTotal],
  ];
  if (order.exchangeRateAtTransaction != null) {
    optionalHeaderFields.push(["order.exchangeRate", order.exchangeRateAtTransaction]);
  }
  for (const [shopifyField, value] of optionalHeaderFields) {
    const erpField = findErpField(mapping, shopifyField);
    if (erpField) payload[erpField] = value;
  }

  for (const prefix of ["billingAddress", "shippingAddress"] as const) {
    const address = prefix === "billingAddress" ? order.billingAddress : order.shippingAddress;
    for (const subfield of ADDRESS_SUBFIELDS) {
      const value = address[subfield];
      if (!value) continue;
      const erpField = findErpField(mapping, `${prefix}.${subfield}`);
      if (erpField) payload[erpField] = value;
    }
  }

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
