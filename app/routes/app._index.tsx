import type { LoaderFunctionArgs } from "@remix-run/node";
import { Page, Layout, Text, Card, BlockStack, Badge, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

// Placeholder Home route for Milestone 0 (app scaffold, OAuth, embedded shell, billing plumbing).
// The actual onboarding wizard (ERP select, connect, mapping, etc.) is Milestone 2-3 scope --
// see erp-connector-spec.md §7.1 and erp-connector-build-plan.md.
export default function Index() {
  return (
    <Page>
      <TitleBar title="ERP Connector" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Setup wizard
                  </Text>
                  <Badge>Coming soon</Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  The ERP connection wizard (pick your ERP, connect, map fields, go live) isn't
                  built yet -- this milestone only covers the app scaffold, OAuth install, and
                  billing plumbing it will run inside.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
