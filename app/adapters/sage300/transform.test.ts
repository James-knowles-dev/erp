import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToSage300Order, canonicalRefundToSage300Operation } from "./transform";

const baseOrder: CanonicalOrder = {
  id: "shopify-order-1",
  shopId: "shop-1",
  createdAt: "2026-08-10T12:34:56Z",
  currency: "USD",
  customer: { id: "cust-1", email: "buyer@example.com", isGuest: false, tags: [] },
  billingAddress: { address1: "1 Main St", city: "Springfield", countryCode: "US", zip: "00000" },
  shippingAddress: { address1: "1 Main St", city: "Springfield", countryCode: "US", zip: "00000" },
  lineItems: [
    {
      sku: "WIDGET-1",
      quantity: 2,
      unitPrice: 19.99,
      isBundle: false,
      taxable: true,
      fulfillableQuantity: 2,
      fulfilledQuantity: 0,
    },
  ],
  discounts: [],
  taxLines: [],
  shippingLines: [],
  giftCards: [],
  financialStatus: "paid",
  fulfillmentStatus: "unfulfilled",
  fulfillments: [],
  isB2B: false,
};

const mapping = getDefaultFieldMappings().mappings;

describe("canonicalOrderToSage300Order", () => {
  it("maps header fields", () => {
    const payload = canonicalOrderToSage300Order(baseOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "1200");

    expect(payload.CustomerNumber).toBe("1200");
    expect(payload.OrderDate).toBe("2026-08-10");
    expect(payload.CurrencyCode).toBe("USD");
  });

  it("resolves line items into OEOrderDetails", () => {
    const payload = canonicalOrderToSage300Order(baseOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "1200");

    expect(payload.OEOrderDetails).toEqual({
      OEOrderDetail: [{ ItemNumber: "WIDGET-1", QuantityOrdered: 2, UnitPrice: 19.99 }],
    });
  });

  it("throws if a line item's SKU has no resolved Sage 300 item", () => {
    expect(() => canonicalOrderToSage300Order(baseOrder, mapping, {}, "1200")).toThrow(/WIDGET-1/);
  });
});

describe("canonicalRefundToSage300Operation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "SO-000555",
  };

  it("builds a credit note payload referencing the original order for credit_memo refunds", () => {
    const op = canonicalRefundToSage300Operation(refund, mapping, { "WIDGET-1": "WIDGET-1" });

    expect(op).toEqual({
      type: "credit_note",
      payload: {
        FromOrderNumber: "SO-000555",
        OEDocumentDetails: { OEDocumentDetail: [{ ItemNumber: "WIDGET-1", QuantityOrdered: 1 }] },
      },
    });
  });

  it("targets a cancel operation for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToSage300Operation(cancelledRefund, mapping, {});

    expect(op).toEqual({ type: "cancel_order", orderNumber: "SO-000555" });
  });
});
