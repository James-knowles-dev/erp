// Canonical data model every ERP adapter translates to and from. Mirrors
// erp-connector-dev-spec.md §3 -- keep both in sync when changing either.

export interface CanonicalAddress {
  name?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode?: string;
  countryCode: string;
  zip: string;
  phone?: string;
}

export interface CanonicalLineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  isBundle: boolean;
  bundleComponents?: { sku: string; quantity: number }[];
  taxable: boolean;
  fulfillableQuantity: number;
  fulfilledQuantity: number;
}

export interface CanonicalDiscount {
  code?: string;
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  appliesTo: "order" | "line_item" | "shipping";
  targetLineItemSkus?: string[];
}

export interface CanonicalTaxLine {
  title: string;
  rate: number;
  amount: number;
  jurisdiction?: string;
}

export interface CanonicalShippingLine {
  title: string;
  amount: number;
  carrierService?: string;
}

export interface CanonicalGiftCard {
  code: string;
  amountUsed: number;
}

export interface CanonicalFulfillment {
  id: string;
  status: "pending" | "in_transit" | "delivered" | "cancelled";
  lineItems: { sku: string; quantity: number }[];
  trackingNumber?: string;
  shippedAt?: string;
}

export interface CanonicalCustomer {
  id: string;
  email: string;
  isGuest: boolean;
  companyName?: string;
  netTermsDays?: number;
  priceListId?: string;
  tags: string[];
}

export interface CanonicalOrder {
  id: string;
  shopId: string;
  createdAt: string;
  currency: string;
  exchangeRateAtTransaction?: number;
  customer: CanonicalCustomer;
  billingAddress: CanonicalAddress;
  shippingAddress: CanonicalAddress;
  lineItems: CanonicalLineItem[];
  discounts: CanonicalDiscount[];
  taxLines: CanonicalTaxLine[];
  shippingLines: CanonicalShippingLine[];
  giftCards: CanonicalGiftCard[];
  financialStatus: "pending" | "paid" | "partially_refunded" | "refunded" | "voided";
  fulfillmentStatus: "unfulfilled" | "partial" | "fulfilled";
  fulfillments: CanonicalFulfillment[];
  isB2B: boolean;
  companyId?: string;
}

export interface CanonicalRefund {
  orderId: string;
  refundId: string;
  lineItems: { sku: string; quantity: number; amount: number }[];
  reason?: string;
  targetErpDocumentType: "credit_memo" | "reversed_invoice" | "cancelled_order";
  // The ERP-side document id being credited/reversed/cancelled -- e.g. the NetSuite salesOrder
  // or invoice internal id. Missing from the original dev-spec §3 shape; without it an adapter
  // has no way to know which ERP record a refund applies to. The sync worker (Milestone 3)
  // resolves this from sync_jobs.erp_document_ref before calling pushRefund().
  originalErpDocumentId: string;
}

export interface CanonicalInventoryLevel {
  sku: string;
  locationId: string;
  erpWarehouseId: string;
  available: number;
  safetyStockBuffer: number;
  lastUpdated: string;
}

export interface CanonicalProduct {
  sku: string;
  title: string;
  variantOf?: string;
  customFields: Record<string, string | number>;
}
