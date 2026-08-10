import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, List, InlineStack, Badge } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getActiveConnectionForShop,
  getOrCreateShop,
  setConnectionStatus,
} from "../models/connections.server";
import { generateApiKey, setApiKey } from "../utils/apiKey.server";
import { listWebhookSubscriptions } from "../sync/webhookSubscriptions.server";
import { EVENT_TYPES } from "../sync/webhookEventTypes";
import { SUPPORTED_ERPS } from "../adapters/registry.server";
import { generateInviteCode, getAgencyLinkForShop } from "../models/agency.server";

// Product spec §7.7 (extensibility): the API key and event list an agency needs to build custom
// logic against this connection. Registering a webhook subscription itself is done via the API
// (POST /api/webhooks) by the agency's own script, not a form here -- this page is where the
// credential to do that comes from, and a read-only view of what's currently registered.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const connection = await getActiveConnectionForShop(shop.id);

  // Agency linking (Milestone 8) isn't scoped to a connection like the API key/webhooks below --
  // a merchant can generate an invite code before ever connecting an ERP -- so it's read
  // regardless of `connection`.
  const agencyLink = await getAgencyLinkForShop(shop.id);
  const agency = {
    linkedAgencyName: agencyLink?.agency.name ?? null,
    pendingInviteCode: !agencyLink && !shop.agencyInviteCodeUsedAt ? shop.agencyInviteCode : null,
  };

  if (!connection) return { connected: false as const, agency };

  const subscriptions = await listWebhookSubscriptions(connection.id);
  return {
    connected: true as const,
    erpName: SUPPORTED_ERPS.find((e) => e.id === connection.erpType)?.name ?? connection.erpType,
    environment: connection.environment,
    status: connection.status,
    hasApiKey: Boolean(connection.apiKeyHash),
    subscriptions,
    apiBaseUrl: new URL(request.url).origin,
    agency,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "generate_invite_code") {
    // Not scoped to a connection -- a merchant can invite an agency before picking an ERP.
    const code = await generateInviteCode(shop.id);
    return { newInviteCode: code };
  }

  const connection = await getActiveConnectionForShop(shop.id);
  if (!connection) throw new Response("No active connection", { status: 400 });

  if (intent === "disconnect") {
    // Sets status: 'disabled' rather than deleting the row -- sync_jobs, activity_log, and
    // reconciliation_records stay intact as an audit trail. getActiveConnectionForShop and the
    // webhook receiver already filter out 'disabled' connections (dev spec §5's status enum),
    // so this alone is enough to both stop new syncs and let the merchant pick a fresh ERP from
    // /app/connect -- no other code needed to change to support this.
    await setConnectionStatus(connection.id, "disabled");
    return redirect("/app/connect");
  }

  // Regenerating invalidates the old key immediately -- any agency script using it starts
  // getting 401s until updated with the new one shown here.
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
        <BlockStack gap="500">
          <Card>
            <Text as="p" variant="bodyMd">
              Connect an ERP first -- API access and webhook subscriptions are scoped to a
              connection.
            </Text>
          </Card>
          <AgencyCard agency={data.agency} newInviteCode={actionData && "newInviteCode" in actionData ? actionData.newInviteCode : undefined} />
        </BlockStack>
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
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Connection
                  </Text>
                  <Badge
                    tone={
                      data.status === "active" ? "success" : data.status === "error" ? "critical" : "info"
                    }
                  >
                    {`${data.erpName} (${data.environment}) -- ${data.status}`}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Disconnecting stops any further syncing and lets you pick a different ERP from
                  scratch. Past sync activity and reconciliation history aren't deleted.
                </Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="disconnect" />
                  <Button submit variant="secondary" tone="critical">
                    Disconnect
                  </Button>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
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
                {actionData && "newApiKey" in actionData && (
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
                {data.hasApiKey && !(actionData && "newApiKey" in actionData) && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    A key already exists. Regenerating immediately invalidates it.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <AgencyCard agency={data.agency} newInviteCode={actionData && "newInviteCode" in actionData ? actionData.newInviteCode : undefined} />
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

// Shared between the connected and not-connected layouts -- an agency invite isn't gated on
// having an ERP connection, so this can't live inside the connection-specific Layout.Section tree.
function AgencyCard({
  agency,
  newInviteCode,
}: {
  agency: { linkedAgencyName: string | null; pendingInviteCode: string | null };
  newInviteCode?: string;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Agency access
        </Text>
        {agency.linkedAgencyName ? (
          <Text as="p" variant="bodyMd">
            Linked to <strong>{agency.linkedAgencyName}</strong>. They can view sync health and
            apply mapping templates to this connection.
          </Text>
        ) : (
          <>
            <Text as="p" variant="bodyMd">
              Working with an agency? Generate a one-time invite code and share it with them --
              they'll enter it on their end to link this shop. The code is single-use.
            </Text>
            {(newInviteCode ?? agency.pendingInviteCode) && (
              <Banner tone="info" title="Share this code with your agency">
                <Text as="p" variant="bodyMd">
                  <code>{newInviteCode ?? agency.pendingInviteCode}</code>
                </Text>
              </Banner>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="generate_invite_code" />
              <Button submit variant={agency.pendingInviteCode ? "secondary" : "primary"}>
                {agency.pendingInviteCode ? "Generate new code" : "Generate invite code"}
              </Button>
            </Form>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
