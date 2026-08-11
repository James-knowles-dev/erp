import { redirect } from "@remix-run/node";
import db from "../db.server";

// Closes the deep-link-to-golive gap (erp-connector-fixes-spec.md F9): every wizard step from
// mapping onward previously only checked connection.status === "active" in its own loader, which
// flips true as soon as OAuth succeeds (see storeErpCredentials in connections.server.ts) --
// before mapping, edge cases, or a backfill choice are ever saved. A bookmarked or guessed URL
// could jump straight to golive and go live on silent adapter defaults, skipping backfill
// entirely (backfillWindow stays null, so runBackfill's "none" branch just does nothing).
//
// "environment" (wizard step 3) isn't gated here -- it defaults to 'sandbox' at connection
// creation (see createConnection), a safe default, and the original resume logic in
// app.connect._index.tsx already treated it as skippable, sending a resuming merchant straight to
// "mapping". Folding it into this chain would be a behavior change beyond what F9 asks for.
export type WizardStep = "mapping" | "edgecases" | "backfill" | "preflight" | "golive";

const GATE_ORDER: WizardStep[] = ["mapping", "edgecases", "backfill", "preflight", "golive"];

export interface WizardProgress {
  hasFieldMappings: boolean;
  hasEdgeCaseRules: boolean;
  backfillWindow: string | null;
}

export async function loadWizardProgress(connectionId: string): Promise<WizardProgress> {
  const [fieldMappingCount, edgeCaseRuleCount, connection] = await Promise.all([
    db.fieldMapping.count({ where: { connectionId } }),
    db.edgeCaseRule.count({ where: { connectionId } }),
    db.erpConnection.findUnique({ where: { id: connectionId }, select: { backfillWindow: true } }),
  ]);
  return {
    hasFieldMappings: fieldMappingCount > 0,
    hasEdgeCaseRules: edgeCaseRuleCount > 0,
    backfillWindow: connection?.backfillWindow ?? null,
  };
}

// The earliest step whose data hasn't actually been saved yet -- null once mapping, edge cases,
// and a backfill choice are all on record. preflight/golive have no persisted state of their own
// to gate on; reaching them just requires everything before them being done.
export function earliestIncompleteStep(progress: WizardProgress): WizardStep | null {
  if (!progress.hasFieldMappings) return "mapping";
  if (!progress.hasEdgeCaseRules) return "edgecases";
  if (progress.backfillWindow == null) return "backfill";
  return null;
}

// Throws a redirect to the earliest incomplete step if `requiredStep` hasn't actually been earned
// yet. Called from the loader (GET) of every gated step, and additionally from golive's action
// (POST) specifically -- a loader-only gate doesn't stop a direct POST to an action route.
export async function requireWizardStep(
  connectionId: string,
  erpType: string,
  requiredStep: WizardStep,
): Promise<void> {
  const progress = await loadWizardProgress(connectionId);
  const incomplete = earliestIncompleteStep(progress);
  if (!incomplete) return;

  if (GATE_ORDER.indexOf(incomplete) < GATE_ORDER.indexOf(requiredStep)) {
    throw redirect(`/app/connect/${erpType}/${incomplete}?connectionId=${connectionId}`);
  }
}
