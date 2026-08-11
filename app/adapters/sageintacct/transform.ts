// Pure canonical-model <-> Sage Intacct transform functions -- no network calls, unit-testable
// without a live account. Payload shapes built from Intacct's documented SODOCUMENT/aradjustment
// XML objects (2026-08-10 research), not verified against a live account -- see decision D4 in
// erp-connector-build-plan.md.

import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";
import type { SageIntacctItemIdMap } from "./types";

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
      return {
        type: "ar_adjustment",
        payload: {
          INVOICENO: refund.originalErpDocumentId,
          ARADJUSTMENTITEMS: {
            ARADJUSTMENTITEM: [{ AMOUNT: totalAmount, [qtyField]: refund.lineItems.length }],
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
