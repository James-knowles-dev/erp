import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToBrightpearlSalesOrder, canonicalRefundToBrightpearlOperation } from "./transform";

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

describe("canonicalOrderToBrightpearlSalesOrder", () => {
  it("maps header fields", () => {
    const payload = canonicalOrderToBrightpearlSalesOrder(baseOrder, mapping, { "WIDGET-1": "9001" }, "555");

    expect(payload.customerId).toBe(555);
    expect(payload.placedOn).toBe("2026-08-10T12:34:56Z");
    expect(payload.currency).toEqual({ code: "USD" });
  });

  it("resolves line items to Brightpearl product ids via the rows array", () => {
    const payload = canonicalOrderToBrightpearlSalesOrder(baseOrder, mapping, { "WIDGET-1": "9001" }, "555");

    expect(payload.rows).toEqual([
      { productId: "9001", quantity: "2", unitPrice: 19.99, taxCode: "T0" },
    ]);
  });

  it("throws if a line item's SKU has no resolved Brightpearl product id", () => {
    expect(() => canonicalOrderToBrightpearlSalesOrder(baseOrder, mapping, {}, "555")).toThrow(/WIDGET-1/);
  });
});

describe("canonicalRefundToBrightpearlOperation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "778",
  };

  it("builds a sales-credit payload linked to the original order for credit_memo refunds", () => {
    const op = canonicalRefundToBrightpearlOperation(refund, mapping, { "WIDGET-1": "9001" });

    expect(op).toEqual({
      type: "credit_note",
      payload: {
        parentId: 778,
        rows: [{ productId: "9001", quantity: "1", taxCode: "T0" }],
      },
    });
  });

  it("targets a status update for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToBrightpearlOperation(cancelledRefund, mapping, {});

    expect(op).toEqual({ type: "cancel_order", orderId: "778", statusId: "6" });
  });
});
