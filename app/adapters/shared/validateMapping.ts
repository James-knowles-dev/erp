import type { FieldMapping, ValidationIssue } from "../types";

// Shared across all 6 adapters (erp-connector-fixes-spec.md F11) -- previously byte-identical
// logic copy-pasted into every adapter's mapping.ts, differing only in the ERP name embedded in
// two error messages. A fix to the validation logic itself (e.g. the schema-aware checking called
// out as future work in F10) now only needs to happen once.
export function buildValidateMapping(
  erpName: string,
  getRequiredMappings: () => FieldMapping[],
) {
  return function validateMapping(mapping: FieldMapping[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const required = getRequiredMappings();

    for (const req of required) {
      const present = mapping.find((m) => m.shopifyField === req.shopifyField);
      if (!present) {
        issues.push({
          field: req.shopifyField,
          severity: "error",
          message: `${req.shopifyField} is required by ${erpName} (target: ${req.erpField}) but has no mapping.`,
        });
      } else if (!present.erpField) {
        issues.push({
          field: req.shopifyField,
          severity: "error",
          message: `${req.shopifyField} is mapped but has no ${erpName} target field.`,
        });
      }
    }

    // An empty erpField means "intentionally unmapped" (e.g. Business Central's fields with no
    // safe custom-field default, see its mapping.ts) -- multiple unmapped rows aren't a collision.
    const seen = new Set<string>();
    for (const m of mapping) {
      if (!m.erpField) continue;
      if (seen.has(m.erpField)) {
        issues.push({
          field: m.shopifyField,
          severity: "warning",
          message: `Multiple Shopify fields map to the same ${erpName} field "${m.erpField}" -- the last one applied wins.`,
        });
      }
      seen.add(m.erpField);
    }

    return issues;
  };
}
