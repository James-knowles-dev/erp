import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireAgencyUser, requireAgencyClientAccess } from "../utils/agencyAuth.server";
import { getClientShop, getSyncReport, type SyncReport } from "../models/agency.server";
import { SUPPORTED_ERPS } from "../adapters/registry.server";

const REPORT_WINDOW_DAYS = 30;

// Declared explicitly rather than inferred via `typeof loader` -- this loader's return type is a
// union of a JSON payload and a plain CSV `Response` (the ?format=csv branch), and Remix's
// SerializeFrom/Jsonify utilities don't resolve nested array fields through that union correctly,
// collapsing them to `unknown` instead of their real shape. occurredAt is `string`, not `Date`,
// because that's what it actually is by the time it crosses the loader->component JSON boundary.
type ReportLoaderData = {
  agencyName: string;
  shopDomain: string;
  erpName: string | null;
  windowDays: number;
  report: {
    jobCounts: { status: string; count: number }[];
    reconciliationCounts: { status: string; count: number }[];
    recentErrors: { id: string; message: string; occurredAt: string }[];
  };
};

// White-label report export (product spec §7.8): a client-facing summary an agency can hand off,
// branded with the agency's own name rather than this app's -- no PDF generation library added for
// this; ?format=csv on the same URL returns the same data as CSV for the agency to embed in their
// own report, which covers "export" without a new dependency.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const agencyUser = await requireAgencyUser(request);
  const shopId = params.shopId!;
  await requireAgencyClientAccess(agencyUser, shopId);

  const shop = await getClientShop(shopId);
  if (!shop) throw new Response("Client not found.", { status: 404 });

  const connection = shop.erpConnections[0] ?? null;
  const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const report: SyncReport = connection
    ? await getSyncReport(connection.id, since)
    : { jobCounts: [], reconciliationCounts: [], recentErrors: [] };

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "csv") {
    const rows = [
      ["metric", "value"],
      ...report.jobCounts.map((r) => [`sync_jobs.${r.status}`, String(r.count)]),
      ...report.reconciliationCounts.map((r) => [`reconciliation.${r.status}`, String(r.count)]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${shop.shopifyDomain}-sync-report.csv"`,
      },
    });
  }

  return json({
    agencyName: agencyUser.agency.name,
    shopDomain: shop.shopifyDomain,
    erpName: connection ? SUPPORTED_ERPS.find((e) => e.id === connection.erpType)?.name ?? connection.erpType : null,
    windowDays: REPORT_WINDOW_DAYS,
    report,
  });
};

export default function AgencyClientReport() {
  const { agencyName, shopDomain, erpName, windowDays, report } = useLoaderData<ReportLoaderData>();

  return (
    <div style={{ maxWidth: 700, margin: "3rem auto", fontFamily: "system-ui" }}>
      <p>
        <Link to="/agency/dashboard">&larr; Dashboard</Link>
        {" · "}
        <a href="?format=csv">Download CSV</a>
      </p>
      <h1>{shopDomain} -- sync report</h1>
      <p style={{ color: "#666" }}>
        Prepared by {agencyName} · last {windowDays} days{erpName ? ` · ${erpName}` : ""}
      </p>

      {!erpName ? (
        <p>No active ERP connection for this client yet.</p>
      ) : (
        <>
          <h2>Sync jobs</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {report.jobCounts.map((r) => (
                <tr key={r.status}>
                  <td style={{ padding: "0.25rem 1rem 0.25rem 0" }}>{r.status}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
              {report.jobCounts.length === 0 && (
                <tr>
                  <td colSpan={2}>No sync activity in this window.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Reconciliation</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {report.reconciliationCounts.map((r) => (
                <tr key={r.status}>
                  <td style={{ padding: "0.25rem 1rem 0.25rem 0" }}>{r.status}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
              {report.reconciliationCounts.length === 0 && (
                <tr>
                  <td colSpan={2}>No reconciliation checks in this window.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Recent errors</h2>
          {report.recentErrors.length === 0 ? (
            <p>None.</p>
          ) : (
            <ul>
              {report.recentErrors.map((e) => (
                <li key={e.id}>
                  {new Date(e.occurredAt).toLocaleString()} -- {e.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
