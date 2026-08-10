import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, ChoiceList } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, setBackfillWindow } from "../models/connections.server";

const CHOICES = [
  { label: "None -- only sync orders placed from now on", value: "none" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  return { connectionId, backfillWindow: connection.backfillWindow ?? "none" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  const backfillWindow = String(formData.get("backfillWindow") ?? "none");
  if (!connectionId) throw new Response("Missing connectionId", { status: 400 });

  await setBackfillWindow(connectionId, backfillWindow);
  return redirect(`/app/connect/netsuite/preflight?connectionId=${connectionId}`);
};

export default function ConnectStepBackfill() {
  const { connectionId, backfillWindow } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>([backfillWindow]);

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 6 of 8: Historical backfill
                </Text>
                <Text as="p" variant="bodyMd">
                  Orders placed before you go live can be synced too, so you're not starting from
                  a blank slate. Custom date ranges aren't supported yet -- 30 or 90 days covers
                  most cases for now.
                </Text>
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <input type="hidden" name="backfillWindow" value={selected[0] ?? "none"} />
                  <BlockStack gap="300">
                    <ChoiceList
                      title="Backfill window"
                      titleHidden
                      choices={CHOICES}
                      selected={selected}
                      onChange={setSelected}
                    />
                    <Button submit variant="primary">
                      Continue
                    </Button>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
