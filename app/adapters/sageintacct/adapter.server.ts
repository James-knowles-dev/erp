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
import { SageIntacctClient } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToSageIntacctOperation } from "./transform";
import type { SageIntacctSession } from "./types";

// Implements ERPAdapter for Sage Intacct -- fifth adapter, and the first that isn't OAuth2 (dev
// spec §4: "Sender ID/password + session-based API"). Proves the ERPAdapter contract holds for a
// genuinely different auth shape too, not just different credential field counts the way Business
// Central's did: authenticate() here takes an already-established session (sessionid + gateway
// endpoint), not a bearer token pair, and there's no refresh -- see auth.server.ts's header
// comment for how the connect wizard's OAuth-shaped redirect/callback route still accommodates
// this without being rewritten around it.
export class SageIntacctAdapter implements ERPAdapter {
  private client: SageIntacctClient | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "session") {
      return { success: false, message: "SageIntacctAdapter requires session credentials." };
    }

    const { companyId, accessToken, expiresAt, endpoint } = credentials.values;
    if (!companyId || !accessToken || !endpoint) {
      return {
        success: false,
        message: "Missing required Sage Intacct credential fields (companyId, accessToken/sessionid, endpoint).",
      };
    }

    const session: SageIntacctSession = {
      sessionId: accessToken,
      endpoint,
      expiresAt: expiresAt ?? new Date().toISOString(),
    };
    this.client = new SageIntacctClient(session);

    return { success: true, erpInstanceId: companyId };
  }

  private requireClient(): SageIntacctClient {
    if (!this.client) {
      throw new Error("SageIntacctAdapter.authenticate() must succeed before any other call.");
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
      throw new Error(
        `No Sage Intacct customer found for ${order.customer.email}. Automatic customer creation ` +
          `is an edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToSalesOrder(order, mapping, itemIds, customerId);
    const { id } = await client.createSalesOrder(payload);
    return { documentType: "SODOCUMENT", documentId: id };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const operation = canonicalRefundToSageIntacctOperation(refund, mapping);

    if (operation.type === "ar_adjustment") {
      const { id } = await client.createArAdjustment(operation.payload);
      return { documentType: "ARADJUSTMENT", documentId: id };
    }
    const { id } = await client.cancelSalesOrder(operation.recordNo);
    return { documentType: "SODOCUMENT", documentId: id };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const { status, total } = await this.requireClient().getOrderStatus(erpDocumentRef.documentId);
    return { erpDocumentRef, status, total, lastUpdated: new Date().toISOString() };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    return this.requireClient().queryInventoryDeltas(sinceTimestamp);
  }

  supportsInventoryWebhooks(): boolean {
    // Confirmed no native webhook/event-push mechanism on the XML Gateway (dev spec §4: "Limited
    // native webhook support, likely polling-based") -- unlike the other adapters' "not built yet"
    // reasoning, this one is a real API limitation, not a to-do. Polling plus the reconciliation
    // job (dev spec §7) is the only integrity path for this adapter.
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingId = await client.findCustomerIdByEmail(customer.email);
    if (existingId) return { documentType: "CUSTOMER", documentId: existingId };

    // Intacct's CUSTOMERID is a merchant-chosen key, not an auto-generated one -- derived from the
    // Shopify customer id (prefixed to stay clear of the merchant's own numbering) rather than
    // asking Intacct to assign one, since create() requires a CUSTOMERID up front.
    const customerId = `SHOP-${customer.id}`;
    const { customerId: created } = await client.createCustomer({
      customerId,
      name: customer.companyName ?? customer.email,
      email: customer.email,
    });
    return { documentType: "CUSTOMER", documentId: created };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const id = await this.requireClient().findCustomerIdByEmail(email);
    return id ? { documentType: "CUSTOMER", documentId: id } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const rows = await this.requireClient().pullProductCatalog(sinceTimestamp);
    return rows.map((r) => ({ sku: r.sku, title: r.title, customFields: {} }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // Sage's Performance Tiers cap transactions per month (default tier: 100,000/month) rather
    // than the requests-per-window shape this policy models -- there's no confirmed per-minute
    // ceiling for the integration APIs specifically (2026-08-10 research; the per-second AJAX
    // gateway limits found don't apply to this API). This is a conservative placeholder
    // (100,000/month / ~30 days / ~8 business hours ≈ 7/min) rather than a researched number --
    // see decision D4.
    return { requestsPerWindow: 7, windowSeconds: 60, backoffStrategy: "exponential" };
  }
}
