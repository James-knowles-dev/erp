import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, InlineStack, Badge } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createConnection, getActiveConnectionForShop, getOrCreateShop } from "../models/connections.server";

// Wizard step 1 (product spec §7.1 step 1): pick an ERP. Only NetSuite is built (Milestone 1);
// the others are shown so the picker doesn't look broken, but aren't selectable yet.
const SUPPORTED_ERPS = [
  { id: "netsuite", name: "NetSuite", available: true },
  { id: "acumatica", name: "Acumatica", available: false },
  { id: "business_central", name: "Business Central", available: false },
  { id: "sage_intacct", name: "Sage Intacct", available: false },
  { id: "sage_300", name: "Sage 300", available: false },
  { id: "brightpearl", name: "Brightpearl", available: false },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // "Every step can be left and resumed" (product spec §7.1) -- if a connection already exists,
  // send the merchant back into the flow rather than letting them start a second one.
  const existing = await getActiveConnectionForShop(shop.id);
  if (existing?.erpType === "netsuite") {
    throw redirect(existing.credentialsEncrypted ? "/app/connect/netsuite/mapping" : "/app/connect/netsuite");
  }

  return { erps: SUPPORTED_ERPS };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const erpType = formData.get("erpType");

  if (erpType !== "netsuite") {
    throw new Response("Unsupported ERP", { status: 400 });
  }

  const connection = await createConnection(shop.id, erpType);
  return redirect(`/app/connect/${connection.erpType}?connectionId=${connection.id}`);
};

export default function ConnectStepPickErp() {
  const { erps } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 1 of 4: Pick your ERP
                </Text>
                <BlockStack gap="200">
                  {erps.map((erp) => (
                    <InlineStack key={erp.id} align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        {erp.name}
                      </Text>
                      {erp.available ? (
                        <Form method="post">
                          <input type="hidden" name="erpType" value={erp.id} />
                          <Button submit variant="primary">
                            Select
                          </Button>
                        </Form>
                      ) : (
                        <Badge>Coming soon</Badge>
                      )}
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
