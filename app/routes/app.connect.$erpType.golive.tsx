import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Badge, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, markConnectionLive } from "../models/connections.server";
import { requireActiveBillingForGoLive } from "../utils/billing.server";
import { runBackfill } from "../sync/backfill.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const erpType = params.erpType!;
  const erpName = SUPPORTED_ERPS.find((e) => e.id === erpType)?.name ?? erpType;

  if (connection.wentLiveAt) {
    return { connectionId, alreadyLive: true, environment: connection.environment, erpName };
  }

  // May throw a redirect to Shopify's billing approval page; returnUrl brings the merchant back
  // to this exact loader afterward, where billing.require() then resolves normally.
  await requireActiveBillingForGoLive(request, new URL(request.url).toString());

  return { connectionId, alreadyLive: false, environment: connection.environment, erpName };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  if (!connectionId) throw new Response("Missing connectionId", { status: 400 });

  const connection = await getConnection(connectionId);
  if (!connection) throw new Response("Connection not found", { status: 404 });

  await markConnectionLive(connectionId);

  let backfillEnqueued = 0;
  if (connection.backfillWindow && connection.backfillWindow !== "none") {
    const result = await runBackfill(admin, connectionId, connection.backfillWindow);
    backfillEnqueued = result.enqueued;
  }

  return redirect(
    `/app/connect/${params.erpType}/golive?connectionId=${connectionId}&backfillEnqueued=${backfillEnqueued}`,
  );
};

export default function ConnectStepGoLive() {
  const { connectionId, alreadyLive, environment, erpName } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {alreadyLive ? (
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
                ) : (
                  <>
                    <Text as="h2" variant="headingMd">
                      Step 8 of 8: Go live
                    </Text>
                    <Text as="p" variant="bodyMd">
                      {`This flips your connection from dry-run to actually syncing orders to ${erpName} (${environment}). Billing starts now.`}
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="connectionId" value={connectionId} />
                      <Button submit variant="primary" tone="critical">
                        Go live
                      </Button>
                    </Form>
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
