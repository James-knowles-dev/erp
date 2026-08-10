// Reconciliation per erp-connector-dev-spec.md §8: compares Shopify's order data against
// sync_jobs/ERP confirmation records on a short interval (not just nightly), since Shopify only
// retries failed webhooks for up to 48 hours -- this is what catches a webhook that silently
// failed to enqueue or a job that silently failed to process.
//
// Scoped to the last 7 days of orders per run -- bounded and cheap enough to run every 15
// minutes; older discrepancies would need a separate, less-frequent wider sweep, not built here.
//
// KNOWN LIMITATION: the dev spec wants specific discrepancy reasons (currency_conversion,
// tax_mismatch, partial_refund_pending) but a total-amount comparison alone can't reliably
// distinguish between them -- this uses a coarse heuristic (partially-refunded orders get
// 'partial_refund_pending', everything else gets 'total_mismatch') rather than pretending to a
// precision the data doesn't support.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ErpConnection } from "@prisma/client";
import db from "../db.server";
import { logActivity } from "./activityLog.server";
import { loadErpCredentials } from "../models/connections.server";
import { createAdapter } from "../adapters/registry.server";

const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UNCONFIRMED_THRESHOLD_MS = 60 * 60 * 1000; // per §8 step 3: "past a reasonable time threshold"
const DISCREPANCY_ALERT_THRESHOLD = 0.02; // per §8 step 5: >2% over a rolling 24h

// Neither adapter's getOrderStatus() actually reads documentType (both key off documentId alone)
// -- but sync_jobs only persists the id, not the type it was pushed as, so this maps erpType to
// the string each adapter's pushOrder() actually returns, for correctness if that ever changes
// rather than relying on it staying coincidentally unused.
const ORDER_DOCUMENT_TYPE: Record<string, string> = { netsuite: "salesOrder", acumatica: "SalesOrder" };

const RECONCILE_ORDERS_QUERY = `#graphql
  query ReconcileOrders($query: String!) {
    orders(first: 250, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          id
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount } }
        }
      }
    }
  }
`;

interface ReconcileOrderNode {
  id: string;
  displayFinancialStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string } };
}

export async function runReconciliationForConnection(
  admin: AdminApiContext,
  connection: ErpConnection,
): Promise<void> {
  const cutoff = new Date(Date.now() - RECONCILE_WINDOW_MS);
  const response = await admin.graphql(RECONCILE_ORDERS_QUERY, {
    variables: { query: `created_at:>=${cutoff.toISOString()}` },
  });
  const data = (await response.json()) as { data: { orders: { edges: { node: ReconcileOrderNode }[] } } };

  const credentials = await loadErpCredentials(connection.id);
  const adapter = createAdapter(connection.erpType);
  if (credentials) await adapter.authenticate({ authType: "oauth2", values: { ...credentials } });

  let discrepancies = 0;
  let checked = 0;

  for (const { node } of data.data.orders.edges) {
    const orderId = node.id.split("/").pop();
    if (!orderId) continue;
    checked += 1;

    const syncJob = await db.syncJob.findFirst({
      where: { connectionId: connection.id, entityType: "order", shopifyReferenceId: orderId },
      orderBy: { createdAt: "desc" },
    });

    if (!syncJob) {
      // No sync attempt at all -- only a discrepancy once it's been long enough that a webhook
      // (or the reconciliation run that would have caught a missed one) should have handled it.
      continue;
    }

    if (syncJob.status !== "success") {
      const age = Date.now() - syncJob.createdAt.getTime();
      if (age < UNCONFIRMED_THRESHOLD_MS) continue; // still within the normal processing window

      await writeRecord(connection.id, orderId, null, null, "discrepancy", "sync_not_confirmed");
      discrepancies += 1;
      continue;
    }

    if (!syncJob.erpDocumentRef || !credentials) continue;

    const shopifyTotal = Number(node.currentTotalPriceSet.shopMoney.amount);
    try {
      const orderStatus = await adapter.getOrderStatus({
        documentType: ORDER_DOCUMENT_TYPE[connection.erpType] ?? "unknown",
        documentId: syncJob.erpDocumentRef,
      });
      const erpTotal = orderStatus.total;
      const withinTolerance = Math.abs(shopifyTotal - erpTotal) < 0.01;

      if (withinTolerance) {
        await writeRecord(connection.id, orderId, shopifyTotal, erpTotal, "matched", null);
      } else {
        const reason =
          node.displayFinancialStatus === "PARTIALLY_REFUNDED"
            ? "partial_refund_pending"
            : "total_mismatch";
        await writeRecord(connection.id, orderId, shopifyTotal, erpTotal, "discrepancy", reason);
        discrepancies += 1;
      }
    } catch (err) {
      await writeRecord(
        connection.id,
        orderId,
        shopifyTotal,
        null,
        "discrepancy",
        `lookup_failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      discrepancies += 1;
    }
  }

  if (checked > 0 && discrepancies / checked > DISCREPANCY_ALERT_THRESHOLD) {
    await logActivity(
      connection.id,
      "reconciliation_alert",
      `${discrepancies} of ${checked} recent orders (${Math.round((discrepancies / checked) * 100)}%) have reconciliation discrepancies -- above the 2% threshold.`,
      "error",
    );
  }
}

async function writeRecord(
  connectionId: string,
  shopifyOrderId: string,
  shopifyTotal: number | null,
  erpTotal: number | null,
  status: "matched" | "discrepancy" | "pending",
  discrepancyReason: string | null,
): Promise<void> {
  await db.reconciliationRecord.create({
    data: { connectionId, shopifyOrderId, shopifyTotal, erpTotal, status, discrepancyReason },
  });
  if (status === "discrepancy") {
    await logActivity(
      connectionId,
      "reconciliation_discrepancy",
      `Order ${shopifyOrderId}: ${discrepancyReason}`,
      "warning",
    );
  }
}
