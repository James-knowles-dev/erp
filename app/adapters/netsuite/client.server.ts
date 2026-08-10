// Low-level authenticated NetSuite REST client: request signing, SuiteQL queries, and the
// item/customer id lookups the transform layer needs. Endpoint paths verified against NetSuite's
// documented REST Record API and SuiteQL patterns (2026-08-10 research); not yet exercised
// against a live account -- see decision D4 in erp-connector-build-plan.md.

import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { NetSuiteRefundOperation } from "./transform";
import type { NetSuiteConfig, NetSuiteItemIdMap, NetSuiteTokens } from "./types";

function restBaseUrl(accountId: string): string {
  return `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;
}

export class NetSuiteClient {
  private readonly config: NetSuiteConfig;
  private readonly tokens: NetSuiteTokens;

  constructor(config: NetSuiteConfig, tokens: NetSuiteTokens) {
    this.config = config;
    this.tokens = tokens;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${restBaseUrl(this.config.accountId)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    return response;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    const response = await this.request("/record/v1/salesOrder?limit=1");
    if (response.ok) return { success: true };
    return { success: false, message: `NetSuite returned ${response.status}: ${await response.text()}` };
  }

  async suiteQL<T = Record<string, unknown>>(query: string): Promise<T[]> {
    const response = await this.request("/query/v1/suiteql", {
      method: "POST",
      headers: { Prefer: "transient" },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) {
      throw new Error(`NetSuite SuiteQL query failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { items: T[] };
    return data.items;
  }

  // Line items on a NetSuite sales order reference items by internal id, not SKU (`itemid`).
  async resolveItemIds(skus: string[]): Promise<NetSuiteItemIdMap> {
    if (skus.length === 0) return {};
    const quoted = skus.map((sku) => `'${sku.replace(/'/g, "''")}'`).join(", ");
    const rows = await this.suiteQL<{ id: string; itemid: string }>(
      `SELECT id, itemid FROM item WHERE itemid IN (${quoted})`,
    );
    const map: NetSuiteItemIdMap = {};
    for (const row of rows) map[row.itemid] = row.id;
    return map;
  }

  async findCustomerIdByEmail(email: string): Promise<string | null> {
    const rows = await this.suiteQL<{ id: string }>(
      `SELECT id FROM customer WHERE email = '${email.replace(/'/g, "''")}'`,
    );
    return rows[0]?.id ?? null;
  }

  async createCustomer(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/record/v1/customer", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`NetSuite customer push failed: ${response.status} ${await response.text()}`);
    }
    const location = response.headers.get("Location") ?? "";
    const id = location.split("/").pop();
    if (!id) throw new Error(`NetSuite customer push succeeded but returned no Location header.`);
    return { id };
  }

  async pushSalesOrder(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/record/v1/salesOrder", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`NetSuite salesOrder push failed: ${response.status} ${await response.text()}`);
    }
    // The REST Record API returns the new record's id via a Location response header
    // (e.g. ".../record/v1/salesOrder/12345"), not in the response body.
    const location = response.headers.get("Location") ?? "";
    const id = location.split("/").pop();
    if (!id) throw new Error(`NetSuite salesOrder push succeeded but returned no Location header.`);
    return { id };
  }

  async executeRefundOperation(op: NetSuiteRefundOperation): Promise<{ id: string }> {
    const path =
      op.recordType === "creditMemo"
        ? "/record/v1/creditMemo"
        : `/record/v1/salesOrder/${op.payload.id}`;

    const response = await this.request(path, {
      method: op.method,
      body: JSON.stringify(op.payload),
    });
    if (!response.ok) {
      throw new Error(`NetSuite ${op.recordType} ${op.method} failed: ${response.status} ${await response.text()}`);
    }

    if (op.method === "PATCH") {
      // PATCH updates the existing record in place -- its id is already known.
      return { id: String(op.payload.id) };
    }
    const location = response.headers.get("Location") ?? "";
    const id = location.split("/").pop();
    if (!id) throw new Error(`NetSuite ${op.recordType} push succeeded but returned no Location header.`);
    return { id };
  }

  // TODO(D4): built from InventoryItemLocations (Location/QuantityOnHand/QuantityAvailable) and
  // AggregateItemLocation's LastQuantityAvailableChange for delta filtering, per documented
  // SuiteQL schema -- not verified against a live account.
  async queryInventoryDeltas(sinceIso: string): Promise<CanonicalInventoryLevel[]> {
    const rows = await this.suiteQL<{
      itemid: string;
      location: string;
      quantityavailable: number;
      lastmodified: string;
    }>(
      `SELECT item.itemid AS itemid, loc.location AS location, ` +
        `loc.quantityavailable AS quantityavailable, agg.lastquantityavailablechange AS lastmodified ` +
        `FROM item ` +
        `JOIN InventoryItemLocations loc ON loc.item = item.id ` +
        `JOIN AggregateItemLocation agg ON agg.item = item.id AND agg.location = loc.location ` +
        `WHERE agg.lastquantityavailablechange > TO_DATE('${sinceIso.slice(0, 10)}', 'YYYY-MM-DD')`,
    );

    return rows.map((row) => ({
      sku: row.itemid,
      locationId: row.location,
      erpWarehouseId: row.location,
      available: row.quantityavailable,
      safetyStockBuffer: 0,
      lastUpdated: row.lastmodified,
    }));
  }
}
