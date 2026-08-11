// Low-level authenticated Brightpearl REST client. Endpoint paths verified against Brightpearl's
// published API docs (api-docs.brightpearl.com, 2026-08-10 research) except where flagged
// TODO(D4) -- not yet exercised against a live account. See decision D4 in
// README.md's Build Plan.

import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { BrightpearlRefundOperation } from "./transform";
import type { BrightpearlProductIdMap, BrightpearlTokens } from "./types";
import { refreshAccessToken } from "./auth.server";
import { fetchWithErpRetry } from "../shared/httpRetry.server";

export class BrightpearlClient {
  private readonly accountCode: string;
  private tokens: BrightpearlTokens;

  constructor(accountCode: string, tokens: BrightpearlTokens) {
    this.accountCode = accountCode;
    this.tokens = tokens;
  }

  private baseUrl(): string {
    return `https://${this.tokens.apiDomain}/public-api/${this.accountCode}`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchWithErpRetry(
      `${this.baseUrl()}${path}`,
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
          this.tokens = await refreshAccessToken(this.accountCode, this.tokens.refreshToken);
          return `Bearer ${this.tokens.accessToken}`;
        },
      },
    );
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    // A cheap, always-safe read: an exact-match contact search that will return an empty result
    // set rather than erroring, even against an account with no matching contact.
    const response = await this.request(
      "/contact-service/contact-search?exactPrimaryEmail=connection-test%40example.com",
    );
    if (response.ok) return { success: true };
    return { success: false, message: `Brightpearl returned ${response.status}: ${await response.text()}` };
  }

  // TODO(D4): inferred by analogy to the confirmed contact-search endpoint
  // (product-service/product-search wasn't directly confirmed in research) -- verify against a
  // live account before relying on this for production traffic.
  async resolveProductIds(skus: string[]): Promise<BrightpearlProductIdMap> {
    const map: BrightpearlProductIdMap = {};
    if (skus.length === 0) return map;

    const response = await this.request(
      `/product-service/product-search?sku=${skus.map((s) => encodeURIComponent(s)).join(",")}`,
    );
    if (!response.ok) {
      throw new Error(`Brightpearl product lookup failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { response: { results: [number, string][] } };
    for (const [id, sku] of data.response.results) map[sku] = String(id);
    return map;
  }

  async findContactIdByEmail(email: string): Promise<string | null> {
    const response = await this.request(
      `/contact-service/contact-search?exactPrimaryEmail=${encodeURIComponent(email)}`,
    );
    if (!response.ok) {
      throw new Error(`Brightpearl contact lookup failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { response: { results: [number, ...unknown[]][] } };
    const first = data.response.results[0];
    return first ? String(first[0]) : null;
  }

  async createContact(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/contact-service/contact/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Brightpearl contact push failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { response: { id: number } };
    return { id: String(data.response.id) };
  }

  async pushSalesOrder(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/order-service/sales-order/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Brightpearl sales order push failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { response: { id: number } };
    return { id: String(data.response.id) };
  }

  async executeRefundOperation(op: BrightpearlRefundOperation): Promise<{ id: string }> {
    if (op.type === "credit_note") {
      const response = await this.request("/order-service/sales-credit/", {
        method: "POST",
        body: JSON.stringify(op.payload),
      });
      if (!response.ok) {
        throw new Error(`Brightpearl credit note push failed: ${response.status} ${await response.text()}`);
      }
      const data = (await response.json()) as { response: { id: number } };
      return { id: String(data.response.id) };
    }

    // TODO(D4): cancelling a sales order's status via this endpoint pattern is inferred from
    // Brightpearl's general "update a sub-resource" REST conventions, not independently confirmed
    // against docs or a live account -- see the note in transform.ts.
    const response = await this.request(`/order-service/sales-order/${op.orderId}/order-status/${op.statusId}`, {
      method: "PUT",
    });
    if (!response.ok) {
      throw new Error(`Brightpearl order cancellation failed: ${response.status} ${await response.text()}`);
    }
    return { id: op.orderId };
  }

  async getOrderStatus(orderId: string): Promise<{ status: string; total: number }> {
    const response = await this.request(`/order-service/sales-order/${orderId}`);
    if (!response.ok) {
      throw new Error(`Brightpearl order lookup failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      response: { orderStatus: { name: string }; totalValue: { total: string } };
    };
    return { status: data.response.orderStatus.name, total: Number(data.response.totalValue.total) };
  }

  // TODO(D4): product-availability takes an explicit set of product ids, not a modified-since
  // filter -- research couldn't confirm a true incremental delta query on this endpoint. This
  // pulls current availability for the given SKUs' resolved ids rather than everything modified
  // since sinceIso; callers that need a real "what changed" delta should lean on the
  // reconciliation job (dev spec §7) rather than this alone until verified against a live account.
  async queryInventoryAvailability(productIds: BrightpearlProductIdMap): Promise<CanonicalInventoryLevel[]> {
    const ids = Object.values(productIds);
    if (ids.length === 0) return [];

    const response = await this.request(`/warehouse-service/product-availability/${ids.join(",")}`);
    if (!response.ok) {
      throw new Error(`Brightpearl inventory query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      response: Record<string, { total: { inStock: number } }>;
    };
    const skuByProductId = Object.fromEntries(Object.entries(productIds).map(([sku, id]) => [id, sku]));

    return Object.entries(data.response).map(([productId, availability]) => ({
      sku: skuByProductId[productId] ?? productId,
      locationId: "all-warehouses", // see TODO above -- per-warehouse breakdown needs includeOptional=byLocation, not pulled here
      erpWarehouseId: "all-warehouses",
      available: availability.total.inStock,
      safetyStockBuffer: 0,
      lastUpdated: new Date().toISOString(),
    }));
  }

  async pullProductCatalog(sinceIso?: string): Promise<{ sku: string; title: string }[]> {
    const filter = sinceIso ? `&updatedOn=${encodeURIComponent(sinceIso)}` : "";
    const response = await this.request(`/product-service/product-search?pageSize=500${filter}`);
    if (!response.ok) {
      throw new Error(`Brightpearl product catalog query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { response: { results: [number, string, string][] } };
    return data.response.results.map(([, sku, name]) => ({ sku, title: name }));
  }
}
