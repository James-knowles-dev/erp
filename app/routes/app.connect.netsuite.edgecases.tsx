import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, ChoiceList } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, getEdgeCaseRules, saveEdgeCaseRules } from "../models/connections.server";

// Product spec §7.1 step 5: plain yes/no or multiple-choice questions, not technical settings.
// Only the two rule keys named as examples in erp-connector-dev-spec.md §5 are asked here --
// the full edge-case question set (e.g. order-edit handling, multi-currency rate source) is
// broader than what's built so far and left for a follow-up pass.
const QUESTIONS = [
  {
    key: "backorder_behavior",
    title: "If an order can't fully ship, what should happen?",
    default: "block",
    choices: [
      { label: "Block the order until it can be fully fulfilled", value: "block" },
      { label: "Allow it to oversell", value: "allow_oversell" },
    ],
  },
  {
    key: "guest_customer_handling",
    title: "If a customer doesn't exist yet in NetSuite, should we create one automatically?",
    default: "use_default_account",
    choices: [
      { label: "Yes, create a new NetSuite customer record", value: "create_erp_customer" },
      { label: "No, route to a default account instead", value: "use_default_account" },
    ],
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const saved = await getEdgeCaseRules(connectionId);
  return { connectionId, saved };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  if (!connectionId) throw new Response("Missing connectionId", { status: 400 });

  const rules: Record<string, string> = {};
  for (const q of QUESTIONS) {
    rules[q.key] = String(formData.get(q.key) ?? q.default);
  }

  await saveEdgeCaseRules(connectionId, rules);
  return redirect(`/app/connect/netsuite/backfill?connectionId=${connectionId}`);
};

export default function ConnectStepEdgeCases() {
  const { connectionId, saved } = useLoaderData<typeof loader>();
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(QUESTIONS.map((q) => [q.key, saved[q.key] ?? q.default])),
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
                  Step 5 of 8: Edge cases
                </Text>
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <BlockStack gap="400">
                    {QUESTIONS.map((q) => (
                      <ChoiceList
                        key={q.key}
                        title={q.title}
                        choices={q.choices}
                        selected={[answers[q.key]]}
                        onChange={([value]) => setAnswers((prev) => ({ ...prev, [q.key]: value }))}
                      />
                    ))}
                    {QUESTIONS.map((q) => (
                      <input key={q.key} type="hidden" name={q.key} value={answers[q.key]} />
                    ))}
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
