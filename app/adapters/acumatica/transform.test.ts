import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToAcumaticaOperation } from "./transform";

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
  it("wraps every header field in a {value} object", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, "CUST0001");

    expect(payload.OrderType).toEqual({ value: "SO" });
    expect(payload.CustomerID).toEqual({ value: "CUST0001" });
    expect(payload.OrderDate).toEqual({ value: "2026-08-10" });
    expect(payload.CurrencyID).toEqual({ value: "USD" });
    expect(payload.UsrShopifyOrderId).toEqual({ value: "shopify-order-1" });
  });

  it("does not need item-id resolution -- InventoryID is the SKU directly", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, "CUST0001");

    expect(payload.Details).toEqual([
      {
        InventoryID: { value: "WIDGET-1" },
        Quantity: { value: 2 },
        UnitPrice: { value: 19.99 },
      },
    ]);
  });

  it("respects a custom mapping target instead of the default", () => {
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.currency" ? { ...m, erpField: "BaseCurrencyID" } : m,
    );

    const payload = canonicalOrderToSalesOrder(baseOrder, customMapping, "CUST0001");

    expect(payload.BaseCurrencyID).toEqual({ value: "USD" });
    expect(payload.CurrencyID).toBeUndefined();
  });
});

describe("canonicalRefundToAcumaticaOperation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "SO000555",
  };

  it("POSTs a new credit memo SalesOrder for credit_memo refunds", () => {
    const op = canonicalRefundToAcumaticaOperation(refund, mapping);

    expect(op.method).toBe("POST");
    expect(op.entity).toBe("SalesOrder");
    expect(op.payload.OrderType).toEqual({ value: "CM" });
    expect(op.payload.Details).toEqual([{ InventoryID: { value: "WIDGET-1" }, Quantity: { value: 1 } }]);
  });

  it("PUTs a status update for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToAcumaticaOperation(cancelledRefund, mapping);

    expect(op.method).toBe("PUT");
    expect(op.payload).toEqual({
      OrderNbr: { value: "SO000555" },
      Status: { value: "Cancelled" },
    });
  });
});
