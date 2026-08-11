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

  // Regression coverage for erp-connector-fixes-spec.md F7.
  it("maps both addresses, but leaves shipping/tax/discount/gift-card/exchange-rate unmapped by default", () => {
    const richOrder: CanonicalOrder = {
      ...baseOrder,
      exchangeRateAtTransaction: 1.35,
      billingAddress: {
        address1: "1 Main St",
        address2: "Suite 2",
        city: "Springfield",
        provinceCode: "IL",
        countryCode: "US",
        zip: "62704",
      },
      shippingAddress: {
        address1: "2 Oak Ave",
        city: "Shelbyville",
        provinceCode: "IL",
        countryCode: "US",
        zip: "62565",
      },
      discounts: [
        { type: "fixed_amount", value: 5, appliesTo: "order" },
        { type: "percentage", value: 10, appliesTo: "order" },
      ],
      taxLines: [{ title: "State Tax", rate: 0.07, amount: 2.8 }],
      shippingLines: [{ title: "Standard", amount: 6.5 }],
      giftCards: [{ code: "GC-1", amountUsed: 10 }],
    };

    const payload = canonicalOrderToSalesOrder(richOrder, mapping, { "WIDGET-1": "item-guid-1" }, "C0001");

    expect(payload.billToAddressLine1).toBe("1 Main St");
    expect(payload.billToAddressLine2).toBe("Suite 2");
    expect(payload.billToCity).toBe("Springfield");
    expect(payload.billToState).toBe("IL");
    expect(payload.billToPostCode).toBe("62704");
    expect(payload.billToCountry).toBe("US");
    expect(payload.shipToAddressLine1).toBe("2 Oak Ave");
    expect(payload.shipToCity).toBe("Shelbyville");

    // No default target exists for these yet (see mapping.ts) -- confirms they're computed but
    // genuinely unmapped, not silently mis-set, until a merchant/agency publishes a custom field.
    expect(payload.shippingTotal).toBeUndefined();
    expect(payload.taxTotal).toBeUndefined();
    expect(payload.discountTotal).toBeUndefined();
    expect(payload.giftCardTotal).toBeUndefined();
    expect(payload.exchangeRate).toBeUndefined();
  });

  it("sets a computed total once mapping is retargeted to a real field", () => {
    const richOrder: CanonicalOrder = {
      ...baseOrder,
      shippingLines: [{ title: "Standard", amount: 6.5 }],
    };
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.shippingTotal" ? { ...m, erpField: "shippingChargeAmount" } : m,
    );

    const payload = canonicalOrderToSalesOrder(richOrder, customMapping, { "WIDGET-1": "item-guid-1" }, "C0001");

    expect(payload.shippingChargeAmount).toBe(6.5);
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
