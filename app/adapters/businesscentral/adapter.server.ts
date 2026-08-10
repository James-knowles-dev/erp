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
import { BusinessCentralClient } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToBusinessCentralOperation } from "./transform";
import type { BusinessCentralConfig, BusinessCentralTokens } from "./types";

// Implements ERPAdapter for Business Central -- third adapter, structurally a near-mirror of the
// NetSuite and Acumatica adapters. The real difference this one surfaces: a three-part credential
// shape (tenantId/environment/companyId) instead of one identifier, and no reachable way to stamp
// the Shopify order id onto the record itself (see the TODO(D4) in transform.ts) -- both continue
// validating that the ERPAdapter interface accommodates real per-ERP variation without needing to
// change shape itself.
export class BusinessCentralAdapter implements ERPAdapter {
  private client: BusinessCentralClient | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "oauth2") {
      return { success: false, message: "BusinessCentralAdapter requires oauth2 credentials." };
    }

    const { tenantId, environment, companyId, clientId, clientSecret, accessToken, refreshToken, expiresAt } =
      credentials.values;
    if (!tenantId || !environment || !companyId || !clientId || !clientSecret || !accessToken || !refreshToken) {
      return {
        success: false,
        message:
          "Missing required Business Central credential fields (tenantId, environment, companyId, " +
          "clientId, clientSecret, accessToken, refreshToken).",
      };
    }

    const config: BusinessCentralConfig = { tenantId, environment, companyId, clientId, clientSecret };
    const tokens: BusinessCentralTokens = {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ?? new Date().toISOString(),
    };
    this.client = new BusinessCentralClient(config, tokens);

    return { success: true, erpInstanceId: `${tenantId}/${environment}/${companyId}` };
  }

  private requireClient(): BusinessCentralClient {
    if (!this.client) {
      throw new Error("BusinessCentralAdapter.authenticate() must succeed before any other call.");
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
        `No Business Central customer found for ${order.customer.email}. Automatic customer creation ` +
          `is an edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToSalesOrder(order, mapping, itemIds, customerNumber);
    const { id } = await client.pushSalesOrder(payload);
    return { documentType: "salesOrders", documentId: id };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const itemIds = await client.resolveItemIds(refund.lineItems.map((li) => li.sku));
    const operation = canonicalRefundToBusinessCentralOperation(refund, mapping, itemIds);
    const { id } = await client.executeRefundOperation(operation);
    return { documentType: operation.entity, documentId: id };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const { status, total } = await this.requireClient().getOrderTotal(erpDocumentRef.documentId);
    return { erpDocumentRef, status, total, lastUpdated: new Date().toISOString() };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    return this.requireClient().queryInventoryDeltas(sinceTimestamp);
  }

  supportsInventoryWebhooks(): boolean {
    // Business Central does have native webhook/change-tracking support via OData (per the dev
    // spec's adapter table), unlike NetSuite (requires customer-side setup) and Acumatica (no
    // native support at all) -- but subscribing to it isn't built yet, so still false until that
    // exists. Worth revisiting first among the three adapters given it's the one genuinely
    // capable of it today.
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingNumber = await client.findCustomerNumberByEmail(customer.email);
    if (existingNumber) return { documentType: "customers", documentId: existingNumber };

    const { number } = await client.createCustomer({
      displayName: customer.companyName ?? customer.email,
      email: customer.email,
    });
    return { documentType: "customers", documentId: number };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const number = await this.requireClient().findCustomerNumberByEmail(email);
    return number ? { documentType: "customers", documentId: number } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const rows = await this.requireClient().pullProductCatalog(sinceTimestamp);
    return rows.map((r) => ({ sku: r.sku, title: r.title, customFields: {} }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // TODO(D4): Microsoft publishes per-tenant/per-app throttling limits for Business Central
    // (typically expressed as requests per minute with 429 + Retry-After on breach) but the exact
    // number varies by licensing tier -- this is a placeholder approximation, not a researched
    // figure, pending verification against a real environment.
    return { requestsPerWindow: 40, windowSeconds: 60, backoffStrategy: "exponential" };
  }
}
