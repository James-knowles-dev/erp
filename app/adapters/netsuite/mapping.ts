import type { FieldMapping, FieldMappingTemplate, ValidationIssue } from "../types";

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
        message: `${req.shopifyField} is required by NetSuite (target: ${req.erpField}) but has no mapping.`,
      });
    } else if (!present.erpField) {
      issues.push({
        field: req.shopifyField,
        severity: "error",
        message: `${req.shopifyField} is mapped but has no NetSuite target field.`,
      });
    }
  }

  const seen = new Set<string>();
  for (const m of mapping) {
    if (seen.has(m.erpField)) {
      issues.push({
        field: m.shopifyField,
        severity: "warning",
        message: `Multiple Shopify fields map to the same NetSuite field "${m.erpField}" -- the last one applied wins.`,
      });
    }
    seen.add(m.erpField);
  }

  return issues;
}
