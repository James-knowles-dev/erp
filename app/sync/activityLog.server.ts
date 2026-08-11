import type { Prisma } from "@prisma/client";
import db from "../db.server";

// Matches `activity_log` in README.md's Development Spec §5 -- the merchant-facing "plain-language
// view of what synced, when, and what failed" from product spec §7.6. Deliberately a thin
// fire-and-forget wrapper so call sites (webhook receiver, worker, reconciliation job) don't need
// their own try/catch around it; a logging failure shouldn't fail the sync itself.
export async function logActivity(
  connectionId: string,
  eventType: string,
  message: string,
  severity: "info" | "warning" | "error" = "info",
  // Structured data for entries that carry customer PII (gdpr.server.ts's data_request export
  // dump) -- kept out of `message` so a later customers/redact request can find and scrub it
  // precisely. `null` for the vast majority of call sites, which have nothing PII-bearing to log.
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await db.activityLog.create({ data: { connectionId, eventType, message, severity, metadata } });
  } catch (err) {
    console.error("Failed to write activity log entry:", err);
  }
}
