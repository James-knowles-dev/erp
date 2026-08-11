import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for a NetSuite connection's "order" entity, pre-filled per
// erp-connector-spec.md §7.1 step 4 ("every common field pre-mapped ... already selected").
// erpField paths are dot-notation targets applied by transform.ts's setPath() against the
// NetSuite REST Record API salesOrder payload shape.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.id", erpField: "custbody_shopify_order_id", isRequired: true },
    { shopifyField: "order.createdAt", erpField: "trandate", isRequired: true },
    { shopifyField: "order.currency", erpField: "currency", isRequired: true },
    { shopifyField: "customer.id", erpField: "entity", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "item", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "quantity", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "rate", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comment on canonicalOrderToSalesOrder
    // for why the tax/discount/gift-card targets are custbody custom fields rather than guessed
    // standard ones. None of these are required: an order with no shipping/tax/discount/gift-card
    // activity shouldn't fail mapping validation over fields it'll never populate.
    { shopifyField: "order.shippingTotal", erpField: "shippingcost", isRequired: false },
    { shopifyField: "order.taxTotal", erpField: "custbody_shopify_tax_total", isRequired: false },
    { shopifyField: "order.discountTotal", erpField: "custbody_shopify_discount_total", isRequired: false },
    { shopifyField: "order.giftCardTotal", erpField: "custbody_shopify_giftcard_total", isRequired: false },
    { shopifyField: "order.exchangeRate", erpField: "exchangerate", isRequired: false },
    { shopifyField: "billingAddress.address1", erpField: "billingaddress.addr1", isRequired: false },
    { shopifyField: "billingAddress.address2", erpField: "billingaddress.addr2", isRequired: false },
    { shopifyField: "billingAddress.city", erpField: "billingaddress.city", isRequired: false },
    { shopifyField: "billingAddress.provinceCode", erpField: "billingaddress.state", isRequired: false },
    { shopifyField: "billingAddress.zip", erpField: "billingaddress.zip", isRequired: false },
    { shopifyField: "billingAddress.countryCode", erpField: "billingaddress.country", isRequired: false },
    { shopifyField: "shippingAddress.address1", erpField: "shippingaddress.addr1", isRequired: false },
    { shopifyField: "shippingAddress.address2", erpField: "shippingaddress.addr2", isRequired: false },
    { shopifyField: "shippingAddress.city", erpField: "shippingaddress.city", isRequired: false },
    { shopifyField: "shippingAddress.provinceCode", erpField: "shippingaddress.state", isRequired: false },
    { shopifyField: "shippingAddress.zip", erpField: "shippingaddress.zip", isRequired: false },
    { shopifyField: "shippingAddress.countryCode", erpField: "shippingaddress.country", isRequired: false },
  ];

  return { entityType: "order", mappings };
}

export const validateMapping = buildValidateMapping("NetSuite", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
