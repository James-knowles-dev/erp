import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for a Brightpearl connection's "order" entity, mirroring the other three
// adapters' mapping.ts files and defaults for the same shopifyField set. erpField values are the
// row-level JSON key names transform.ts builds a sales-order row from, matching Brightpearl's
// documented sales-order POST body shape (2026-08-10 research) -- see transform.ts.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.createdAt", erpField: "placedOn", isRequired: true },
    { shopifyField: "order.currency", erpField: "currency", isRequired: true },
    { shopifyField: "customer.id", erpField: "customerId", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "productId", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "quantity", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "unitPrice", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comments for why these have no
    // default target (erpField: ""): present in the mapping UI, computed, but only sent if a
    // merchant/agency retargets them to a field confirmed against their own account.
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
    { shopifyField: "shippingAddress.address1", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.address2", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.city", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.provinceCode", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.zip", erpField: "", isRequired: false },
    { shopifyField: "shippingAddress.countryCode", erpField: "", isRequired: false },
  ];

  return { entityType: "order", mappings };
}

export const validateMapping = buildValidateMapping("Brightpearl", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
