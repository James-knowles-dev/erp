import type { FieldMapping, FieldMappingTemplate, ValidationIssue } from "../types";

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
        message: `${req.shopifyField} is required by Brightpearl (target: ${req.erpField}) but has no mapping.`,
      });
    } else if (!present.erpField) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is mapped but has no Brightpearl target field.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const m of mapping) {
    if (seen.has(m.erpField)) {
      issues.push({
        field: m.shopifyField,
        severity: "warning",
        message: `Multiple Shopify fields map to the same Brightpearl field "${m.erpField}" -- the last one applied wins.`,
      });
    }
    seen.add(m.erpField);
  }

  return issues;
}
