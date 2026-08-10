import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { requireAgencyUser, requireAgencyClientAccess } from "../utils/agencyAuth.server";
import {
  listClientsForAgency,
  listMappingTemplates,
  createMappingTemplate,
  deleteMappingTemplate,
} from "../models/agency.server";
import { getActiveConnectionForShop, getFieldMappings } from "../models/connections.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";
import type { FieldMapping } from "../adapters/types";

// Product spec §7.8: "save a field mapping as a reusable template for future clients on the same
// ERP." Templates are created by snapshotting an already-configured client's saved field mapping
// (app.connect.$erpType.mapping.tsx), not authored from scratch here -- an agency always has at
// least one real client to base it on by the time this is useful.
// erpName is resolved here, not in the component -- SUPPORTED_ERPS lives in adapters/registry.server
// and Remix's Vite plugin refuses to bundle a `.server` import that's still reachable from a
// route's client component after loader/action stripping (see other routes' identical
// loader-side `erpName` pattern, e.g. app.settings.tsx).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const agencyUser = await requireAgencyUser(request);
  const [templates, clients] = await Promise.all([
    listMappingTemplates(agencyUser.agencyId),
    listClientsForAgency(agencyUser.agencyId),
  ]);
  const clientsWithMappings = clients
    .filter((c) => c.connection && c.connection.status === "active")
    .map((c) => ({
      ...c,
      connection: c.connection
        ? {
            ...c.connection,
            erpName: SUPPORTED_ERPS.find((e) => e.id === c.connection!.erpType)?.name ?? c.connection!.erpType,
          }
        : null,
    }));
  const templatesWithErpName = templates.map((t) => ({
    ...t,
    erpName: SUPPORTED_ERPS.find((e) => e.id === t.erpType)?.name ?? t.erpType,
  }));
  return { templates: templatesWithErpName, clients: clientsWithMappings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const agencyUser = await requireAgencyUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create_from_client") {
    const shopId = String(formData.get("shopId") ?? "");
    await requireAgencyClientAccess(agencyUser, shopId);

    const connection = await getActiveConnectionForShop(shopId);
    if (!connection) {
      return { error: "This client has no active connection to snapshot a mapping from." };
    }

    const saved = await getFieldMappings(connection.id);
    if (saved.length === 0) {
      return { error: "This client has no saved field mapping to snapshot yet." };
    }

    const template: FieldMapping[] = saved.map((m) => ({
      shopifyField: m.shopifyField,
      erpField: m.erpField,
      transformRule: m.transformRule ?? undefined,
      isRequired: m.isRequired,
    }));
    await createMappingTemplate(agencyUser.agencyId, connection.erpType, template, connection.id);
    return { created: true as const };
  }

  if (intent === "delete_template") {
    const templateId = String(formData.get("templateId") ?? "");
    await deleteMappingTemplate(agencyUser.agencyId, templateId);
    return { deleted: true as const };
  }

  throw new Response("Unknown intent", { status: 400 });
};

export default function AgencyMappingTemplates() {
  const { templates, clients } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{ maxWidth: 800, margin: "3rem auto", fontFamily: "system-ui" }}>
      <p>
        <Link to="/agency/dashboard">&larr; Dashboard</Link>
      </p>
      <h1>Mapping templates</h1>
      <p>
        New clients on the same ERP are pre-filled from your most recent template for that ERP
        (see app.connect.$erpType.mapping.tsx) instead of the generic defaults.
      </p>

      {actionData && "error" in actionData && <p style={{ color: "crimson" }}>{actionData.error}</p>}

      <section style={{ marginBottom: "2rem" }}>
        <h2>Save a template from an existing client</h2>
        {clients.length === 0 ? (
          <p>No linked clients have an active connection with a saved mapping yet.</p>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create_from_client" />
            <select name="shopId" defaultValue="">
              <option value="" disabled>
                Choose a client
              </option>
              {clients.map((c) => (
                <option key={c.linkId} value={c.shopId}>
                  {c.shopDomain} ({c.connection!.erpName})
                </option>
              ))}
            </select>
            <button type="submit">Save as template</button>
          </Form>
        )}
      </section>

      <section>
        <h2>Saved templates ({templates.length})</h2>
        {templates.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th>ERP</th>
                <th>Fields</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{t.erpName}</td>
                  <td>{(t.template as unknown as FieldMapping[]).length}</td>
                  <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="delete_template" />
                      <input type="hidden" name="templateId" value={t.id} />
                      <button type="submit">Delete</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
