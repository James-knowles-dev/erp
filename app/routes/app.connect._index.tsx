import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, InlineStack, Badge } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { createConnection, getActiveConnectionForShop, getOrCreateShop } from "../models/connections.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";

// Wizard step 1 (product spec §7.1 step 1): pick an ERP. All six adapters (NetSuite, Acumatica,
// Business Central, Sage Intacct, Sage 300, Brightpearl) are built as of Milestone 9 -- the
// `available` flag exists for the next one (SAP Business One, Milestone 10, conditional on
// demand) rather than any of the current six. The list itself lives in adapters/registry.server.ts,
// not here -- this route has no ERP-specific knowledge at all, which is the actual point of
// Milestone 5's wizard generalization: adding an ERP means one entry in that registry, not
// touching this file. That claim has now held for four more adapters past Business Central,
// including two (Sage Intacct, Sage 300) with a non-OAuth2 auth model -- see registry.server.ts's
// authType field.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // "Every step can be left and resumed" (product spec §7.1) -- if a connection already exists,
  // send the merchant back into the flow rather than letting them start a second one.
  //
  // connectionId must be included here -- app.connect.$erpType.tsx's loader requires it and
  // redirects back to /app/connect without it, which without this param would bounce straight
  // back here and redirect again: an infinite loop between the two routes. Found live on the
  // test store (server logs showed the same two URLs alternating every ~200ms), not caught by
  // any lint/typecheck/test/build check, since none of them exercise the "connection already
  // exists but has no credentials yet" resume path against a real request.
  const existing = await getActiveConnectionForShop(shop.id);
  if (existing) {
    // A closely related loop risk: credentialsEncrypted gets set as soon as step 2 stores the
    // partial config (before OAuth even completes), so it stays truthy even if the connection
    // later lands in 'error' status (e.g. testConnection failed in the callback). Sending an
    // 'error' connection to /mapping would just bounce it straight back here, since that route
    // requires status === 'active' -- so status is checked first, ahead of credentialsEncrypted.
    const nextStep =
      existing.status === "active" && existing.credentialsEncrypted ? "mapping" : null;
    throw redirect(
      nextStep
        ? `/app/connect/${existing.erpType}/${nextStep}?connectionId=${existing.id}`
        : `/app/connect/${existing.erpType}?connectionId=${existing.id}`,
    );
  }

  return { erps: SUPPORTED_ERPS };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const erpType = String(formData.get("erpType"));

  const erp = SUPPORTED_ERPS.find((e) => e.id === erpType);
  if (!erp?.available) {
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
