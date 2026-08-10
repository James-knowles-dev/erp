import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { requireAgencyUser } from "../utils/agencyAuth.server";
import { listClientsForAgency, redeemInviteCode, removeClientLink } from "../models/agency.server";

// Product spec §7.8: "agencies can view sync health across every client they manage from one
// place." Deliberately not a Polaris page -- this is outside the Shopify embedded admin entirely
// (an agency isn't a merchant, doesn't have a Shopify session), so it's a plain server-rendered
// page instead.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const agencyUser = await requireAgencyUser(request);
  const clients = await listClientsForAgency(agencyUser.agencyId);
  return { agencyName: agencyUser.agency.name, role: agencyUser.role, clients };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const agencyUser = await requireAgencyUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "link_client") {
    const code = String(formData.get("code") ?? "");
    try {
      await redeemInviteCode(agencyUser.agencyId, code);
      return { linked: true as const };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not redeem invite code." };
    }
  }

  if (intent === "remove_client") {
    const linkId = String(formData.get("linkId") ?? "");
    // 'staff' can't unlink a client, only owner/admin -- same split requireAgencyClientAccess uses.
    if (agencyUser.role !== "owner" && agencyUser.role !== "admin") {
      throw new Response("Only an owner or admin can remove a client.", { status: 403 });
    }
    await removeClientLink(agencyUser.agencyId, linkId);
    return { removed: true as const };
  }

  throw new Response("Unknown intent", { status: 400 });
};

type ClientRow = SerializeFrom<typeof loader>["clients"][number];

function statusLabel(connection: NonNullable<ClientRow["connection"]>) {
  if (connection.live) return "Live";
  if (connection.shadowing) return "Parallel run";
  if (connection.status === "active") return "Connected, not yet live";
  return connection.status;
}

export default function AgencyDashboard() {
  const { agencyName, clients } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [code, setCode] = useState("");

  return (
    <div style={{ maxWidth: 800, margin: "3rem auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{agencyName}</h1>
        <div>
          <Link to="/agency/mapping-templates">Mapping templates</Link>
          {" · "}
          <Form method="post" action="/agency/logout" style={{ display: "inline" }}>
            <button type="submit">Log out</button>
          </Form>
        </div>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Link a new client</h2>
        {actionData && "error" in actionData && <p style={{ color: "crimson" }}>{actionData.error}</p>}
        {actionData && "linked" in actionData && <p style={{ color: "green" }}>Client linked.</p>}
        <Form method="post" style={{ display: "flex", gap: "0.5rem" }}>
          <input type="hidden" name="intent" value="link_client" />
          <input
            name="code"
            placeholder="Invite code from your client"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ flex: 1 }}
          />
          <button type="submit">Link</button>
        </Form>
      </section>

      <section>
        <h2>Clients ({clients.length})</h2>
        {clients.length === 0 ? (
          <p>No clients linked yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th>Shop</th>
                <th>ERP</th>
                <th>Status</th>
                <th>Last sync</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.linkId} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{c.shopDomain}</td>
                  <td>{c.connection?.erpType ?? "--"}</td>
                  <td>{c.connection ? statusLabel(c.connection) : "Not connected"}</td>
                  <td>
                    {c.connection?.lastSuccessfulSyncAt
                      ? new Date(c.connection.lastSuccessfulSyncAt).toLocaleString()
                      : "--"}
                  </td>
                  <td>
                    <Link to={`/agency/reports/${c.shopId}`}>Report</Link>
                    {" · "}
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="remove_client" />
                      <input type="hidden" name="linkId" value={c.linkId} />
                      <button type="submit">Remove</button>
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
