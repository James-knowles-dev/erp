// Executes the historical backfill selected in wizard step 6, at the moment the connection goes
// live (step 8). Single page only (up to 250 orders, GraphQL's max page size) -- pagination for
// merchants with more history than that in the window isn't built yet, called out here rather
// than silently truncated without explanation. Reuses preflight.server.ts's order query and
// GraphQL-to-ShopifyOrderPayload mapping rather than enqueueing id-only stubs: the worker's order
// processor needs the same full payload shape a real webhook would deliver.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { Prisma } from "@prisma/client";
import { enqueueSyncJob } from "./queue.server";
import { ORDERS_QUERY, toShopifyOrderPayload, type GraphQLOrderNode } from "./preflight.server";

function cutoffDate(backfillWindow: string): Date | null {
  if (backfillWindow === "30d") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (backfillWindow === "90d") return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return null;
}

export async function runBackfill(
  admin: AdminApiContext,
  connectionId: string,
  backfillWindow: string,
): Promise<{ enqueued: number }> {
  const cutoff = cutoffDate(backfillWindow);
  if (!cutoff) return { enqueued: 0 };

  const response = await admin.graphql(ORDERS_QUERY, {
    variables: { first: 250, query: `created_at:>=${cutoff.toISOString()}` },
  });
  const data = (await response.json()) as { data: { orders: { edges: { node: GraphQLOrderNode }[] } } };

  let enqueued = 0;
  for (const { node } of data.data.orders.edges) {
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
    });
    if (result.enqueued) enqueued += 1;
  }

  return { enqueued };
}
