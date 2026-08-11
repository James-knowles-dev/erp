import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { earliestIncompleteStep, loadWizardProgress, requireWizardStep, type WizardProgress } from "./wizardProgress.server";

vi.mock("../db.server", () => ({
  default: {
    fieldMapping: { count: vi.fn() },
    edgeCaseRule: { count: vi.fn() },
    erpConnection: { findUnique: vi.fn() },
  },
}));

function mockProgress(overrides: Partial<{ fieldMappingCount: number; edgeCaseRuleCount: number; backfillWindow: string | null }>) {
  vi.mocked(db.fieldMapping.count).mockResolvedValue(overrides.fieldMappingCount ?? 0);
  vi.mocked(db.edgeCaseRule.count).mockResolvedValue(overrides.edgeCaseRuleCount ?? 0);
  vi.mocked(db.erpConnection.findUnique).mockResolvedValue({ backfillWindow: overrides.backfillWindow ?? null } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("earliestIncompleteStep", () => {
  it("returns 'mapping' first when nothing is done", () => {
    const progress: WizardProgress = { hasFieldMappings: false, hasEdgeCaseRules: false, backfillWindow: null };
    expect(earliestIncompleteStep(progress)).toBe("mapping");
  });

  it("returns 'edgecases' once mapping is done", () => {
    const progress: WizardProgress = { hasFieldMappings: true, hasEdgeCaseRules: false, backfillWindow: null };
    expect(earliestIncompleteStep(progress)).toBe("edgecases");
  });

  it("returns 'backfill' once mapping and edge cases are done", () => {
    const progress: WizardProgress = { hasFieldMappings: true, hasEdgeCaseRules: true, backfillWindow: null };
    expect(earliestIncompleteStep(progress)).toBe("backfill");
  });

  it("treats an explicit 'none' backfill choice as complete, not missing", () => {
    const progress: WizardProgress = { hasFieldMappings: true, hasEdgeCaseRules: true, backfillWindow: "none" };
    expect(earliestIncompleteStep(progress)).toBeNull();
  });

  it("returns null once everything is done", () => {
    const progress: WizardProgress = { hasFieldMappings: true, hasEdgeCaseRules: true, backfillWindow: "30d" };
    expect(earliestIncompleteStep(progress)).toBeNull();
  });
});

describe("loadWizardProgress", () => {
  it("reflects counts and backfillWindow from the database", async () => {
    mockProgress({ fieldMappingCount: 2, edgeCaseRuleCount: 0, backfillWindow: null });
    const progress = await loadWizardProgress("conn-1");
    expect(progress).toEqual({ hasFieldMappings: true, hasEdgeCaseRules: false, backfillWindow: null });
  });
});

describe("requireWizardStep", () => {
  async function getRedirectLocation(promise: Promise<void>): Promise<string> {
    try {
      await promise;
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      return (thrown as Response).headers.get("Location")!;
    }
    throw new Error("expected requireWizardStep to throw a redirect");
  }

  it("redirects a direct hit on golive straight to mapping when nothing is saved", async () => {
    mockProgress({});
    const location = await getRedirectLocation(requireWizardStep("conn-1", "netsuite", "golive"));
    expect(location).toBe("/app/connect/netsuite/mapping?connectionId=conn-1");
  });

  it("redirects to backfill when mapping and edge cases are done but backfill isn't chosen yet", async () => {
    mockProgress({ fieldMappingCount: 1, edgeCaseRuleCount: 1, backfillWindow: null });
    const location = await getRedirectLocation(requireWizardStep("conn-1", "netsuite", "golive"));
    expect(location).toBe("/app/connect/netsuite/backfill?connectionId=conn-1");
  });

  it("is a no-op (doesn't throw) once the required step's data is on record", async () => {
    mockProgress({ fieldMappingCount: 1, edgeCaseRuleCount: 0, backfillWindow: null });
    await expect(requireWizardStep("conn-1", "netsuite", "edgecases")).resolves.toBeUndefined();
  });

  it("is a no-op when the earliest incomplete step is later than what's required (e.g. resuming mid-wizard)", async () => {
    mockProgress({ fieldMappingCount: 1, edgeCaseRuleCount: 0, backfillWindow: null }); // earliest incomplete: edgecases
    await expect(requireWizardStep("conn-1", "netsuite", "mapping")).resolves.toBeUndefined();
  });

  it("is a no-op once every gate is satisfied, even when requiring the earliest step", async () => {
    mockProgress({ fieldMappingCount: 1, edgeCaseRuleCount: 1, backfillWindow: "90d" });
    await expect(requireWizardStep("conn-1", "netsuite", "mapping")).resolves.toBeUndefined();
  });
});
