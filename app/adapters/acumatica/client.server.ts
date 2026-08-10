// Low-level authenticated Acumatica REST client. Endpoint paths verified against Acumatica's
// documented contract-based REST API conventions (2026-08-10 research); not yet exercised
// against a live instance -- see decision D4 in erp-connector-build-plan.md.

import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { AcumaticaRefundOperation } from "./transform";
import type { AcumaticaConfig, AcumaticaTokens } from "./types";

// TODO(D4): Acumatica versions its contract-based endpoint per instance (customers can be on
// different versions), so a hardcoded version is a real risk -- this should probably become a
// wizard-collected or auto-detected value (via the instance's $adminInfo endpoint) rather than a
// constant, once verified against a real instance.
const API_VERSION = "24.200.001";

function restBaseUrl(instanceUrl: string): string {
  return `${instanceUrl}/entity/Default/${API_VERSION}`;
}

interface AcumaticaValueField {
  value: string;
}

export class AcumaticaClient {
  private readonly config: AcumaticaConfig;
  private readonly tokens: AcumaticaTokens;

  constructor(config: AcumaticaConfig, tokens: AcumaticaTokens) {
    this.config = config;
    this.tokens = tokens;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${restBaseUrl(this.config.instanceUrl)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    const response = await this.request("/SalesOrder?$top=1");
    if (response.ok) return { success: true };
    return { success: false, message: `Acumatica returned ${response.status}: ${await response.text()}` };
  }

  async findCustomerIdByEmail(email: string): Promise<string | null> {
    const response = await this.request(
      `/Customer?$filter=MainContact/Email eq '${email.replace(/'/g, "''")}'&$select=CustomerID`,
    );
    if (!response.ok) {
      throw new Error(`Acumatica customer lookup failed: ${response.status} ${await response.text()}`);
    }
    const records = (await response.json()) as { CustomerID?: AcumaticaValueField }[];
    return records[0]?.CustomerID?.value ?? null;
  }

  async createCustomer(payload: Record<string, unknown>): Promise<{ id: string }> {
    const response = await this.request("/Customer", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Acumatica customer push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { CustomerID: AcumaticaValueField };
    return { id: record.CustomerID.value };
  }

  // POST creates a new record in Acumatica's contract-based REST API (unlike NetSuite, where the
  // same verb also updates by id).
  async pushSalesOrder(payload: Record<string, unknown>): Promise<{ orderNbr: string }> {
    const response = await this.request("/SalesOrder", { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Acumatica salesOrder push failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { OrderNbr: AcumaticaValueField };
    return { orderNbr: record.OrderNbr.value };
  }

  async executeRefundOperation(op: AcumaticaRefundOperation): Promise<{ orderNbr: string }> {
    const response = await this.request("/SalesOrder", {
      method: op.method,
      body: JSON.stringify(op.payload),
    });
    if (!response.ok) {
      throw new Error(`Acumatica ${op.method} SalesOrder failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { OrderNbr: AcumaticaValueField };
    return { orderNbr: record.OrderNbr.value };
  }

  async getOrderTotal(orderNbr: string): Promise<{ status: string; total: number }> {
    const response = await this.request(
      `/SalesOrder/SO/${encodeURIComponent(orderNbr)}?$select=Status,OrderTotal`,
    );
    if (!response.ok) {
      throw new Error(`Acumatica order lookup failed: ${response.status} ${await response.text()}`);
    }
    const record = (await response.json()) as { Status: AcumaticaValueField; OrderTotal: { value: number } };
    return { status: record.Status.value, total: record.OrderTotal.value };
  }

  async pullProductCatalog(sinceIso?: string): Promise<{ sku: string; title: string }[]> {
    const filter = sinceIso
      ? `?$filter=LastModifiedDateTime gt datetimeoffset'${sinceIso}'`
      : "";
    const response = await this.request(`/StockItem${filter}`);
    if (!response.ok) {
      throw new Error(`Acumatica product catalog query failed: ${response.status} ${await response.text()}`);
    }
    const records = (await response.json()) as {
      InventoryID: AcumaticaValueField;
      Description: AcumaticaValueField;
    }[];
    return records.map((r) => ({ sku: r.InventoryID.value, title: r.Description.value }));
  }

  // TODO(D4): InventorySummary is the documented entity for per-warehouse quantity, but whether
  // it supports a reliable "last modified since" filter (vs. requiring a custom Generic Inquiry,
  // per Acumatica community guidance) isn't verified against a real instance.
  async queryInventoryDeltas(sinceIso: string): Promise<CanonicalInventoryLevel[]> {
    const response = await this.request(
      `/InventorySummary?$filter=LastModifiedDateTime gt datetimeoffset'${sinceIso}'`,
    );
    if (!response.ok) {
      throw new Error(`Acumatica inventory query failed: ${response.status} ${await response.text()}`);
    }
    const records = (await response.json()) as {
      InventoryID: AcumaticaValueField;
      Warehouse: AcumaticaValueField;
      QtyOnHand: { value: number };
      LastModifiedDateTime?: AcumaticaValueField;
    }[];

    return records.map((r) => ({
      sku: r.InventoryID.value,
      locationId: r.Warehouse.value,
      erpWarehouseId: r.Warehouse.value,
      available: r.QtyOnHand.value,
      safetyStockBuffer: 0,
      lastUpdated: r.LastModifiedDateTime?.value ?? new Date().toISOString(),
    }));
  }
}
