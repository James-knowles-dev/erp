import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Badge, EmptyState, IndexTable } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getActiveConnectionForShop, getOrCreateShop } from "../models/connections.server";
import db from "../db.server";

const SEVERITY_TONE: Record<string, "info" | "warning" | "critical"> = {
  info: "info",
  warning: "warning",
  error: "critical",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const connection = await getActiveConnectionForShop(shop.id);

  if (!connection) {
    return { connected: false as const };
  }

  const [activity, discrepancies] = await Promise.all([
    db.activityLog.findMany({
      where: { connectionId: connection.id },
      orderBy: { occurredAt: "desc" },
      take: 50,
    }),
    db.reconciliationRecord.findMany({
      where: { connectionId: connection.id, status: "discrepancy" },
      orderBy: { checkedAt: "desc" },
      take: 50,
    }),
  ]);

  return {
    connected: true as const,
    activity: activity.map((a) => ({ ...a, occurredAt: a.occurredAt.toISOString() })),
    discrepancies: discrepancies.map((d) => ({
      ...d,
      checkedAt: d.checkedAt.toISOString(),
      shopifyTotal: d.shopifyTotal?.toString() ?? null,
      erpTotal: d.erpTotal?.toString() ?? null,
    })),
  };
};

// Product spec §7.6: "plain-language view of what synced, when, and what failed, usable by an
// ops person, not just a developer" -- plus the reconciliation discrepancies that job flags,
// grouped on the same page since the spec presents them together.
export default function Activity() {
  const data = useLoaderData<typeof loader>();

  if (!data.connected) {
    return (
      <Page>
        <TitleBar title="Activity" />
        <Card>
          <EmptyState heading="Connect an ERP to see activity" image="">
            <p>Sync and reconciliation activity will show up here once you've connected NetSuite.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Activity" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Reconciliation discrepancies
                </Text>
                {data.discrepancies.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    None found in the last check.
                  </Text>
                ) : (
                  <IndexTable
                    itemCount={data.discrepancies.length}
                    headings={[
                      { title: "Order" },
                      { title: "Shopify total" },
                      { title: "NetSuite total" },
                      { title: "Reason" },
                      { title: "Checked" },
                    ]}
                    selectable={false}
                  >
                    {data.discrepancies.map((d, index) => (
                      <IndexTable.Row id={d.id} key={d.id} position={index}>
                        <IndexTable.Cell>{d.shopifyOrderId}</IndexTable.Cell>
                        <IndexTable.Cell>{d.shopifyTotal ?? "--"}</IndexTable.Cell>
                        <IndexTable.Cell>{d.erpTotal ?? "--"}</IndexTable.Cell>
                        <IndexTable.Cell>{d.discrepancyReason}</IndexTable.Cell>
                        <IndexTable.Cell>{new Date(d.checkedAt).toLocaleString()}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Recent activity
                </Text>
                <BlockStack gap="200">
                  {data.activity.map((entry) => (
                    <BlockStack gap="050" key={entry.id}>
                      <Badge tone={SEVERITY_TONE[entry.severity]}>{entry.eventType}</Badge>
                      <Text as="p" variant="bodyMd">
                        {entry.message}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {new Date(entry.occurredAt).toLocaleString()}
                      </Text>
                    </BlockStack>
                  ))}
                  {data.activity.length === 0 && (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Nothing has synced yet.
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
