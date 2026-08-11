// Low-level authenticated Sage 300 Web API client. Endpoint paths verified against Sage's "Sage
// 300 Web API Developer Reference" and "Endpoint Reference" PDFs plus 2024-2025 community sources
// (2026-08-10 research) except where flagged TODO(D4) -- not yet exercised against a live install.
// See decision D4 in README.md's Build Plan.

import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { Sage300ItemIdMap } from "./types";
import { fetchWithErpRetry } from "../shared/httpRetry.server";

export class Sage300Client {
  private readonly baseUrl: string; // {serverUrl}/v1.0/-/{company}
  private readonly authHeader: string;

  constructor(serverUrl: string, company: string, authHeader: string) {
    this.baseUrl = `${serverUrl.replace(/\/$/, "")}/v1.0/-/${company}`;
    this.authHeader = authHeader;
  }

  // No onUnauthorized here -- Sage 300 uses Basic Auth (username/password), not a token, so a 401
  // means the stored credentials themselves are wrong, not expired. Nothing to refresh; retrying
  // would just fail the same way. 429/network retry still applies via fetchWithErpRetry.
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchWithErpRetry(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    const response = await this.request("/IC/ICItems?$top=1");
    if (response.ok) return { success: true };
    return { success: false, message: `Sage 300 returned ${response.status}: ${await response.text()}` };
  }

  // Sage 300's ItemNumber is normally the SKU itself -- this confirms each SKU actually exists as
  // an item rather than resolving a distinct internal id, same reasoning as Sage Intacct's
  // resolveItemIds.
  async resolveItemIds(skus: string[]): Promise<Sage300ItemIdMap> {
    const map: Sage300ItemIdMap = {};
    for (const sku of skus) {
      const response = await this.request(`/IC/ICItems('${sku.replace(/'/g, "''")}')`);
      if (response.ok) map[sku] = sku;
    }
    return map;
  }

  // TODO(D4): Sage 300's ARCustomers resource is confirmed keyed by CustomerNumber, not email
  // (2026-08-10 research found no email-based lookup on the base object). This filter against a
  // contact sub-resource's email field is a best-effort guess at OData navigation-property syntax,
  // not confirmed against a live install or Sage's schema -- if it 404s/400s on a real server, this
  // should be treated the same as "not found" (see the adapter's pushOrder, which already handles
  // an unresolved customer the same way every other adapter does).
  async findCustomerNumberByEmail(email: string): Promise<string | null> {
    try {
      const response = await this.request(
        `/AR/ARCustomers?$filter=Contacts/any(c:c/EmailAddress eq '${email.replace(/'/g, "''")}')`,
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { value?: { CustomerNumber: string }[] };
      return data.value?.[0]?.CustomerNumber ?? null;
    } catch {
      return null;
    }
  }

  async createCustomer(payload: { customerNumber: string; name: string }): Promise<{ customerNumber: string }> {
    const response = await this.request("/AR/ARCustomers", {
      method: "POST",
      body: JSON.stringify({ CustomerNumber: payload.customerNumber, CustomerName: payload.name }),
    });
    if (!response.ok) {
      throw new Error(`Sage 300 customer push failed: ${response.status} ${await response.text()}`);
    }
    return { customerNumber: payload.customerNumber };
  }

  // Orders push as Sage 300 Sales Orders (OEOrders), which support direct GET+POST -- unlike AR
  // Invoices, which per research go through a batch-and-process flow (ARInvoiceBatches ->
  // ARPostInvoices($process)) not implemented here. Matches the other adapters' pattern of
  // treating "push order" as creating a sales-order-shaped document, not an invoice.
  async pushSalesOrder(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/OE/OEOrders", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Sage 300 sales order push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { OrderNumber: string };
    return { id: record.OrderNumber };
  }

  async pushCreditNote(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/OE/OECreditDebitNotes", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Sage 300 credit note push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { DocumentNumber: string };
    return { id: record.DocumentNumber };
  }

  async cancelSalesOrder(orderNumber: string): Promise<{ id: string }> {
    const response = await this.request(`/OE/OEOrders('${orderNumber.replace(/'/g, "''")}')`, {
      method: "PATCH",
      body: JSON.stringify({ OrderStatus: "2" }), // TODO(D4): "2" (Cancelled) inferred from Sage 300's typical OrderStatus enum, not confirmed
    });
    if (!response.ok) {
      throw new Error(`Sage 300 order cancellation failed: ${response.status} ${await response.text()}`);
    }
    return { id: orderNumber };
  }

  async getOrderTotal(orderNumber: string): Promise<{ status: string; total: number }> {
    const response = await this.request(
      `/OE/OEOrders('${orderNumber.replace(/'/g, "''")}')?$select=OrderStatus,TotalAmount`,
    );
    if (!response.ok) {
      throw new Error(`Sage 300 order lookup failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { OrderStatus: string; TotalAmount: number };
    return { status: record.OrderStatus, total: record.TotalAmount };
  }

  // Delta filter per research: OData $filter on DateLastMaintained, plain yyyy-MM-dd strings
  // (community reports the datetime'...' literal syntax erroring against some installs).
  async queryInventoryDeltas(sinceIso: string): Promise<CanonicalInventoryLevel[]> {
    const sinceDate = sinceIso.slice(0, 10);
    const response = await this.request(
      `/IC/ICLocations?$filter=DateLastMaintained ge '${sinceDate}'`,
    );
    if (!response.ok) {
      throw new Error(`Sage 300 inventory query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      value: { ItemNumber: string; LocationId: string; QuantityOnHand: number; DateLastMaintained: string }[];
    };
    return data.value.map((row) => ({
      sku: row.ItemNumber,
      locationId: row.LocationId,
      erpWarehouseId: row.LocationId,
      available: row.QuantityOnHand,
      safetyStockBuffer: 0,
      lastUpdated: row.DateLastMaintained,
    }));
  }

  async pullProductCatalog(sinceIso?: string): Promise<{ sku: string; title: string }[]> {
    const filter = sinceIso ? `?$filter=DateLastMaintained ge '${sinceIso.slice(0, 10)}'` : "";
    const response = await this.request(`/IC/ICItems${filter}`);
    if (!response.ok) {
      throw new Error(`Sage 300 product catalog query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { value: { ItemNumber: string; Description: string }[] };
    return data.value.map((row) => ({ sku: row.ItemNumber, title: row.Description }));
  }
}
