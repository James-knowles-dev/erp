import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { Page, Layout, Text, Card, BlockStack, Badge, InlineStack, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

// Home route. The wizard's first four steps (ERP select, connect, environment, field mapping)
// are live as of Milestone 2 -- steps 5-8 (edge-case rules, backfill, preflight, go live) and
// the sync engine are Milestone 3, still ahead.
export default function Index() {
  const navigate = useNavigate();

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
                    Connect your ERP
                  </Text>
                  <Badge>Steps 1-4 of 8</Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  Pick your ERP, connect, choose an environment, and map your fields. Going live
                  (steps 5-8) isn't built yet.
                </Text>
                {/* Not Button url=... -- that renders a plain <a>, and a real navigation inside
                    Shopify's embedded admin iframe hits a Permissions-Policy violation ("unload
                    is not allowed in this document"), so the click silently does nothing.
                    useNavigate() does client-side routing instead, no real page unload. */}
                <Button onClick={() => navigate("/app/connect")} variant="primary">
                  Start setup
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
