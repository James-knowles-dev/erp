// Split out from webhookSubscriptions.server.ts: this is a plain constant with no server-only
// dependencies, but app.settings.tsx's client component needs it too (to list available event
// types in the UI) -- importing it from a .server.ts file would leak that whole module's server
// code (Prisma, encryption) into the client bundle, which Remix's Vite plugin correctly refuses
// to build.

// The three events named in product spec §7.7: "order received, inventory updated, sync failed."
// reconciliation_alert was added post-Milestone-9: the >2% discrepancy threshold in
// reconciliation.server.ts previously only wrote an activity_log row -- nothing external ever
// fired, so an agency with no one watching the in-app activity log had no way to learn about it.
export const EVENT_TYPES = ["order_received", "order_synced", "sync_failed", "reconciliation_alert"] as const;
export type WebhookEventType = (typeof EVENT_TYPES)[number];
