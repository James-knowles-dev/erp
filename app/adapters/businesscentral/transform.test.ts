import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToBusinessCentralOperation } from "./transform";

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

describe("canonicalOrderToSalesOrder", () => {
  it("maps header fields as plain (unwrapped) JSON values", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "item-guid-1" }, "C0001");

    expect(payload.customerNumber).toBe("C0001");
    expect(payload.orderDate).toBe("2026-08-10");
    expect(payload.currencyCode).toBe("USD");
  });

  it("resolves line items to Business Central item ids via the salesOrderLines array", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "item-guid-1" }, "C0001");

    expect(payload.salesOrderLines).toEqual([
      {
        itemId: "item-guid-1",
        lineType: "Item",
        lineObjectNumber: "WIDGET-1",
        quantity: 2,
        unitPrice: 19.99,
      },
    ]);
  });

  it("throws if a line item's SKU has no resolved Business Central item id", () => {
    expect(() => canonicalOrderToSalesOrder(baseOrder, mapping, {}, "C0001")).toThrow(/WIDGET-1/);
  });
});

describe("canonicalRefundToBusinessCentralOperation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "SO-000555",
  };

  it("POSTs a new salesCreditMemos record for credit_memo refunds", () => {
    const op = canonicalRefundToBusinessCentralOperation(refund, mapping, { "WIDGET-1": "item-guid-1" });

    expect(op.method).toBe("POST");
    expect(op.entity).toBe("salesCreditMemos");
    expect(op.payload.salesCreditMemoLines).toEqual([
      { itemId: "item-guid-1", lineType: "Item", lineObjectNumber: "WIDGET-1", quantity: 1 },
    ]);
  });

  it("PATCHes the original salesOrders record for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToBusinessCentralOperation(cancelledRefund, mapping, {});

    expect(op.method).toBe("PATCH");
    expect(op.entity).toBe("salesOrders");
    expect(op.payload).toEqual({ id: "SO-000555", status: "Cancelled" });
  });
});
