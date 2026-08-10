import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  TextField,
  Banner,
  IndexTable,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getConnection, getFieldMappings, saveFieldMappings } from "../models/connections.server";
import { getDefaultFieldMappings, validateMapping } from "../adapters/netsuite/mapping";
import type { FieldMapping } from "../adapters/types";

// Scoped-down first version of product spec §7.1 step 4: a single "Order" section (Customer/
// Product/Inventory default templates don't exist yet -- only Milestone 1 built order mappings),
// a plain editable text field per row rather than a dropdown enumerating NetSuite's schema (no
// schema introspection built yet), and no live preview value from a real order (needs the
// read_orders scope, not requested as of Milestone 0's least-privilege scope list). All named
// here rather than silently shipped as if this were the full spec'd experience.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) throw redirect("/app/connect");

  const connection = await getConnection(connectionId);
  if (!connection || connection.status !== "active") throw redirect("/app/connect");

  const saved = await getFieldMappings(connectionId);
  const mappings: FieldMapping[] =
    saved.length > 0
      ? saved.map((m) => ({
          shopifyField: m.shopifyField,
          erpField: m.erpField,
          transformRule: m.transformRule ?? undefined,
          isRequired: m.isRequired,
        }))
      : getDefaultFieldMappings().mappings;

  const issues = validateMapping(mappings);

  return { connectionId, mappings, issues };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const connectionId = String(formData.get("connectionId"));
  if (!connectionId) throw new Response("Missing connectionId", { status: 400 });

  const defaults = getDefaultFieldMappings().mappings;
  const mappings: FieldMapping[] = defaults.map((d) => ({
    ...d,
    erpField: String(formData.get(`mapping.${d.shopifyField}`) ?? d.erpField),
  }));

  const issues = validateMapping(mappings);
  if (issues.some((i) => i.severity === "error")) {
    // Re-render with errors rather than saving a mapping NetSuite would reject.
    return { connectionId, mappings, issues };
  }

  await saveFieldMappings(connectionId, mappings);
  return redirect(`/app/connect/netsuite/edgecases?connectionId=${connectionId}`);
};

export default function ConnectStepMapping() {
  const { connectionId, mappings, issues } = useLoaderData<typeof loader>();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(mappings.map((m) => [m.shopifyField, m.erpField])),
  );

  const errorFields = new Set(issues.filter((i) => i.severity === "error").map((i) => i.field));

  return (
    <Page>
      <TitleBar title="Connect your ERP" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Step 4 of 4: Field mapping
                </Text>
                <Text as="p" variant="bodyMd">
                  Every common field is pre-mapped to NetSuite's standard structure. Adjust the
                  target field on the right if your NetSuite setup uses something different.
                </Text>
                {errorFields.size > 0 && (
                  <Banner tone="critical" title="These fields need a mapping before you can continue">
                    <p>{Array.from(errorFields).join(", ")}</p>
                  </Banner>
                )}
                <Form method="post">
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <BlockStack gap="300">
                    <IndexTable
                      itemCount={mappings.length}
                      headings={[{ title: "Shopify field" }, { title: "NetSuite field" }]}
                      selectable={false}
                    >
                      {mappings.map((m, index) => (
                        <IndexTable.Row id={m.shopifyField} key={m.shopifyField} position={index}>
                          <IndexTable.Cell>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodyMd">
                                {m.shopifyField}
                              </Text>
                              {m.isRequired && <Badge tone={errorFields.has(m.shopifyField) ? "critical" : undefined}>Required</Badge>}
                            </BlockStack>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <TextField
                              label={`NetSuite field for ${m.shopifyField}`}
                              labelHidden
                              name={`mapping.${m.shopifyField}`}
                              value={values[m.shopifyField] ?? ""}
                              onChange={(value) =>
                                setValues((prev) => ({ ...prev, [m.shopifyField]: value }))
                              }
                              autoComplete="off"
                              error={errorFields.has(m.shopifyField)}
                            />
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                    <Button submit variant="primary">
                      Save mapping
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
