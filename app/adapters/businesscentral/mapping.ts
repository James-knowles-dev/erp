import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for a Business Central connection's "order" entity, mirroring the
// NetSuite/Acumatica adapters' mapping.ts files and defaults for the same shopifyField set.
// erpField paths target Business Central's v2.0 salesOrders API shape (plain JSON, no {value}
// wrapper the way Acumatica has, no dot-nested reference objects the way NetSuite's transform
// builds) -- see transform.ts. shopifyOrderId has no obvious standard field to land in; Business
// Central doesn't have NetSuite/Acumatica's simple "add a custom field" story via the REST API
// itself (custom fields need an AL extension published to the environment first), so this is
// left unmapped by default rather than pointing at a field that doesn't exist yet -- see the
// TODO(D4) note in transform.ts.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.createdAt", erpField: "orderDate", isRequired: true },
    { shopifyField: "order.currency", erpField: "currencyCode", isRequired: true },
    { shopifyField: "customer.id", erpField: "customerNumber", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "lineObjectNumber", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "quantity", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "unitPrice", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comment. Unlike NetSuite/
    // Acumatica, there's no safe custom-field default to invent for these (Business Central
    // custom fields need a published AL extension, same gap as shopifyOrderId above), so they're
    // left unmapped (erpField: "") by default -- present in the mapping UI so a merchant/agency
    // that's published one can retarget it, rather than not offering the option at all.
    { shopifyField: "order.shippingTotal", erpField: "", isRequired: false },
    { shopifyField: "order.taxTotal", erpField: "", isRequired: false },
    { shopifyField: "order.discountTotal", erpField: "", isRequired: false },
    { shopifyField: "order.giftCardTotal", erpField: "", isRequired: false },
    { shopifyField: "order.exchangeRate", erpField: "", isRequired: false },
    // Address fields target Business Central's documented v2.0 salesOrders entity fields -- see
    // transform.ts's ADDRESS_FIELDS comment for the one flagged as uncertain (region/state).
    { shopifyField: "billingAddress.address1", erpField: "billToAddressLine1", isRequired: false },
    { shopifyField: "billingAddress.address2", erpField: "billToAddressLine2", isRequired: false },
    { shopifyField: "billingAddress.city", erpField: "billToCity", isRequired: false },
    { shopifyField: "billingAddress.provinceCode", erpField: "billToState", isRequired: false },
    { shopifyField: "billingAddress.zip", erpField: "billToPostCode", isRequired: false },
    { shopifyField: "billingAddress.countryCode", erpField: "billToCountry", isRequired: false },
    { shopifyField: "shippingAddress.address1", erpField: "shipToAddressLine1", isRequired: false },
    { shopifyField: "shippingAddress.address2", erpField: "shipToAddressLine2", isRequired: false },
    { shopifyField: "shippingAddress.city", erpField: "shipToCity", isRequired: false },
    { shopifyField: "shippingAddress.provinceCode", erpField: "shipToState", isRequired: false },
    { shopifyField: "shippingAddress.zip", erpField: "shipToPostCode", isRequired: false },
    { shopifyField: "shippingAddress.countryCode", erpField: "shipToCountry", isRequired: false },
  ];

  return { entityType: "order", mappings };
}

export const validateMapping = buildValidateMapping("Business Central", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
