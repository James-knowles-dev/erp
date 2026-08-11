import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, TextField, Banner, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, storePartialErpConfig } from "../models/connections.server";
import { buildAuthorizationUrl, getConnectFormFields, getConnectIntro } from "../adapters/registry.server";
import { validateExternalUrl } from "../utils/urlSafety.server";

function redirectUri(request: Request, erpType: string): string {
  return `${new URL(request.url).origin}/app/connect/${erpType}/callback`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const erpType = params.erpType!;
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection) throw redirect("/app/connect");
  if (connection.status === "active") {
    throw redirect(`/app/connect/${erpType}/environment?connectionId=${connectionId}`);
  }

  const error = new URL(request.url).searchParams.get("error");
  return {
    connectionId,
    error,
    redirectUri: redirectUri(request, erpType),
    fields: getConnectFormFields(erpType),
    intro: getConnectIntro(erpType),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const erpType = params.erpType!;
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));

  const fields = getConnectFormFields(erpType);
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.name] = String(formData.get(field.name) ?? "").trim();
  }

  if (!connectionId || Object.values(values).some((v) => !v)) {
    throw new Response("Missing required fields", { status: 400 });
  }

  // SSRF guard (erp-connector-fixes-spec.md F3): "url" fields (Acumatica's instanceUrl, Sage
  // 300's serverUrl) are a merchant-supplied host the server later sends authenticated requests
  // to -- reject anything that isn't a public https:// host before it's ever persisted.
  for (const field of fields) {
    if (field.type !== "url") continue;
    const result = await validateExternalUrl(values[field.name]);
    if (!result.valid) {
      throw new Response(`${field.label}: ${result.reason}`, { status: 400 });
    }
  }

  await storePartialErpConfig(connectionId, values);

  const authorizeUrl = buildAuthorizationUrl(erpType, values, redirectUri(request, erpType), connectionId);
  return redirect(authorizeUrl);
};

export default function ConnectStepErp() {
  const { connectionId, error, redirectUri: callbackUrl, fields, intro } = useLoaderData<typeof loader>();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ""])),
  );

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {`Step 2 of 4: Connect to ${intro.name}`}
                </Text>
                <Text as="p" variant="bodyMd">
                  {intro.instructions}
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
                    {fields.map((field) => (
                      <TextField
                        key={field.name}
                        label={field.label}
                        name={field.name}
                        value={values[field.name] ?? ""}
                        onChange={(value) => setValues((prev) => ({ ...prev, [field.name]: value }))}
                        type={field.type}
                        autoComplete="off"
                        helpText={field.helpText}
                        requiredIndicator
                      />
                    ))}
                    <Button submit variant="primary">
                      {`Connect to ${intro.name}`}
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
