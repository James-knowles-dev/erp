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
import { Sage300Client } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToSage300Order, canonicalRefundToSage300Operation } from "./transform";

// Implements ERPAdapter for Sage 300 -- sixth adapter, and the second non-OAuth2 one (dev spec
// §4: "API key-based", more precisely HTTP Basic Auth -- see auth.server.ts). The genuinely new
// thing this one proves: not every ERP is a vendor-hosted multi-tenant service reachable at a
// well-known domain -- Sage 300 is typically self-hosted per customer, so `serverUrl` is a
// merchant-controlled endpoint we have no ability to discover, validate the shape of, or assume
// uptime for, unlike every other adapter built so far.
export class Sage300Adapter implements ERPAdapter {
  private client: Sage300Client | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "api_key") {
      return { success: false, message: "Sage300Adapter requires api_key (Basic Auth) credentials." };
    }

    const { serverUrl, company, accessToken } = credentials.values;
    if (!serverUrl || !company || !accessToken) {
      return {
        success: false,
        message: "Missing required Sage 300 credential fields (serverUrl, company, accessToken).",
      };
    }

    this.client = new Sage300Client(serverUrl, company, accessToken);
    return { success: true, erpInstanceId: `${serverUrl}/${company}` };
  }

  private requireClient(): Sage300Client {
    if (!this.client) {
      throw new Error("Sage300Adapter.authenticate() must succeed before any other call.");
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
    const customerNumber = await client.findCustomerNumberByEmail(order.customer.email);
    if (!customerNumber) {
      throw new Error(
        `No Sage 300 customer found for ${order.customer.email}. Automatic customer creation is ` +
          `an edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToSage300Order(order, mapping, itemIds, customerNumber);
    const { id } = await client.pushSalesOrder(payload);
    return { documentType: "OEOrders", documentId: id };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const itemIds = await client.resolveItemIds(refund.lineItems.map((li) => li.sku));
    const operation = canonicalRefundToSage300Operation(refund, mapping, itemIds);

    if (operation.type === "credit_note") {
      const { id } = await client.pushCreditNote(operation.payload);
      return { documentType: "OECreditDebitNotes", documentId: id };
    }
    const { id } = await client.cancelSalesOrder(operation.orderNumber);
    return { documentType: "OEOrders", documentId: id };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const { status, total } = await this.requireClient().getOrderTotal(erpDocumentRef.documentId);
    return { erpDocumentRef, status, total, lastUpdated: new Date().toISOString() };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    return this.requireClient().queryInventoryDeltas(sinceTimestamp);
  }

  supportsInventoryWebhooks(): boolean {
    // Confirmed absent (2026-08-10 research) -- consistent with dev spec §4's "No native
    // webhooks, polling required." Polling plus the reconciliation job (dev spec §7) is the only
    // integrity path for this adapter, same as Sage Intacct.
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingNumber = await client.findCustomerNumberByEmail(customer.email);
    if (existingNumber) return { documentType: "ARCustomers", documentId: existingNumber };

    // ARCustomers is keyed by a merchant-chosen CustomerNumber, not an auto-generated one -- same
    // derived-from-Shopify-id approach as Sage Intacct's CUSTOMERID, for the same reason (create()
    // requires the key up front, and there's no confirmed email-based lookup to reconcile against
    // later).
    const customerNumber = `SHOP${customer.id}`.slice(0, 12); // Sage 300 CustomerNumber is commonly length-limited; 12 is a conservative guess, not confirmed (D4)
    const { customerNumber: created } = await client.createCustomer({
      customerNumber,
      name: customer.companyName ?? customer.email,
    });
    return { documentType: "ARCustomers", documentId: created };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const number = await this.requireClient().findCustomerNumberByEmail(email);
    return number ? { documentType: "ARCustomers", documentId: number } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const rows = await this.requireClient().pullProductCatalog(sinceTimestamp);
    return rows.map((r) => ({ sku: r.sku, title: r.title, customFields: {} }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // No documented throttling found (2026-08-10 research) -- consistent with Sage 300 typically
    // being a single self-hosted install rather than a shared multi-tenant service with vendor-
    // enforced limits. This cap is a conservative self-imposed default to avoid overwhelming a
    // merchant's own (possibly modest) server hardware, not a researched figure -- see D4.
    return { requestsPerWindow: 30, windowSeconds: 60, backoffStrategy: "fixed" };
  }
}
