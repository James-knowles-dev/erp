import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Badge, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, markConnectionLive, startParallelRun } from "../models/connections.server";
import { requireActiveBillingForGoLive } from "../utils/billing.server";
import { runBackfill } from "../sync/backfill.server";
import { runReconciliationForConnection } from "../sync/reconciliation.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";

type ConnectionStatus = "not_started" | "shadow" | "live";

function connectionStatus(connection: { wentLiveAt: Date | null; shadowModeStartedAt: Date | null }): ConnectionStatus {
  if (connection.wentLiveAt) return "live";
  if (connection.shadowModeStartedAt) return "shadow";
  return "not_started";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const erpType = params.erpType!;
  const erpName = SUPPORTED_ERPS.find((e) => e.id === erpType)?.name ?? erpType;

  // No billing check here -- viewing this page, and starting parallel-run mode, must both stay
  // free (product spec §9). Billing is only required in the action, and only for the go_live/
  // cutover intent specifically (see below).
  return {
    connectionId,
    status: connectionStatus(connection),
    environment: connection.environment,
    erpName,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const erpType = params.erpType!;
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  const intent = formData.get("intent");
  if (!connectionId) throw new Response("Missing connectionId", { status: 400 });

  const connection = await getConnection(connectionId);
  if (!connection) throw new Response("Connection not found", { status: 404 });

  if (intent === "start_parallel_run") {
    // Milestone 7 (dev spec §14): shadow-syncs without pushing or billing -- see worker.server.ts.
    await startParallelRun(connectionId);
    return redirect(`/app/connect/${erpType}/golive?connectionId=${connectionId}`);
  }

  // go_live (fresh) or cutover (from shadow mode) -- same billing gate either way. May throw a
  // redirect to Shopify's billing approval page; returnUrl brings the merchant back to this page
  // (GET, so the loader renders normally) rather than completing go-live in the same click if
  // billing wasn't already active. A second click after approving finishes the job.
  await requireActiveBillingForGoLive(request, new URL(request.url).toString());

  const wasShadowing = Boolean(connection.shadowModeStartedAt) && !connection.wentLiveAt;
  await markConnectionLive(connectionId);

  let backfillEnqueued = 0;
  if (connection.backfillWindow && connection.backfillWindow !== "none") {
    const result = await runBackfill(admin, connectionId, connection.backfillWindow);
    backfillEnqueued = result.enqueued;
  }

  if (wasShadowing) {
    // dev spec §14's cutover checklist: "the reconciliation job immediately running against the
    // cutover window to catch anything that fell in the gap between the two systems," rather
    // than waiting for the next scheduled 15-minute tick (scheduler.server.ts).
    const live = await getConnection(connectionId);
    if (live) await runReconciliationForConnection(admin, live);
  }

  return redirect(
    `/app/connect/${erpType}/golive?connectionId=${connectionId}&backfillEnqueued=${backfillEnqueued}`,
  );
};

export default function ConnectStepGoLive() {
  const { connectionId, status, environment, erpName } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {status === "live" && (
                  <>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        You're live
                      </Text>
                      <Badge tone="success">{`Syncing to ${erpName} (${environment})`}</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodyMd">
                      New orders will sync automatically from here. Check the Activity page for
                      sync status and reconciliation results.
                    </Text>
                  </>
                )}

                {status === "shadow" && (
                  <>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Parallel-run mode
                      </Text>
                      <Badge tone="info">{`Shadow-syncing to ${erpName} (${environment})`}</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodyMd">
                      Orders are being transformed and logged to the Activity page, but nothing is
                      being pushed to {erpName} yet -- compare against your existing connector's
                      output there. When you're confident, cut over below. Billing starts at
                      cutover, and the reconciliation job runs immediately against the cutover
                      window to catch anything that fell in the gap.
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="connectionId" value={connectionId} />
                      <input type="hidden" name="intent" value="go_live" />
                      <Button submit variant="primary" tone="critical">
                        Cut over to live
                      </Button>
                    </Form>
                  </>
                )}

                {status === "not_started" && (
                  <>
                    <Text as="h2" variant="headingMd">
                      Step 8 of 8: Go live
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {`Migrating off an existing connector? Start a parallel run first -- orders are transformed and logged for comparison, but nothing is pushed to ${erpName} or billed, until you cut over. Otherwise, go live directly.`}
                    </Text>
                    <InlineStack gap="300">
                      <Form method="post">
                        <input type="hidden" name="connectionId" value={connectionId} />
                        <input type="hidden" name="intent" value="start_parallel_run" />
                        <Button submit variant="secondary">
                          Start parallel run
                        </Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="connectionId" value={connectionId} />
                        <input type="hidden" name="intent" value="go_live" />
                        <Button submit variant="primary" tone="critical">
                          Go live
                        </Button>
                      </Form>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
