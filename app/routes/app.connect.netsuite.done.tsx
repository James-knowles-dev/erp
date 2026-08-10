import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Badge, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection } from "../models/connections.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  return { environment: connection.environment };
};

// End of Milestone 2 (wizard steps 1-4). Steps 5-8 (edge-case rules, backfill window, preflight
// check, go live) and the sync engine that would make any of this actually push orders are
// Milestone 3 -- this page is an honest stopping point, not a "you're fully set up" claim.
export default function ConnectDone() {
  const { environment } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Connected to NetSuite ({environment})
                  </Text>
                  <Badge tone="success">Mapping saved</Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Steps 1-4 are done: your NetSuite account is connected and your field mapping is
                  saved. Edge-case rules, historical backfill, the pre-flight check, and actually
                  syncing orders (steps 5-8) aren't built yet -- that's the next milestone.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
