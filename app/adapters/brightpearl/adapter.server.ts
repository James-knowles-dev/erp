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
import { BrightpearlClient } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToBrightpearlSalesOrder, canonicalRefundToBrightpearlOperation } from "./transform";
import type { BrightpearlTokens } from "./types";

// Implements ERPAdapter for Brightpearl -- fourth adapter, structurally the closest of the four to
// a "normal" OAuth2 REST integration (see auth.server.ts's header comment on the client-ownership
// difference). The genuinely new thing this adapter proves: Brightpearl's own data model is
// already ecommerce-shaped (contacts/products/sales-orders map almost 1:1 onto Shopify's
// customer/product/order concepts), unlike the accounting-first shapes NetSuite/Acumatica/
// Business Central impose -- confirming the canonical model doesn't just accommodate
// "translate away from ecommerce," it's a no-op in the direction it already matches.
export class BrightpearlAdapter implements ERPAdapter {
  private client: BrightpearlClient | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "oauth2") {
      return { success: false, message: "BrightpearlAdapter requires oauth2 credentials." };
    }

    const { accountCode, accessToken, refreshToken, expiresAt, apiDomain } = credentials.values;
    if (!accountCode || !accessToken || !refreshToken || !apiDomain) {
      return {
        success: false,
        message: "Missing required Brightpearl credential fields (accountCode, accessToken, refreshToken, apiDomain).",
      };
    }

    const tokens: BrightpearlTokens = { accessToken, refreshToken, expiresAt: expiresAt ?? new Date().toISOString(), apiDomain };
    this.client = new BrightpearlClient(accountCode, tokens);

    return { success: true, erpInstanceId: accountCode };
  }

  private requireClient(): BrightpearlClient {
    if (!this.client) {
      throw new Error("BrightpearlAdapter.authenticate() must succeed before any other call.");
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

    const productIds = await client.resolveProductIds(order.lineItems.map((li) => li.sku));
    const contactId = await client.findContactIdByEmail(order.customer.email);
    if (!contactId) {
      throw new Error(
        `No Brightpearl contact found for ${order.customer.email}. Automatic contact creation is an ` +
          `edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToBrightpearlSalesOrder(order, mapping, productIds, contactId);
    const { id } = await client.pushSalesOrder(payload);
    return { documentType: "sales-order", documentId: id };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const productIds = await client.resolveProductIds(refund.lineItems.map((li) => li.sku));
    const operation = canonicalRefundToBrightpearlOperation(refund, mapping, productIds);
    const { id } = await client.executeRefundOperation(operation);
    return { documentType: operation.type === "credit_note" ? "sales-credit" : "sales-order", documentId: id };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const { status, total } = await this.requireClient().getOrderStatus(erpDocumentRef.documentId);
    return { erpDocumentRef, status, total, lastUpdated: new Date().toISOString() };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    // TODO(D4): see client.server.ts's queryInventoryAvailability -- Brightpearl's availability
    // endpoint needs an explicit product id set, so a true "everything changed since X" pull isn't
    // possible without first pulling the full catalog. Uses the catalog delta (which does support
    // a since-filter) to find candidate SKUs, then queries their current availability.
    const client = this.requireClient();
    const changedProducts = await client.pullProductCatalog(sinceTimestamp);
    const productIds = await client.resolveProductIds(changedProducts.map((p) => p.sku));
    return client.queryInventoryAvailability(productIds);
  }

  supportsInventoryWebhooks(): boolean {
    // Brightpearl does have native webhook support (per the dev spec's adapter table and
    // 2026-08-10 research: integration-service/webhook, event types like order.created) --
    // unlike NetSuite/Acumatica, this one is genuinely capable of it today. Still false because
    // subscribing to and ingesting Brightpearl webhooks isn't built yet, same reasoning as
    // Business Central's identical false return.
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingId = await client.findContactIdByEmail(customer.email);
    if (existingId) return { documentType: "contact", documentId: existingId };

    const { id } = await client.createContact({
      firstName: customer.companyName ?? customer.email,
      lastName: "-",
      communication: { emails: [{ type: "PRI", email: customer.email }] },
    });
    return { documentType: "contact", documentId: id };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const id = await this.requireClient().findContactIdByEmail(email);
    return id ? { documentType: "contact", documentId: id } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const rows = await this.requireClient().pullProductCatalog(sinceTimestamp);
    return rows.map((r) => ({ sku: r.sku, title: r.title, customFields: {} }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // TODO(D4): ~200 requests/minute per account came from secondary/unofficial sources during
    // research, not Brightpearl's own docs directly -- Brightpearl does expose live
    // brightpearl-requests-remaining / brightpearl-next-throttle-period response headers that a
    // real adaptive-backoff implementation should read instead of trusting this fixed number,
    // which isn't wired up yet.
    return { requestsPerWindow: 200, windowSeconds: 60, backoffStrategy: "exponential" };
  }
}
