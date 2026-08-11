import type { FieldMapping, FieldMappingTemplate } from "../types";
import { buildValidateMapping } from "../shared/validateMapping";

// Default field mappings for a Sage Intacct connection's "order" entity, mirroring the other three
// adapters' mapping.ts files and defaults for the same shopifyField set. erpField values target
// Intacct's SODOCUMENT (sales order) XML element names (2026-08-10 research) -- see transform.ts.
export function getDefaultFieldMappings(): FieldMappingTemplate {
  const mappings: FieldMapping[] = [
    { shopifyField: "order.createdAt", erpField: "WHENCREATED", isRequired: true },
    { shopifyField: "order.currency", erpField: "CURRENCY", isRequired: true },
    { shopifyField: "customer.id", erpField: "CUSTOMERID", isRequired: true },
    { shopifyField: "lineItem.sku", erpField: "ITEMID", isRequired: true },
    { shopifyField: "lineItem.quantity", erpField: "QUANTITY", isRequired: true },
    { shopifyField: "lineItem.unitPrice", erpField: "PRICE", isRequired: true },
    // erp-connector-fixes-spec.md F7 -- see transform.ts's header comment on
    // canonicalOrderToSalesOrder for why these are unmapped (erpField: "") by default rather than
    // guessed: Intacct's SHIPTO/BILLTO are often CONTACTNAME references to an existing Contact
    // record, not free-text addresses, and there's no confirmed generic custom-field convention
    // for order-level totals the way NetSuite/Acumatica have. Present in the mapping UI, computed
    // in transform.ts, but only actually sent if a merchant/agency retargets them to a field
    // confirmed against their own account.
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

export const validateMapping = buildValidateMapping("Sage Intacct", () =>
  getDefaultFieldMappings().mappings.filter((m) => m.isRequired),
);
