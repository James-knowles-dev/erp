import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for an Acumatica connection's "order" entity, mirroring
// netsuite/mapping.ts's structure and defaults for the same shopifyField set (product spec
// §7.1 step 4's "every common field pre-mapped"). erpField paths target Acumatica's
// contract-based REST API SalesOrder shape -- see transform.ts for how the {"value": ...}
// wrapper convention gets applied. UsrShopifyOrderId is a custom field ("Usr" prefix is
// Acumatica's own convention for user-added fields) that has to be created in the customer's
// instance before it can be used, same caveat as NetSuite's custbody_shopify_order_id.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.id", erpField: "UsrShopifyOrderId", isRequired: true },
    { shopifyField: "order.createdAt", erpField: "OrderDate", isRequired: true },
    { shopifyField: "order.currency", erpField: "CurrencyID", isRequired: true },
    { shopifyField: "customer.id", erpField: "CustomerID", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "InventoryID", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "Quantity", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "UnitPrice", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comment. None required: an
    // order with no shipping/tax/discount/gift-card activity shouldn't fail validation over
    // fields it'll never populate.
    { shopifyField: "order.shippingTotal", erpField: "FreightAmount", isRequired: false },
    { shopifyField: "order.taxTotal", erpField: "UsrShopifyTaxTotal", isRequired: false },
    { shopifyField: "order.discountTotal", erpField: "UsrShopifyDiscountTotal", isRequired: false },
    { shopifyField: "order.giftCardTotal", erpField: "UsrShopifyGiftCardTotal", isRequired: false },
    { shopifyField: "order.exchangeRate", erpField: "CurrencyRate", isRequired: false },
    { shopifyField: "billingAddress.address1", erpField: "BillingAddress.AddressLine1", isRequired: false },
    { shopifyField: "billingAddress.address2", erpField: "BillingAddress.AddressLine2", isRequired: false },
    { shopifyField: "billingAddress.city", erpField: "BillingAddress.City", isRequired: false },
    { shopifyField: "billingAddress.provinceCode", erpField: "BillingAddress.State", isRequired: false },
    { shopifyField: "billingAddress.zip", erpField: "BillingAddress.PostalCode", isRequired: false },
    { shopifyField: "billingAddress.countryCode", erpField: "BillingAddress.Country", isRequired: false },
    { shopifyField: "shippingAddress.address1", erpField: "ShippingAddress.AddressLine1", isRequired: false },
    { shopifyField: "shippingAddress.address2", erpField: "ShippingAddress.AddressLine2", isRequired: false },
    { shopifyField: "shippingAddress.city", erpField: "ShippingAddress.City", isRequired: false },
    { shopifyField: "shippingAddress.provinceCode", erpField: "ShippingAddress.State", isRequired: false },
    { shopifyField: "shippingAddress.zip", erpField: "ShippingAddress.PostalCode", isRequired: false },
    { shopifyField: "shippingAddress.countryCode", erpField: "ShippingAddress.Country", isRequired: false },
  ];

  return { entityType: "order", mappings };
}

export const validateMapping = buildValidateMapping("Acumatica", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
