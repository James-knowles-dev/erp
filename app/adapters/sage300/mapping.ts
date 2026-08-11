import type { FieldMapping, FieldMappingTemplate, ValidationIssue } from "../types";

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
        message: `${req.shopifyField} is required by Sage 300 (target: ${req.erpField}) but has no mapping.`,
      });
    } else if (!present.erpField) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is mapped but has no Sage 300 target field.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const m of mapping) {
    if (seen.has(m.erpField)) {
      issues.push({
        field: m.shopifyField,
        severity: "warning",
        message: `Multiple Shopify fields map to the same Sage 300 field "${m.erpField}" -- the last one applied wins.`,
      });
    }
    seen.add(m.erpField);
  }

  return issues;
}
