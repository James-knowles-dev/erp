// Transforms a Shopify order webhook payload (REST Admin API order object shape) into
// CanonicalOrder. Pure function -- no network calls -- so it's unit-testable without a live
// webhook. Deliberately scoped down in a few places, called out rather than silently assumed:
// bundles aren't detected (Shopify has no native bundle concept; would need app-specific
// metafield conventions), discounts are collapsed to a single order-level entry from
// total_discounts rather than itemized per discount_applications, and B2B/company detection
// isn't wired up (isB2B always false). All fine for a first vertical slice of the sync engine;
// not fine to ship as "complete" without revisiting per product spec §7.2's fuller requirements.
//
// Known Shopify-side gotcha, not fixable here: REST-shaped webhook payloads (unlike GraphQL,
// which uses string GIDs) deliver `id` as a raw JSON number, and some real Shopify order ids
// exceed Number.MAX_SAFE_INTEGER (Shopify's own REST API docs use the 18-digit example
// 820982911946154508). Precision is already lost by the time JSON.parse hands us the payload --
// nothing downstream can recover it. Affects order/customer/fulfillment ids from webhooks.

import type { CanonicalAddress, CanonicalOrder } from "../models/canonical";

interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province_code?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
}

interface ShopifyLineItem {
  sku?: string;
  quantity: number;
  price: string;
  taxable: boolean;
  fulfillable_quantity: number;
  fulfillment_status: string | null;
}

interface ShopifyFulfillment {
  id: number;
  status: string;
  tracking_number?: string;
  line_items: { sku?: string; quantity: number }[];
}

export interface ShopifyOrderPayload {
  id: number;
  created_at: string;
  currency: string;
  total_discounts?: string;
  customer?: { id: number; email?: string; tags?: string } | null;
  email?: string;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items: ShopifyLineItem[];
  tax_lines: { title: string; price: string; rate: number | null }[];
  shipping_lines: { title: string; price: string }[];
  financial_status: string;
  fulfillment_status: string | null;
  fulfillments: ShopifyFulfillment[];
}

function toCanonicalAddress(addr: ShopifyAddress | null | undefined): CanonicalAddress {
  const name = [addr?.first_name, addr?.last_name].filter(Boolean).join(" ") || undefined;
  return {
    name,
    company: addr?.company || undefined,
    address1: addr?.address1 ?? "",
    address2: addr?.address2 || undefined,
    city: addr?.city ?? "",
    provinceCode: addr?.province_code || undefined,
    countryCode: addr?.country_code ?? "",
    zip: addr?.zip ?? "",
    phone: addr?.phone || undefined,
  };
}

function toFinancialStatus(status: string): CanonicalOrder["financialStatus"] {
  const known: CanonicalOrder["financialStatus"][] = [
    "pending",
    "paid",
    "partially_refunded",
    "refunded",
    "voided",
  ];
  return (known as string[]).includes(status) ? (status as CanonicalOrder["financialStatus"]) : "pending";
}

function toFulfillmentStatus(status: string | null): CanonicalOrder["fulfillmentStatus"] {
  if (status === "fulfilled") return "fulfilled";
  if (status === "partial") return "partial";
  return "unfulfilled";
}

export function shopifyOrderToCanonical(shopId: string, order: ShopifyOrderPayload): CanonicalOrder {
  const customerEmail = order.customer?.email ?? order.email ?? "";

  return {
    id: String(order.id),
    shopId,
    createdAt: order.created_at,
    currency: order.currency,
    customer: {
      id: order.customer ? String(order.customer.id) : "guest",
      email: customerEmail,
      isGuest: !order.customer,
      tags: order.customer?.tags ? order.customer.tags.split(",").map((t) => t.trim()) : [],
    },
    billingAddress: toCanonicalAddress(order.billing_address),
    shippingAddress: toCanonicalAddress(order.shipping_address),
    lineItems: order.line_items.map((li) => ({
      sku: li.sku ?? "",
      quantity: li.quantity,
      unitPrice: Number(li.price),
      isBundle: false,
      taxable: li.taxable,
      fulfillableQuantity: li.fulfillable_quantity,
      fulfilledQuantity: li.quantity - li.fulfillable_quantity,
    })),
    discounts: order.total_discounts && Number(order.total_discounts) > 0
      ? [{ type: "fixed_amount", value: Number(order.total_discounts), appliesTo: "order" }]
      : [],
    taxLines: order.tax_lines.map((t) => ({
      title: t.title,
      rate: t.rate ?? 0,
      amount: Number(t.price),
    })),
    shippingLines: order.shipping_lines.map((s) => ({ title: s.title, amount: Number(s.price) })),
    giftCards: [],
    financialStatus: toFinancialStatus(order.financial_status),
    fulfillmentStatus: toFulfillmentStatus(order.fulfillment_status),
    fulfillments: order.fulfillments.map((f) => ({
      id: String(f.id),
      status: f.status === "success" ? "delivered" : "in_transit",
      lineItems: f.line_items.map((li) => ({ sku: li.sku ?? "", quantity: li.quantity })),
      trackingNumber: f.tracking_number,
    })),
    isB2B: false,
  };
}
