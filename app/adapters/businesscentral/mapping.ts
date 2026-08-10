import type { FieldMapping, FieldMappingTemplate, ValidationIssue } from "../types";

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
        message: `${req.shopifyField} is required by Business Central (target: ${req.erpField}) but has no mapping.`,
      });
    } else if (!present.erpField) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is mapped but has no Business Central target field.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const m of mapping) {
    if (seen.has(m.erpField)) {
      issues.push({
        field: m.shopifyField,
        severity: "warning",
        message: `Multiple Shopify fields map to the same Business Central field "${m.erpField}" -- the last one applied wins.`,
      });
    }
    seen.add(m.erpField);
  }

  return issues;
}
