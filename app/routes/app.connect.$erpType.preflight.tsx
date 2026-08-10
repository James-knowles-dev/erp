import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, List } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, getFieldMappings } from "../models/connections.server";
import { getDefaultFieldMappings } from "../adapters/registry.server";
import { runPreflightCheck } from "../sync/preflight.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const erpType = params.erpType!;
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const saved = await getFieldMappings(connectionId);
  const mapping =
    saved.length > 0
      ? saved.map((m) => ({
          shopifyField: m.shopifyField,
          erpField: m.erpField,
          transformRule: m.transformRule ?? undefined,
          isRequired: m.isRequired,
        }))
      : getDefaultFieldMappings(erpType).mappings;

  const report = await runPreflightCheck(admin, connection.shopId, connectionId, erpType, mapping);

  return { connectionId, erpType, report };
};

export default function ConnectStepPreflight() {
  const { connectionId, erpType, report } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 7 of 8: Pre-flight check
                </Text>
                <Text as="p" variant="bodyMd">
                  {report.cleanCount} of your last {report.totalChecked} orders would sync
                  cleanly.{" "}
                  {report.issues.length > 0
                    ? `${report.issues.length} would need attention.`
                    : ""}
                </Text>
                {report.issues.length > 0 && (
                  <Banner tone="warning" title="Orders that would need attention">
                    <BlockStack gap="200">
                      {report.issues.map((issue) => (
                        <div key={issue.orderName}>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {issue.orderName}
                          </Text>
                          <List type="bullet">
                            {issue.reasons.map((reason) => (
                              <List.Item key={reason}>{reason}</List.Item>
                            ))}
                          </List>
                        </div>
                      ))}
                    </BlockStack>
                  </Banner>
                )}
                {/* See app._index.tsx's comment: Button url=... triggers a real navigation that
                    Shopify's embedded admin blocks (Permissions-Policy: unload). */}
                <Button
                  onClick={() => navigate(`/app/connect/${erpType}/golive?connectionId=${connectionId}`)}
                  variant="primary"
                >
                  Continue
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
