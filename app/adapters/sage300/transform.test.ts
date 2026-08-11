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

  // Regression coverage for erp-connector-fixes-spec.md F7.
  it("maps ship-to address by default, but leaves billing address and totals unmapped", () => {
    const richOrder: CanonicalOrder = {
      ...baseOrder,
      exchangeRateAtTransaction: 1.35,
      shippingAddress: {
        address1: "2 Oak Ave",
        address2: "Unit 4",
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

    const payload = canonicalOrderToSage300Order(richOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "1200");

    expect(payload.ShipToAddress1).toBe("2 Oak Ave");
    expect(payload.ShipToAddress2).toBe("Unit 4");
    expect(payload.ShipToCity).toBe("Shelbyville");
    expect(payload.ShipToStateProvince).toBe("IL");
    expect(payload.ShipToZipPostal).toBe("62565");
    expect(payload.ShipToCountry).toBe("US");

    // No default target exists yet for these (see mapping.ts).
    expect(payload.shippingTotal).toBeUndefined();
    expect(payload.taxTotal).toBeUndefined();
    expect(payload.discountTotal).toBeUndefined();
    expect(payload.giftCardTotal).toBeUndefined();
    expect(payload.exchangeRate).toBeUndefined();
    expect(payload.BillToAddress1).toBeUndefined();
  });

  it("sets a computed total once mapping is retargeted to a real field", () => {
    const richOrder: CanonicalOrder = { ...baseOrder, shippingLines: [{ title: "Standard", amount: 6.5 }] };
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.shippingTotal" ? { ...m, erpField: "FreightAmount" } : m,
    );

    const payload = canonicalOrderToSage300Order(richOrder, customMapping, { "WIDGET-1": "WIDGET-1" }, "1200");

    expect(payload.FreightAmount).toBe(6.5);
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
