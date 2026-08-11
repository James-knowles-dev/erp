import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for a Sage 300 connection's "order" entity, mirroring the other four
// adapters' mapping.ts files and defaults for the same shopifyField set. erpField values target
// Sage 300's OEOrders (Order Entry) Web API resource shape (2026-08-10 research) -- see
// transform.ts.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.createdAt", erpField: "OrderDate", isRequired: true },
    { shopifyField: "order.currency", erpField: "CurrencyCode", isRequired: true },
    { shopifyField: "customer.id", erpField: "CustomerNumber", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "ItemNumber", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "QuantityOrdered", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "UnitPrice", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comments. Totals and billing
    // address have no confirmed default target and stay unmapped (erpField: "") by default;
    // ship-to address does, since Sage 300's OE Order Entry has a per-order Ship-To tab.
    { shopifyField: "order.shippingTotal", erpField: "", isRequired: false },
    { shopifyField: "order.taxTotal", erpField: "", isRequired: false },
    { shopifyField: "order.discountTotal", erpField: "", isRequired: false },
    { shopifyField: "order.giftCardTotal", erpField: "", isRequired: false },
    { shopifyField: "order.exchangeRate", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.address1", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.address2", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.city", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.provinceCode", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.zip", erpField: "", isRequired: false },
    { shopifyField: "billingAddress.countryCode", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.address1", erpField: "ShipToAddress1", isRequired: false },
    { shopifyField: "shippingAddress.address2", erpField: "ShipToAddress2", isRequired: false },
    { shopifyField: "shippingAddress.city", erpField: "ShipToCity", isRequired: false },
    { shopifyField: "shippingAddress.provinceCode", erpField: "ShipToStateProvince", isRequired: false },
    { shopifyField: "shippingAddress.zip", erpField: "ShipToZipPostal", isRequired: false },
    { shopifyField: "shippingAddress.countryCode", erpField: "ShipToCountry", isRequired: false },
  ];

  return { entityType: "order", mappings };
}

export const validateMapping = buildValidateMapping("Sage 300", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
