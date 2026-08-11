// Pure canonical-model <-> Sage Intacct transform functions -- no network calls, unit-testable
// without a live account. Payload shapes built from Intacct's documented SODOCUMENT/aradjustment
// XML objects (2026-08-10 research), not verified against a live account -- see decision D4 in
// README.md's Build Plan.

import type { CanonicalAddress, CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { SageIntacctItemIdMap } from "./types";

// erp-connector-fixes-spec.md F7: address sub-fields computed and offered for mapping, but with
// no default target -- see mapping.ts's comment on why (SHIPTO/BILLTO ambiguity on this object).
const ADDRESS_SUBFIELDS: (keyof CanonicalAddress)[] = [
  "address1",
  "address2",
  "city",
  "provinceCode",
  "zip",
  "countryCode",
];

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

// TODO(D4): DOCPARID identifies which Order Entry transaction definition ("Sales Order" is the
// out-of-the-box default name, but this is account-configurable) a new SODOCUMENT is filed under
// -- no edge-case-rule wiring yet for a merchant-chosen value (product spec §7.1 step 5), so this
// assumes the default hasn't been renamed.
const DEFAULT_DOCPARID = "Sales Order";

export interface SageIntacctSalesOrderLine {
  ITEMID: string;
  [key: string]: unknown;
}

export interface SageIntacctSalesOrderPayload {
  DOCPARID: string;
  CUSTOMERID: string;
  SODOCUMENTENTRIES: { SODOCUMENTENTRY: SageIntacctSalesOrderLine[] };
  [key: string]: unknown;
}

export function canonicalOrderToSalesOrder(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  itemIds: SageIntacctItemIdMap,
  customerId: string,
): SageIntacctSalesOrderPayload {
  const payload: Record<string, unknown> = {
    DOCPARID: DEFAULT_DOCPARID,
  };

  const customerField = findErpField(mapping, "customer.id") ?? "CUSTOMERID";
  payload[customerField] = customerId;

  const createdAtField = findErpField(mapping, "order.createdAt") ?? "WHENCREATED";
  payload[createdAtField] = order.createdAt.slice(0, 10);

  const currencyField = findErpField(mapping, "order.currency") ?? "CURRENCY";
  payload[currencyField] = order.currency;

  // erp-connector-fixes-spec.md F7: previously dropped entirely. No default target for any of
  // these (see mapping.ts) -- only set if a merchant/agency has retargeted the mapping to a field
  // confirmed against their own account. Percentage-type discounts are excluded from
  // discountTotal, same as the other adapters (see CanonicalDiscount).
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

  const skuField = findErpField(mapping, "lineItem.sku") ?? "ITEMID";
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "QUANTITY";
  const priceField = findErpField(mapping, "lineItem.unitPrice") ?? "PRICE";

  const lines = order.lineItems.map((lineItem) => {
    const itemId = itemIds[lineItem.sku];
    if (!itemId) {
      throw new Error(
        `No Sage Intacct item found for SKU "${lineItem.sku}" -- resolve item ids via ` +
          `resolveItemIds() before calling pushOrder().`,
      );
    }
    return {
      ITEMID: itemId,
      [skuField]: itemId,
      [qtyField]: lineItem.quantity,
      [priceField]: lineItem.unitPrice,
    };
  });

  payload.SODOCUMENTENTRIES = { SODOCUMENTENTRY: lines };

  return payload as SageIntacctSalesOrderPayload;
}

export type SageIntacctRefundOperation =
  | { type: "ar_adjustment"; payload: Record<string, unknown> }
  | { type: "cancel_order"; recordNo: string };

export function canonicalRefundToSageIntacctOperation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
): SageIntacctRefundOperation {
  const qtyField = findErpField(mapping, "lineItem.quantity") ?? "QUANTITY";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice": {
      // TODO(D4): two known gaps, both pre-existing at the canonical-model level (Business
      // Central's equivalent salesCreditMemoLines payload has the same limitation) rather than
      // specific to this adapter: (1) ARADJUSTMENT requires CUSTOMERID, but CanonicalRefund
      // carries no customer identifier at all -- the sync worker would need to resolve it via
      // originalErpDocumentId -> order -> customer before this can actually post successfully.
      // (2) ARADJUSTMENT lines are GL-account-driven, not item/quantity-driven like a sales order
      // -- there's no confirmed way to carry SKU-level detail onto the adjustment itself via the
      // standard object; amount-only is what create_aradjustment reliably supports.
      const totalAmount = refund.lineItems.reduce((sum, li) => sum + li.amount, 0);
      // erp-connector-fixes-spec.md F6: this is a summed quantity, not a line-item count -- a
      // refund of one line item with quantity 3 must report 3 here, not 1. Previously used
      // `refund.lineItems.length`, masked by a test fixture with exactly one line item of
      // quantity 1 (where the two happen to be equal).
      const totalQuantity = refund.lineItems.reduce((sum, li) => sum + li.quantity, 0);
      return {
        type: "ar_adjustment",
        payload: {
          INVOICENO: refund.originalErpDocumentId,
          ARADJUSTMENTITEMS: {
            ARADJUSTMENTITEM: [{ AMOUNT: totalAmount, [qtyField]: totalQuantity }],
          },
        },
      };
    }
    case "cancelled_order":
      return { type: "cancel_order", recordNo: refund.originalErpDocumentId };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
