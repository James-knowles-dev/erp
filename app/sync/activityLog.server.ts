import db from "../db.server";

// Matches `activity_log` in erp-connector-dev-spec.md §5 -- the merchant-facing "plain-language
// view of what synced, when, and what failed" from product spec §7.6. Deliberately a thin
// fire-and-forget wrapper so call sites (webhook receiver, worker, reconciliation job) don't need
// their own try/catch around it; a logging failure shouldn't fail the sync itself.
export async function logActivity(
  connectionId: string,
  eventType: string,
  message: string,
  severity: "info" | "warning" | "error" = "info",
): Promise<void> {
  try {
    await db.activityLog.create({ data: { connectionId, eventType, message, severity } });
  } catch (err) {
    console.error("Failed to write activity log entry:", err);
  }
}
