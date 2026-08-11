// Low-level authenticated Sage Intacct XML Gateway client. Function/field names verified against
// Sage's developer docs and community references (2026-08-10 research) except where flagged
// TODO(D4) -- not yet exercised against a live account. See decision D4 in
// README.md's Build Plan.

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { CanonicalInventoryLevel } from "../../models/canonical";
import type { SageIntacctItemIdMap, SageIntacctSession } from "./types";
import { fetchWithErpRetry } from "../shared/httpRetry.server";

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export class SageIntacctClient {
  private readonly session: SageIntacctSession;

  constructor(session: SageIntacctSession) {
    this.session = session;
  }

  // Wraps a single <function> body in the session-authenticated request/response envelope and
  // returns that function's parsed <data>. Every higher-level method below builds its own
  // function-specific inner XML object and reads the shape it expects back out of the result.
  private async callFunction(functionBody: Record<string, unknown>): Promise<unknown> {
    const controlId = `fn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestBody = builder.build({
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      request: {
        control: {
          senderid: process.env.SAGE_INTACCT_SENDER_ID ?? "",
          password: process.env.SAGE_INTACCT_SENDER_PASSWORD ?? "",
          controlid: controlId,
          uniqueid: "false",
          dtdversion: "3.0",
        },
        operation: {
          "@_transaction": "true",
          authentication: { sessionid: this.session.sessionId },
          content: { function: { "@_controlid": controlId, ...functionBody } },
        },
      },
    });

    // No onUnauthorized here -- Intacct's XML gateway signals an expired session as an HTTP 200
    // with a non-success <result> body (checked below), not an HTTP 401, so 401-refresh doesn't
    // apply to this transport. 429/network retry still applies via fetchWithErpRetry.
    const response = await fetchWithErpRetry(this.session.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`Sage Intacct request failed: ${response.status} ${await response.text()}`);
    }

    const parsed = parser.parse(await response.text());
    const result = parsed?.response?.operation?.result;
    if (result?.status !== "success") {
      const message = result?.errormessage?.error?.description2 ?? result?.errormessage ?? "Unknown error";
      throw new Error(`Sage Intacct function call was not successful: ${JSON.stringify(message)}`);
    }
    return result?.data;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      // A cheap read: query a single customer record, which succeeds (possibly with zero rows)
      // against any valid session regardless of whether any customers exist yet.
      await this.callFunction({
        query: { object: "CUSTOMER", select: { field: "CUSTOMERID" }, pagesize: "1" },
      });
      return { success: true };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  // Intacct's ITEMID is typically the SKU itself rather than a separate opaque internal id, so
  // this mostly confirms each SKU actually exists as an item rather than resolving a distinct id
  // -- kept as an async lookup (not a passthrough) so a missing item fails loudly before pushOrder
  // rather than silently sending a bad ITEMID.
  async resolveItemIds(skus: string[]): Promise<SageIntacctItemIdMap> {
    const map: SageIntacctItemIdMap = {};
    if (skus.length === 0) return map;

    const data = (await this.callFunction({
      query: {
        object: "ITEM",
        select: { field: "ITEMID" },
        filter: { in: { field: "ITEMID", value: skus } },
      },
    })) as { ITEM?: { ITEMID: string } | { ITEMID: string }[] };

    const rows = data?.ITEM ? (Array.isArray(data.ITEM) ? data.ITEM : [data.ITEM]) : [];
    for (const row of rows) map[row.ITEMID] = row.ITEMID;
    return map;
  }

  async findCustomerIdByEmail(email: string): Promise<string | null> {
    const data = (await this.callFunction({
      query: {
        object: "CUSTOMER",
        select: { field: "CUSTOMERID" },
        filter: { equalto: { field: "EMAIL1", value: email } },
      },
    })) as { CUSTOMER?: { CUSTOMERID: string } | { CUSTOMERID: string }[] };

    if (!data?.CUSTOMER) return null;
    const first = Array.isArray(data.CUSTOMER) ? data.CUSTOMER[0] : data.CUSTOMER;
    return first?.CUSTOMERID ?? null;
  }

  async createCustomer(payload: { customerId: string; name: string; email: string }): Promise<{ customerId: string }> {
    await this.callFunction({
      create: {
        CUSTOMER: {
          CUSTOMERID: payload.customerId,
          NAME: payload.name,
          DISPLAYCONTACT: { EMAIL1: payload.email },
        },
      },
    });
    return { customerId: payload.customerId };
  }

  async createSalesOrder(payload: Record<string, unknown>): Promise<{ id: string }> {
    const data = (await this.callFunction({ create: { SODOCUMENT: payload } })) as { key?: string };
    if (!data?.key) throw new Error("Sage Intacct create SODOCUMENT did not return a key.");
    return { id: data.key };
  }

  async createArAdjustment(payload: Record<string, unknown>): Promise<{ id: string }> {
    const data = (await this.callFunction({ create_aradjustment: payload })) as { key?: string };
    if (!data?.key) throw new Error("Sage Intacct create_aradjustment did not return a key.");
    return { id: data.key };
  }

  async cancelSalesOrder(recordNo: string): Promise<{ id: string }> {
    await this.callFunction({
      update: { SODOCUMENT: { RECORDNO: recordNo, STATE: "Void" } },
    });
    return { id: recordNo };
  }

  async getOrderStatus(recordNo: string): Promise<{ status: string; total: number }> {
    const data = (await this.callFunction({
      read: { object: "SODOCUMENT", keys: recordNo, fields: "STATE,TOTAL" },
    })) as { SODOCUMENT?: { STATE: string; TOTAL: string } };

    if (!data?.SODOCUMENT) throw new Error(`Sage Intacct SODOCUMENT ${recordNo} not found.`);
    return { status: data.SODOCUMENT.STATE, total: Number(data.SODOCUMENT.TOTAL) };
  }

  // TODO(D4): AVAILABLEINVENTORY's exact field set (WHENMODIFIED for delta filtering, QUANTITYLEFT
  // for on-hand) is reconstructed from research, not confirmed against a live account.
  async queryInventoryDeltas(sinceIso: string): Promise<CanonicalInventoryLevel[]> {
    const data = (await this.callFunction({
      query: {
        object: "AVAILABLEINVENTORY",
        select: { field: ["ITEMID", "WAREHOUSEID", "QUANTITYLEFT", "WHENMODIFIED"] },
        filter: { greaterthan: { field: "WHENMODIFIED", value: sinceIso } },
      },
    })) as {
      AVAILABLEINVENTORY?:
        | { ITEMID: string; WAREHOUSEID: string; QUANTITYLEFT: string; WHENMODIFIED: string }
        | { ITEMID: string; WAREHOUSEID: string; QUANTITYLEFT: string; WHENMODIFIED: string }[];
    };

    const rows = data?.AVAILABLEINVENTORY
      ? Array.isArray(data.AVAILABLEINVENTORY)
        ? data.AVAILABLEINVENTORY
        : [data.AVAILABLEINVENTORY]
      : [];

    return rows.map((row) => ({
      sku: row.ITEMID,
      locationId: row.WAREHOUSEID,
      erpWarehouseId: row.WAREHOUSEID,
      available: Number(row.QUANTITYLEFT),
      safetyStockBuffer: 0,
      lastUpdated: row.WHENMODIFIED,
    }));
  }

  async pullProductCatalog(sinceIso?: string): Promise<{ sku: string; title: string }[]> {
    const data = (await this.callFunction({
      query: {
        object: "ITEM",
        select: { field: ["ITEMID", "NAME"] },
        ...(sinceIso ? { filter: { greaterthan: { field: "WHENMODIFIED", value: sinceIso } } } : {}),
      },
    })) as { ITEM?: { ITEMID: string; NAME: string } | { ITEMID: string; NAME: string }[] };

    const rows = data?.ITEM ? (Array.isArray(data.ITEM) ? data.ITEM : [data.ITEM]) : [];
    return rows.map((row) => ({ sku: row.ITEMID, title: row.NAME }));
  }
}
