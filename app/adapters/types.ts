// Every ERP adapter implements this interface. Mirrors erp-connector-dev-spec.md §4 -- keep
// both in sync when changing either. The sync worker and reconciliation worker (Milestone 3-4)
// only ever talk to an ERP through this interface, never directly.

import type {
  CanonicalCustomer,
  CanonicalInventoryLevel,
  CanonicalOrder,
  CanonicalProduct,
  CanonicalRefund,
} from "../models/canonical";

export interface ERPCredentials {
  authType: "oauth2" | "api_key" | "token_based" | "session";
  values: Record<string, string>;
}

export interface ConnectionResult {
  success: boolean;
  erpInstanceId?: string;
  message?: string;
}

export interface FieldMapping {
  shopifyField: string;
  erpField: string;
  transformRule?: string;
  isRequired: boolean;
}

export interface FieldMappingTemplate {
  entityType: "order" | "customer" | "product" | "inventory";
  mappings: FieldMapping[];
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface ERPDocumentRef {
  documentType: string;
  documentId: string;
  documentUrl?: string;
}

export interface ERPOrderStatus {
  erpDocumentRef: ERPDocumentRef;
  status: string;
  total: number;
  lastUpdated: string;
}

export interface RateLimitPolicy {
  requestsPerWindow: number;
  windowSeconds: number;
  backoffStrategy: "exponential" | "fixed";
}

export interface ERPAdapter {
  // Connection
  authenticate(credentials: ERPCredentials): Promise<ConnectionResult>;
  testConnection(): Promise<{ success: boolean; message?: string }>;

  // Mapping
  getDefaultFieldMappings(): FieldMappingTemplate;
  validateMapping(mapping: FieldMapping[]): ValidationIssue[];

  // Orders
  pushOrder(order: CanonicalOrder, mapping: FieldMapping[]): Promise<ERPDocumentRef>;
  pushRefund(refund: CanonicalRefund, mapping: FieldMapping[]): Promise<ERPDocumentRef>;
  getOrderStatus(erpDocumentRef: ERPDocumentRef): Promise<ERPOrderStatus>;

  // Inventory
  pullInventoryDeltas(sinceTimestamp: string): Promise<CanonicalInventoryLevel[]>;
  supportsInventoryWebhooks(): boolean;

  // Customers
  pushCustomer(customer: CanonicalCustomer): Promise<ERPDocumentRef>;
  findCustomer(email: string): Promise<ERPDocumentRef | null>;

  // Products
  pullProductCatalog(sinceTimestamp?: string): Promise<CanonicalProduct[]>;

  // Rate limiting
  getRateLimitPolicy(): RateLimitPolicy;
}
