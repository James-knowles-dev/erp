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
import { AcumaticaClient } from "./client.server";
import { getDefaultFieldMappings, validateMapping } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToAcumaticaOperation } from "./transform";
import type { AcumaticaConfig, AcumaticaTokens } from "./types";

// Implements ERPAdapter for Acumatica -- structurally a near-mirror of
// app/adapters/netsuite/adapter.server.ts. Two real differences worth noting, since they're
// exactly the kind of thing this second adapter was supposed to prove the pattern handles: no
// item-id resolution step (Acumatica references stock items by InventoryID/SKU directly), and no
// separate customer-lookup-before-push distinction -- see pushOrder below.
export class AcumaticaAdapter implements ERPAdapter {
  private client: AcumaticaClient | null = null;

  async authenticate(credentials: ERPCredentials): Promise<ConnectionResult> {
    if (credentials.authType !== "oauth2") {
      return { success: false, message: "AcumaticaAdapter requires oauth2 credentials." };
    }

    const { instanceUrl, clientId, clientSecret, accessToken, refreshToken, expiresAt } = credentials.values;
    if (!instanceUrl || !clientId || !clientSecret || !accessToken || !refreshToken) {
      return {
        success: false,
        message:
          "Missing required Acumatica credential fields (instanceUrl, clientId, clientSecret, accessToken, refreshToken).",
      };
    }

    const config: AcumaticaConfig = { instanceUrl, clientId, clientSecret };
    const tokens: AcumaticaTokens = {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ?? new Date().toISOString(),
    };
    this.client = new AcumaticaClient(config, tokens);

    return { success: true, erpInstanceId: instanceUrl };
  }

  private requireClient(): AcumaticaClient {
    if (!this.client) {
      throw new Error("AcumaticaAdapter.authenticate() must succeed before any other call.");
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

    const customerId = await client.findCustomerIdByEmail(order.customer.email);
    if (!customerId) {
      throw new Error(
        `No Acumatica customer found for ${order.customer.email}. Automatic customer creation is ` +
          `an edge-case-rule decision not yet wired up (see product spec §7.1 step 5).`,
      );
    }

    const payload = canonicalOrderToSalesOrder(order, mapping, customerId);
    const { orderNbr } = await client.pushSalesOrder(payload);
    return { documentType: "SalesOrder", documentId: orderNbr };
  }

  async pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef> {
    const client = this.requireClient();
    const operation = canonicalRefundToAcumaticaOperation(refund, mapping);
    const { orderNbr } = await client.executeRefundOperation(operation);
    return { documentType: operation.entity, documentId: orderNbr };
  }

  async getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus> {
    const { status, total } = await this.requireClient().getOrderTotal(erpDocumentRef.documentId);
    return { erpDocumentRef, status, total, lastUpdated: new Date().toISOString() };
  }

  async pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]> {
    return this.requireClient().queryInventoryDeltas(sinceTimestamp);
  }

  supportsInventoryWebhooks(): boolean {
    // Acumatica's REST API doesn't offer native webhook/push notifications the way NetSuite's
    // optional SuiteScript setup does -- polling only, per the product/dev spec's own honesty
    // about which ERPs get real-time by default (see erp-connector-spec.md §3's caveat).
    return false;
  }

  async pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef> {
    const client = this.requireClient();

    const existingId = await client.findCustomerIdByEmail(customer.email);
    if (existingId) return { documentType: "Customer", documentId: existingId };

    const { id } = await client.createCustomer({
      CustomerName: { value: customer.companyName ?? customer.email },
      MainContact: { Email: { value: customer.email } },
    });
    return { documentType: "Customer", documentId: id };
  }

  async findCustomer(email: string): Promise<ERPDocumentRef | null> {
    const id = await this.requireClient().findCustomerIdByEmail(email);
    return id ? { documentType: "Customer", documentId: id } : null;
  }

  async pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]> {
    const rows = await this.requireClient().pullProductCatalog(sinceTimestamp);
    return rows.map((r) => ({ sku: r.sku, title: r.title, customFields: {} }));
  }

  getRateLimitPolicy(): RateLimitPolicy {
    // TODO(D4): Acumatica's rate limiting is license/instance-tier dependent rather than a
    // single documented number the way NetSuite's concurrency governance is -- this is a
    // placeholder approximation, not a researched figure, pending verification against a real
    // instance's actual behavior.
    return { requestsPerWindow: 10, windowSeconds: 1, backoffStrategy: "exponential" };
  }
}
