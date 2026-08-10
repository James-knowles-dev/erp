import { describe, expect, it } from "vitest";
import { getDefaultFieldMappings, validateMapping } from "./mapping";

describe("validateMapping", () => {
  it("passes with no issues when all default mappings are present", () => {
    const issues = validateMapping(getDefaultFieldMappings().mappings);
    expect(issues).toEqual([]);
  });

  it("flags a missing required field", () => {
    const withoutCurrency = getDefaultFieldMappings().mappings.filter(
      (m) => m.shopifyField !== "order.currency",
    );

    const issues = validateMapping(withoutCurrency);

    expect(issues).toContainEqual(
      expect.objectContaining({ field: "order.currency", severity: "error" }),
    );
  });

  it("warns when two Shopify fields map to the same NetSuite field", () => {
    const mappings = getDefaultFieldMappings().mappings.map((m) =>
      m.shopifyField === "order.currency" ? { ...m, erpField: "trandate" } : m,
    );

    const issues = validateMapping(mappings);

    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });
});
