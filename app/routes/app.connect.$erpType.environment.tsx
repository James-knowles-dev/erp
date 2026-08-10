import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, ChoiceList } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, setEnvironment } from "../models/connections.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const erpType = params.erpType!;
  const erpName = SUPPORTED_ERPS.find((e) => e.id === erpType)?.name ?? erpType;
  return { connectionId, environment: connection.environment, erpType, erpName };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  const environment = String(formData.get("environment"));

  if (!connectionId || (environment !== "sandbox" && environment !== "production")) {
    throw new Response("Invalid request", { status: 400 });
  }

  await setEnvironment(connectionId, environment);
  return redirect(`/app/connect/${params.erpType}/mapping?connectionId=${connectionId}`);
};

export default function ConnectStepEnvironment() {
  const { connectionId, environment, erpName } = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>([environment]);

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 3 of 4: Choose environment
                </Text>
                <Text as="p" variant="bodyMd">
                  {`Start in sandbox so nothing syncs to your live ${erpName} data until you're confident it's working. You can switch to production any time before going live.`}
                </Text>
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <input type="hidden" name="environment" value={selected[0] ?? "sandbox"} />
                  <BlockStack gap="300">
                    <ChoiceList
                      title="Environment"
                      titleHidden
                      choices={[
                        { label: "Sandbox (recommended to start)", value: "sandbox" },
                        { label: "Production", value: "production" },
                      ]}
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
