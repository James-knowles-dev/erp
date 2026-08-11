// Executes the historical backfill selected in wizard step 6, at the moment the connection goes
// live (step 8). Reuses preflight.server.ts's order query and GraphQL-to-ShopifyOrderPayload
// mapping rather than enqueueing id-only stubs: the worker's order processor needs the same full
// payload shape a real webhook would deliver.
//
// Pages through the full backfill window (erp-connector-fixes-spec.md F5) rather than stopping
// after the first 250 orders (GraphQL's max page size) -- a merchant with more history than that
// in the chosen window used to have the older orders in it silently dropped, with nothing
// surfacing the truncation and nothing catching it afterwards either (reconciliation only scans
// the trailing 7 days). Capped at MAX_PAGES as a safety backstop against looping unbounded on an
// unexpectedly huge window, not because that's an expected size.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import { enqueueSyncJob } from "./queue.server";
import { ORDERS_QUERY, toShopifyOrderPayload, type GraphQLOrderNode } from "./preflight.server";
import { computeOrderFingerprint } from "./shopifyToCanonical";
import { logActivity } from "./activityLog.server";

const PAGE_SIZE = 250;
const MAX_PAGES = 40; // 10,000 orders -- see header comment

function cutoffDate(backfillWindow: string): Date | null {
  if (backfillWindow === "30d") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (backfillWindow === "90d") return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return null;
}

interface OrdersPage {
  data: {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: GraphQLOrderNode }[];
    };
  };
}

export async function runBackfill(
  admin: AdminApiContext,
  connectionId: string,
  backfillWindow: string,
): Promise<{ enqueued: number; totalFound: number; truncated: boolean }> {
  const cutoff = cutoffDate(backfillWindow);
  if (!cutoff) return { enqueued: 0, totalFound: 0, truncated: false };

  let enqueued = 0;
  let totalFound = 0;
  let after: string | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: PAGE_SIZE, query: `created_at:>=${cutoff.toISOString()}`, after },
    });
    const { data } = (await response.json()) as OrdersPage;

    for (const { node } of data.orders.edges) {
      totalFound += 1;
      const payload = toShopifyOrderPayload(node);
      const result = await enqueueSyncJob({
        connectionId,
        entityType: "order",
        direction: "shopify_to_erp",
        shopifyReferenceId: String(payload.id),
        payload: payload as unknown as Prisma.InputJsonValue,
        // Backfill only ever runs from the go-live action, after the connection is already marked
        // live (see app.connect.$erpType.golive.tsx) -- never called for a parallel-run/shadow-only
        // connection, so this is always live, not derived per-job.
        mode: "live",
        contentFingerprint: computeOrderFingerprint(payload),
      });
      if (result.enqueued) enqueued += 1;
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  if (truncated) {
    await logActivity(
      connectionId,
      "backfill_truncated",
      `Backfill stopped after ${MAX_PAGES * PAGE_SIZE} orders (safety cap) -- the ${backfillWindow} ` +
        `window may hold more history than was backfilled. Contact support if older orders are missing.`,
      "warning",
    );
  }

  return { enqueued, totalFound, truncated };
}
