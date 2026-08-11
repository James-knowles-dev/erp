// Low-level authenticated Business Central REST client. Endpoint paths verified against
// Microsoft's documented v2.0 API conventions (2026-08-10 research); not yet exercised against a
// live environment -- see decision D4 in README.md's Build Plan.

import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { BusinessCentralRefundOperation } from "./transform";
import type { BusinessCentralConfig, BusinessCentralItemIdMap, BusinessCentralTokens } from "./types";
import { refreshAccessToken } from "./auth.server";
import { fetchWithErpRetry } from "../shared/httpRetry.server";

function companiesBaseUrl(config: BusinessCentralConfig): string {
  return `https://api.businesscentral.dynamics.com/v2.0/${config.tenantId}/${config.environment}/api/v2.0/companies(${config.companyId})`;
}

export class BusinessCentralClient {
  private readonly config: BusinessCentralConfig;
  private tokens: BusinessCentralTokens;

  constructor(config: BusinessCentralConfig, tokens: BusinessCentralTokens) {
    this.config = config;
    this.tokens = tokens;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchWithErpRetry(
      `${companiesBaseUrl(this.config)}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      {
        onUnauthorized: async () => {
          this.tokens = await refreshAccessToken(this.config, this.tokens.refreshToken);
          return `Bearer ${this.tokens.accessToken}`;
        },
      },
    );
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    const response = await this.request("/salesOrders?$top=1");
    if (response.ok) return { success: true };
    return {
      success: false,
      message: `Business Central returned ${response.status}: ${await response.text()}`,
    };
  }

  async resolveItemIds(skus: string[]): Promise<BusinessCentralItemIdMap> {
    if (skus.length === 0) return {};
    const filter = skus.map((sku) => `number eq '${sku.replace(/'/g, "''")}'`).join(" or ");
    const response = await this.request(`/items?$filter=${encodeURIComponent(filter)}&$select=id,number`);
    if (!response.ok) {
      throw new Error(`Business Central item lookup failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { value: { id: string; number: string }[] };
    const map: BusinessCentralItemIdMap = {};
    for (const item of data.value) map[item.number] = item.id;
    return map;
  }

  async findCustomerNumberByEmail(email: string): Promise<string | null> {
    const response = await this.request(
      `/customers?$filter=email eq '${email.replace(/'/g, "''")}'&$select=number`,
    );
    if (!response.ok) {
      throw new Error(`Business Central customer lookup failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { value: { number: string }[] };
    return data.value[0]?.number ?? null;
  }

  async createCustomer(payload: Record<string, unknown>): Promise<{ number: string }> {
    const response = await this.request("/customers", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Business Central customer push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { number: string };
    return { number: record.number };
  }

  async pushSalesOrder(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/salesOrders", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Business Central salesOrder push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { id: string };
    return { id: record.id };
  }

  async executeRefundOperation(op: BusinessCentralRefundOperation): Promise<{ id: string }> {
    const path = op.entity === "salesCreditMemos" ? "/salesCreditMemos" : `/salesOrders(${op.payload.id})`;
    const response = await this.request(path, { method: op.method, body: JSON.stringify(op.payload) });
    if (!response.ok) {
      throw new Error(`Business Central ${op.method} ${op.entity} failed: ${response.status} ${await response.text()}`);
    }
    if (op.method === "PATCH") return { id: String(op.payload.id) };
    const record = (await response.json()) as { id: string };
    return { id: record.id };
  }

  async getOrderTotal(orderId: string): Promise<{ status: string; total: number }> {
    const response = await this.request(`/salesOrders(${orderId})?$select=status,totalAmountIncludingTax`);
    if (!response.ok) {
      throw new Error(`Business Central order lookup failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { status: string; totalAmountIncludingTax: number };
    return { status: record.status, total: record.totalAmountIncludingTax };
  }

  // TODO(D4): the standard `items` API's `inventory` field is a total across every location, not
  // per-warehouse -- Business Central's per-location on-hand quantity isn't reliably exposed via
  // the standard v2.0 API (community guidance points at Item Ledger Entry, which typically needs
  // a custom API page). Returns one row per item with a placeholder locationId rather than
  // fabricating per-warehouse numbers the API doesn't actually give us.
  async queryInventoryDeltas(sinceIso: string): Promise<CanonicalInventoryLevel[]> {
    const response = await this.request(
      `/items?$filter=lastModifiedDateTime gt ${sinceIso}&$select=number,inventory,lastModifiedDateTime`,
    );
    if (!response.ok) {
      throw new Error(`Business Central inventory query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      value: { number: string; inventory: number; lastModifiedDateTime: string }[];
    };
    return data.value.map((item) => ({
      sku: item.number,
      locationId: "all-locations", // see TODO above
      erpWarehouseId: "all-locations",
      available: item.inventory,
      safetyStockBuffer: 0,
      lastUpdated: item.lastModifiedDateTime,
    }));
  }

  async pullProductCatalog(sinceIso?: string): Promise<{ sku: string; title: string }[]> {
    const filter = sinceIso ? `?$filter=lastModifiedDateTime gt ${sinceIso}` : "";
    const response = await this.request(`/items${filter}`);
    if (!response.ok) {
      throw new Error(`Business Central product catalog query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { value: { number: string; displayName: string }[] };
    return data.value.map((item) => ({ sku: item.number, title: item.displayName }));
  }
}
