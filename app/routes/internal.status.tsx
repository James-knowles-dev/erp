import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Queue } from "bullmq";
import db from "../db.server";
import { getRedisConnection } from "../sync/redis.server";
import { SYNC_QUEUE_NAME } from "../sync/queue.server";
import { RECONCILIATION_QUEUE_NAME } from "../sync/scheduler.server";

// Vendor-side monitoring per erp-connector-dev-spec.md §16 -- "what the team building and running
// the app needs to watch," explicitly distinct from the merchant-facing activity log (app.activity
// .tsx). Deliberately NOT under /app -- that route tree requires a valid Shopify embedded session
// for one specific shop; this needs to show data across every shop, so it lives outside that tree
// entirely, gated by a shared secret instead of a merchant session.
const WINDOW_MS = 24 * 60 * 60 * 1000;

function checkAuth(request: Request): void {
  const token = process.env.INTERNAL_DASHBOARD_TOKEN;
  if (!token) throw new Response("INTERNAL_DASHBOARD_TOKEN is not set.", { status: 503 });
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${token}`) throw new Response("Unauthorized", { status: 401 });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  checkAuth(request);

  const since = new Date(Date.now() - WINDOW_MS);

  const jobs = await db.syncJob.findMany({
    where: { createdAt: { gte: since } },
    include: { connection: { select: { erpType: true } } },
  });

  const byAdapter = new Map<string, { total: number; success: number; deadLetter: number }>();
  for (const job of jobs) {
    const key = job.connection.erpType;
    const entry = byAdapter.get(key) ?? { total: 0, success: 0, deadLetter: 0 };
    entry.total += 1;
    if (job.status === "success") entry.success += 1;
    if (job.status === "dead_letter") entry.deadLetter += 1;
    byAdapter.set(key, entry);
  }

  const successRates = Array.from(byAdapter.entries()).map(([erpType, s]) => ({
    erpType,
    total: s.total,
    successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : null,
    deadLetterCount: s.deadLetter,
  }));

  const totalDeadLetter = await db.syncJob.count({ where: { status: "dead_letter" } });

  const syncQueue = new Queue(SYNC_QUEUE_NAME, { connection: getRedisConnection() });
  const reconciliationQueue = new Queue(RECONCILIATION_QUEUE_NAME, { connection: getRedisConnection() });
  const [syncCounts, reconciliationCounts] = await Promise.all([
    syncQueue.getJobCounts(),
    reconciliationQueue.getJobCounts(),
  ]);

  return {
    windowHours: WINDOW_MS / (60 * 60 * 1000),
    successRates,
    totalDeadLetter,
    queues: { sync: syncCounts, reconciliation: reconciliationCounts },
  };
};

// Plain HTML, not Polaris -- this isn't a Shopify-embedded page, it's an internal ops tool.
// Renders inside root.tsx's own <html>/<body> (it's a normal nested route, not a document root),
// so this returns body content only, not a second <html> document.
export default function InternalStatus() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>Sync engine status (last {data.windowHours}h)</h1>

      <h2>Success rate per adapter</h2>
      <table cellPadding={8}>
        <thead>
          <tr>
            <th align="left">ERP</th>
            <th align="left">Jobs</th>
            <th align="left">Success rate</th>
            <th align="left">Dead-lettered</th>
          </tr>
        </thead>
        <tbody>
          {data.successRates.map((row) => (
            <tr key={row.erpType}>
              <td>{row.erpType}</td>
              <td>{row.total}</td>
              <td>{row.successRate ?? "--"}%</td>
              <td>{row.deadLetterCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>Total dead-lettered jobs (all time): {data.totalDeadLetter}</p>

      <h2>Queue depth</h2>
      <pre>{JSON.stringify(data.queues, null, 2)}</pre>
    </div>
  );
}
