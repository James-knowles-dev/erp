import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, ChoiceList, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, loadErpCredentials, setConnectionStatus, storeErpCredentials } from "../models/connections.server";
import { listCompanies } from "../adapters/businesscentral/auth.server";
import { createAdapter, getAuthType } from "../adapters/registry.server";

// Business Central-only step, inserted between the OAuth callback and step 3 (environment) --
// see app.connect.$erpType.callback.tsx's business_central branch for why this exists: companyId
// is an internal GUID with no UI path to find it, so we detect it via the companies API using the
// access token we just obtained, and only land here at all if that lookup found more than one.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  // Already resolved (e.g. the merchant reloaded this page after finishing, or came back via the
  // browser's back button) -- nothing left to pick, move them on rather than show a stale form.
  if (!connection || connection.status === "active") {
    throw redirect(`/app/connect/business_central/environment?connectionId=${connectionId}`);
  }

  const credentials = await loadErpCredentials(connectionId);
  if (!credentials?.tenantId || !credentials.environment || !credentials.accessToken) {
    throw redirect(`/app/connect/business_central?connectionId=${connectionId}`);
  }

  const error = new URL(request.url).searchParams.get("error");
  const companies = await listCompanies(credentials.tenantId, credentials.environment, credentials.accessToken);
  return { connectionId, companies, error };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  const companyId = String(formData.get("companyId") ?? "");

  const credentials = await loadErpCredentials(connectionId);
  if (!connectionId || !companyId || !credentials?.tenantId || !credentials.environment || !credentials.accessToken) {
    throw new Response("Missing required fields", { status: 400 });
  }

  // Re-validate against a fresh lookup rather than trusting the submitted id outright -- cheap,
  // and closes the gap where a stale/tampered value could otherwise reach storeErpCredentials.
  const companies = await listCompanies(credentials.tenantId, credentials.environment, credentials.accessToken);
  if (!companies.some((c) => c.id === companyId)) {
    return redirect(
      `/app/connect/business_central/company?connectionId=${connectionId}&error=${encodeURIComponent("That company is no longer available -- please pick again.")}`,
    );
  }

  const fullCredentials = { ...credentials, companyId };
  await storeErpCredentials(connectionId, fullCredentials);

  const adapter = createAdapter("business_central");
  await adapter.authenticate({ authType: getAuthType("business_central"), values: fullCredentials });
  const test = await adapter.testConnection();
  if (!test.success) {
    await setConnectionStatus(connectionId, "error");
    return redirect(
      `/app/connect/business_central/company?connectionId=${connectionId}&error=${encodeURIComponent(test.message ?? "Connected, but the test request failed.")}`,
    );
  }

  return redirect(`/app/connect/business_central/environment?connectionId=${connectionId}`);
};

export default function ConnectBusinessCentralCompany() {
  const { connectionId, companies, error } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>(companies[0] ? [companies[0].id] : []);

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Which company?
                </Text>
                <Text as="p" variant="bodyMd">
                  This Business Central environment has more than one company. Pick the one you want
                  Shopify orders synced into.
                </Text>
                {error && (
                  <Banner tone="critical" title="Connection failed">
                    <p>{error}</p>
                  </Banner>
                )}
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <input type="hidden" name="companyId" value={selected[0] ?? ""} />
                  <BlockStack gap="300">
                    <ChoiceList
                      title="Company"
                      titleHidden
                      choices={companies.map((c) => ({ label: c.name, value: c.id }))}
                      selected={selected}
                      onChange={setSelected}
                    />
                    <Button submit variant="primary" disabled={!selected[0]}>
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
