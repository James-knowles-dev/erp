// Pure canonical-model <-> Acumatica transform functions -- no network calls, unit-testable
// without a live instance. Payload shapes built from Acumatica's documented contract-based REST
// API conventions (2026-08-10 research), not verified against a real instance -- see decision D4
// in README.md's Build Plan. Known open questions called out inline, same policy as the
// NetSuite adapter's transform.ts.

import type { CanonicalAddress, CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import type { FieldMapping } from "../types";

function wrap(value: unknown): { value: unknown } {
  return { value };
}

function findErpField(mapping: FieldMapping[], shopifyField: string): string | undefined {
  return mapping.find((m) => m.shopifyField === shopifyField)?.erpField;
}

// Acumatica wraps every field in {"value": ...} -- unlike NetSuite's transform, there's no plain-
// value/reference-object distinction to handle, just consistent wrapping. Dot-paths are supported
// for parity with the NetSuite transform's setPath, though the default mapping doesn't use them.
function setWrappedPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (typeof next !== "object" || next === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = wrap(value);
}

// erp-connector-fixes-spec.md F7: address sub-fields, same reasoning as the NetSuite transform's
// ADDRESS_SUBFIELDS -- AddressLine1/AddressLine2/City/State/PostalCode/Country are Acumatica's
// documented Address entity field names.
const ADDRESS_SUBFIELDS: (keyof CanonicalAddress)[] = [
  "address1",
  "address2",
  "city",
  "provinceCode",
  "zip",
  "countryCode",
];

function setAddress(
  payload: Record<string, unknown>,
  mapping: FieldMapping[],
  canonicalPrefix: "billingAddress" | "shippingAddress",
  address: CanonicalAddress,
): void {
  for (const canonicalKey of ADDRESS_SUBFIELDS) {
    const value = address[canonicalKey];
    if (!value) continue;
    const erpField = findErpField(mapping, `${canonicalPrefix}.${canonicalKey}`);
    if (erpField) setWrappedPath(payload, erpField, value);
  }
}

export interface AcumaticaSalesOrderPayload {
  OrderType: { value: string };
  Details: Record<string, { value: unknown }>[];
  [key: string]: unknown;
}

export function canonicalOrderToSalesOrder(
  order: CanonicalOrder,
  mapping: FieldMapping[],
  customerId: string,
): AcumaticaSalesOrderPayload {
  const payload: Record<string, unknown> = { OrderType: wrap("SO") };

  // erp-connector-fixes-spec.md F7: previously dropped entirely. FreightAmount and CurrencyRate
  // are Acumatica's documented SalesOrder fields (decent confidence); tax/discount/gift-card land
  // in Usr-prefixed custom fields (same convention as UsrShopifyOrderId) since Acumatica's native
  // tax engine is configuration-driven, not a simple settable total -- TODO(D4): verify against a
  // real instance. Percentage-type discounts are excluded from discountTotal, same as NetSuite's
  // transform (see CanonicalDiscount -- reconciling those needs the line items they apply to).
  const shippingTotal = order.shippingLines.reduce((sum, s) => sum + s.amount, 0);
  const taxTotal = order.taxLines.reduce((sum, t) => sum + t.amount, 0);
  const discountTotal = order.discounts
    .filter((d) => d.type !== "percentage")
    .reduce((sum, d) => sum + d.value, 0);
  const giftCardTotal = order.giftCards.reduce((sum, g) => sum + g.amountUsed, 0);

  const headerFields: Array<[string, unknown]> = [
    ["order.id", order.id],
    ["order.createdAt", order.createdAt.slice(0, 10)],
    ["order.currency", order.currency],
    ["customer.id", customerId],
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
    if (erpField) setWrappedPath(payload, erpField, value);
  }

  setAddress(payload, mapping, "billingAddress", order.billingAddress);
  setAddress(payload, mapping, "shippingAddress", order.shippingAddress);

  // Unlike NetSuite, Acumatica's contract-based REST API references stock items directly by
  // InventoryID (the SKU) -- no separate id-resolution lookup needed. TODO(D4): verify this
  // holds for a real instance; some Acumatica configurations use an internal item id instead.
  const skuTarget = findErpField(mapping, "lineItem.sku") ?? "InventoryID";
  const qtyTarget = findErpField(mapping, "lineItem.quantity") ?? "Quantity";
  const priceTarget = findErpField(mapping, "lineItem.unitPrice") ?? "UnitPrice";

  payload.Details = order.lineItems.map((lineItem) => ({
    [skuTarget]: wrap(lineItem.sku),
    [qtyTarget]: wrap(lineItem.quantity),
    [priceTarget]: wrap(lineItem.unitPrice),
  }));

  return payload as AcumaticaSalesOrderPayload;
}

export interface AcumaticaRefundOperation {
  // TODO(D4): Acumatica has no direct equivalent of NetSuite's credit-memo-linked-to-invoice
  // pattern verified here -- this creates a second SalesOrder with OrderType 'CM' (credit memo)
  // referencing the original via the same custom field used for the Shopify order id, which is a
  // best-effort interpretation of README.md's Product Spec §7.2's governed cases pending
  // verification against a real instance, not a documented Acumatica convention.
  //
  // POST for a new credit memo record, PUT to update the original order's status in place --
  // Acumatica's contract-based REST API uses POST for creation and PUT for updates (the reverse
  // of what NetSuite's transform does, which is POST for both since its REST Record API treats
  // POST as create-or-update by id).
  method: "POST" | "PUT";
  entity: "SalesOrder";
  payload: Record<string, unknown>;
}

export function canonicalRefundToAcumaticaOperation(
  refund: CanonicalRefund,
  mapping: FieldMapping[],
): AcumaticaRefundOperation {
  const skuTarget = findErpField(mapping, "lineItem.sku") ?? "InventoryID";
  const qtyTarget = findErpField(mapping, "lineItem.quantity") ?? "Quantity";

  switch (refund.targetErpDocumentType) {
    case "credit_memo":
    case "reversed_invoice":
      return {
        method: "POST",
        entity: "SalesOrder",
        payload: {
          OrderType: wrap("CM"),
          Details: refund.lineItems.map((li) => ({
            [skuTarget]: wrap(li.sku),
            [qtyTarget]: wrap(li.quantity),
          })),
        },
      };
    case "cancelled_order":
      return {
        method: "PUT",
        entity: "SalesOrder",
        payload: { OrderNbr: wrap(refund.originalErpDocumentId), Status: wrap("Cancelled") },
      };
    default: {
      const exhaustive: never = refund.targetErpDocumentType;
      throw new Error(`Unhandled refund target document type: ${exhaustive}`);
    }
  }
}
