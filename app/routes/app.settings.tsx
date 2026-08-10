import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActiveConnectionForShop, getOrCreateShop } from "../models/connections.server";
import { generateApiKey, setApiKey } from "../utils/apiKey.server";
import { listWebhookSubscriptions } from "../sync/webhookSubscriptions.server";
import { EVENT_TYPES } from "../sync/webhookEventTypes";

// Product spec §7.7 (extensibility): the API key and event list an agency needs to build custom
// logic against this connection. Registering a webhook subscription itself is done via the API
// (POST /api/webhooks) by the agency's own script, not a form here -- this page is where the
// credential to do that comes from, and a read-only view of what's currently registered.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const connection = await getActiveConnectionForShop(shop.id);

  if (!connection) return { connected: false as const };

  const subscriptions = await listWebhookSubscriptions(connection.id);
  return {
    connected: true as const,
    hasApiKey: Boolean(connection.apiKeyHash),
    subscriptions,
    apiBaseUrl: new URL(request.url).origin,
  };
};

// Regenerating invalidates the old key immediately -- any agency script using it starts getting
// 401s until updated with the new one shown here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const connection = await getActiveConnectionForShop(shop.id);
  if (!connection) throw new Response("No active connection", { status: 400 });

  const key = generateApiKey();
  await setApiKey(connection.id, key);
  return { newApiKey: key };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!data.connected) {
    return (
      <Page>
        <TitleBar title="Settings" />
        <Card>
          <Text as="p" variant="bodyMd">
            Connect an ERP first -- API access and webhook subscriptions are scoped to a
            connection.
          </Text>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  API access
                </Text>
                <Text as="p" variant="bodyMd">
                  For an agency's own scripts to subscribe to events or read synced order data
                  against the canonical model, not the ERP's native API directly (product spec
                  §7.7). Send it as{" "}
                  <code>Authorization: Bearer &lt;key&gt;</code> against{" "}
                  <code>{data.apiBaseUrl}/api/*</code>.
                </Text>
                {actionData?.newApiKey && (
                  <Banner tone="warning" title="Copy this key now -- it won't be shown again">
                    <Text as="p" variant="bodyMd">
                      <code>{actionData.newApiKey}</code>
                    </Text>
                  </Banner>
                )}
                <Form method="post">
                  <Button submit variant={data.hasApiKey ? "secondary" : "primary"}>
                    {data.hasApiKey ? "Regenerate API key" : "Generate API key"}
                  </Button>
                </Form>
                {data.hasApiKey && !actionData?.newApiKey && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    A key already exists. Regenerating immediately invalidates it.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Registered webhook subscriptions
                </Text>
                <Text as="p" variant="bodyMd">
                  Available event types: {EVENT_TYPES.join(", ")}. Register via{" "}
                  <code>POST {data.apiBaseUrl}/api/webhooks</code>.
                </Text>
                {data.subscriptions.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    None registered yet.
                  </Text>
                ) : (
                  <List type="bullet">
                    {data.subscriptions.map((s) => (
                      <List.Item key={s.id}>
                        {s.url} ({s.eventTypes.join(", ")})
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
