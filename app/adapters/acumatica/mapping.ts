import type { FieldMapping, FieldMappingTemplate, ValidationIssue } from "../types";

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
  ];

  return { entityType: "order", mappings };
}

export function validateMapping(mapping: FieldMapping[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const required = getDefaultFieldMappings().mappings.filter((m) => m.isRequired);

  for (const req of required) {
    const present = mapping.find((m) => m.shopifyField === req.shopifyField);
    if (!present) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is required by Acumatica (target: ${req.erpField}) but has no mapping.`,
      });
    } else if (!present.erpField) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is mapped but has no Acumatica target field.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const m of mapping) {
    if (seen.has(m.erpField)) {
      issues.push({
        field: m.shopifyField,
        severity: "warning",
        message: `Multiple Shopify fields map to the same Acumatica field "${m.erpField}" -- the last one applied wins.`,
      });
    }
    seen.add(m.erpField);
  }

  return issues;
}
