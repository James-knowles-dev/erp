import type {
  CanonicalCustomer,
  CanonicalInventoryLevel,
  CanonicalOrder,
  CanonicalProduct,
  CanonicalRefund,
} from "../../models/canonical";
import type {
  ConnectionResult,
  ERPAdapter,
  ERPCredentials,
  ERPDocumentRef,
  ERPOrderStatus,
  FieldMapping,
  FieldMappingTemplate,
  RateLimitPolicy,
  ValidationIssue,
} from "../types";
import { NetSuiteClient } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToNetSuiteOperation } from "./transform";
import type { NetSuiteConfig, NetSuiteTokens } from "./types";

// Implements ERPAdapter for NetSuite. The OAuth 2.0 authorization-code redirect itself (building
// the authorize URL, handling the callback, exchanging the code) is wizard-route orchestration
// (Milestone 2), not adapter mechanics -- see auth.server.ts. This class's authenticate() takes
// already-obtained tokens and validates/stores them for subsequent calls, matching how the
// generic ERPAdapter.authenticate(credentials) contract is used by every adapter.
export class NetSuiteAdapter implements ERPAdapter {
  private client: NetSuiteClient | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "oauth2") {
      return { success: false, message: "NetSuiteAdapter requires oauth2 credentials." };
    }

    const { accountId, clientId, clientSecret, accessToken, refreshToken, expiresAt } = credentials.values;
    if (!accountId || !clientId || !clientSecret || !accessToken || !refreshToken) {
      return {
        success: false,
        message:
          "Missing required NetSuite credential fields (accountId, clientId, clientSecret, accessToken, refreshToken).",
      };
    }

    const config: NetSuiteConfig = { accountId, clientId, clientSecret };
    const tokens: NetSuiteTokens = {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ?? new Date().toISOString(),
    };
    this.client = new NetSuiteClient(config, tokens);

    return { success: true, erpInstanceId: accountId };
  }

  private requireClient(): NetSuiteClient {
    if (!this.client) {
      throw new Error("NetSuiteAdapter.authenticate() must succeed before any other call.");
    }
    return this.client;
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    return this.requireClient().testConnection();
  }

  getDefaultFieldMappings(): FieldMappingTemplate {
    return getDefaultFieldMappings();
  }

  validateMapping(mapping: FieldMapping[]): ValidationIssue[] {
    return validateMapping(mapping);
  }

  async pushOrder(order: CanonicalOrder, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const itemIds = await client.resolveItemIds(order.lineItems.map((li) => li.sku));
    const customerId = await client.findCustomerIdByEmail(order.customer.email);
    if (!customerId) {
      // "Should we create one automatically?" is an edge-case-rule decision (product spec §7.1
      // step 5, Milestone 2+) -- surfacing as an error here rather than silently guessing.
      throw new Error(
        `No NetSuite customer found for ${order.customer.email}. Automatic customer creation is ` +
          `an edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToSalesOrder(order, mapping, itemIds, customerId);
    const { id } = await client.pushSalesOrder(payload);
    return { documentType: "salesOrder", documentId: id };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const skus = refund.lineItems.map((li) => li.sku);
    const itemIds = await client.resolveItemIds(skus);
    const operation = canonicalRefundToNetSuiteOperation(refund, mapping, itemIds);
    const { id } = await client.executeRefundOperation(operation);
    return { documentType: operation.recordType, documentId: id };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const client = this.requireClient();
    const [record] = await client.suiteQL<{ status: string; total: number; lastmodifieddate: string }>(
      `SELECT status, total, lastmodifieddate FROM transaction WHERE id = '${erpDocumentRef.documentId}'`,
    );
    if (!record) {
      throw new Error(`NetSuite record ${erpDocumentRef.documentId} not found.`);
    }
    return {
      erpDocumentRef,
      status: record.status,
      total: record.total,
      lastUpdated: record.lastmodifieddate,
    };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    return this.requireClient().queryInventoryDeltas(sinceTimestamp);
  }

  supportsInventoryWebhooks(): boolean {
    // Conservative default -- per the dev spec's adapter table, SuiteScript webhooks are
    // *possible* but require setup on the customer's own NetSuite instance (the guided setup
    // check in product spec §7.1 step 2, Milestone 2). Don't claim support until that's verified.
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingId = await client.findCustomerIdByEmail(customer.email);
    if (existingId) {
      return { documentType: "customer", documentId: existingId };
    }

    const { id } = await client.createCustomer({
      email: customer.email,
      companyname: customer.companyName,
      isperson: !customer.companyName,
    });
    return { documentType: "customer", documentId: id };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const id = await this.requireClient().findCustomerIdByEmail(email);
    return id ? { documentType: "customer", documentId: id } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const client = this.requireClient();
    const filter = sinceTimestamp
      ? ` WHERE lastmodifieddate > TO_DATE('${sinceTimestamp.slice(0, 10)}', 'YYYY-MM-DD')`
      : "";
    const rows = await client.suiteQL<{ itemid: string; displayname: string }>(
      `SELECT itemid, displayname FROM item${filter}`,
    );
    return rows.map((row) => ({
      sku: row.itemid,
      title: row.displayname,
      customFields: {},
    }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // NetSuite's actual model is concurrency-based (default 15 simultaneous requests, higher on
    // upper service tiers), not a simple requests-per-window token bucket -- this shape is an
    // approximation of that, not a literal match. See README.md's Development Spec §4's note.
    return { requestsPerWindow: 15, windowSeconds: 1, backoffStrategy: "exponential" };
  }
}
