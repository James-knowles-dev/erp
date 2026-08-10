import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, TextField, Banner, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, storePartialNetSuiteConfig } from "../models/connections.server";
import { buildAuthorizationUrl } from "../adapters/netsuite/auth.server";

function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/app/connect/netsuite/callback`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection) throw redirect("/app/connect");
  if (connection.status === "active") {
    throw redirect(`/app/connect/netsuite/environment?connectionId=${connectionId}`);
  }

  const error = new URL(request.url).searchParams.get("error");
  return { connectionId, error, redirectUri: redirectUri(request) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  const accountId = String(formData.get("accountId") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();

  if (!connectionId || !accountId || !clientId || !clientSecret) {
    throw new Response("Missing required fields", { status: 400 });
  }

  await storePartialNetSuiteConfig(connectionId, { accountId, clientId, clientSecret });

  const authorizeUrl = buildAuthorizationUrl(
    { accountId, clientId },
    redirectUri(request),
    connectionId,
  );
  return redirect(authorizeUrl);
};

export default function ConnectStepNetSuite() {
  const { connectionId, error, redirectUri: callbackUrl } = useLoaderData<typeof loader>();
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 2 of 4: Connect to NetSuite
                </Text>
                <Text as="p" variant="bodyMd">
                  You'll need an Integration record in your NetSuite account with{" "}
                  <strong>OAuth 2.0 Authorization Code Grant</strong> and{" "}
                  <strong>REST Web Services</strong> enabled. In NetSuite, go to{" "}
                  <strong>Setup &gt; Integration &gt; Manage Integrations &gt; New</strong>, and set
                  the redirect URI to:
                </Text>
                <Box padding="200" background="bg-surface-active" borderRadius="200">
                  <Text as="span" variant="bodyMd">
                    <code>{callbackUrl}</code>
                  </Text>
                </Box>
                {error && (
                  <Banner tone="critical" title="Connection failed">
                    <p>{error}</p>
                  </Banner>
                )}
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <BlockStack gap="300">
                    <TextField
                      label="NetSuite Account ID"
                      name="accountId"
                      value={accountId}
                      onChange={setAccountId}
                      autoComplete="off"
                      helpText='Found in NetSuite under Setup > Company > Company Information. Sandbox account IDs end in "_SB1".'
                      requiredIndicator
                    />
                    <TextField
                      label="Client ID"
                      name="clientId"
                      value={clientId}
                      onChange={setClientId}
                      autoComplete="off"
                      helpText="From your NetSuite Integration record."
                      requiredIndicator
                    />
                    <TextField
                      label="Client Secret"
                      name="clientSecret"
                      value={clientSecret}
                      onChange={setClientSecret}
                      type="password"
                      autoComplete="off"
                      helpText="Only shown once when the Integration record is created in NetSuite -- if you've lost it, reset it there first."
                      requiredIndicator
                    />
                    <Button submit variant="primary">
                      Connect to NetSuite
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
