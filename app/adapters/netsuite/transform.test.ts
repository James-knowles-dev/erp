import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToNetSuiteOperation } from "./transform";

const baseOrder: CanonicalOrder = {
  id: "shopify-order-1",
  shopId: "shop-1",
  createdAt: "2026-08-10T12:34:56Z",
  currency: "USD",
  customer: { id: "cust-1", email: "buyer@example.com", isGuest: false, tags: [] },
  billingAddress: {
    address1: "1 Main St",
    city: "Springfield",
    countryCode: "US",
    zip: "00000",
  },
  shippingAddress: {
    address1: "1 Main St",
    city: "Springfield",
    countryCode: "US",
    zip: "00000",
  },
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
  it("maps header fields to their default NetSuite targets", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "999" }, "42");

    expect(payload.entity).toEqual({ id: "42" });
    expect(payload.trandate).toBe("2026-08-10");
    expect(payload.currency).toBe("USD");
    expect(payload.custbody_shopify_order_id).toBe("shopify-order-1");
  });

  it("resolves line items to NetSuite internal item ids", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "999" }, "42");

    expect(payload.item.items).toEqual([{ item: { id: "999" }, quantity: 2, rate: 19.99 }]);
  });

  it("throws if a line item's SKU has no resolved NetSuite item id", () => {
    expect(() => canonicalOrderToSalesOrder(baseOrder, mapping, {}, "42")).toThrow(/WIDGET-1/);
  });

  it("respects a custom mapping target instead of the default", () => {
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.currency" ? { ...m, erpField: "currencyCode" } : m,
    );

    const payload = canonicalOrderToSalesOrder(baseOrder, customMapping, { "WIDGET-1": "999" }, "42");

    expect(payload.currencyCode).toBe("USD");
    expect(payload.currency).toBeUndefined();
  });

  // Regression coverage for erp-connector-fixes-spec.md F7: tax/discount/shipping/gift-card/
  // address were previously dropped entirely -- this order carries all of them plus an exchange
  // rate, so the resulting payload's totals should reconcile against the canonical order.
  it("maps shipping/tax/discount/gift-card totals, exchange rate, and both addresses", () => {
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
        { type: "percentage", value: 10, appliesTo: "order" }, // excluded -- see transform.ts's comment
      ],
      taxLines: [{ title: "State Tax", rate: 0.07, amount: 2.8 }],
      shippingLines: [{ title: "Standard", amount: 6.5 }],
      giftCards: [{ code: "GC-1", amountUsed: 10 }],
    };

    const payload = canonicalOrderToSalesOrder(richOrder, mapping, { "WIDGET-1": "999" }, "42");

    expect(payload.shippingcost).toBe(6.5);
    expect(payload.custbody_shopify_tax_total).toBe(2.8);
    expect(payload.custbody_shopify_discount_total).toBe(5);
    expect(payload.custbody_shopify_giftcard_total).toBe(10);
    expect(payload.exchangerate).toBe(1.35);
    expect(payload.billingaddress).toEqual({
      addr1: "1 Main St",
      addr2: "Suite 2",
      city: "Springfield",
      state: "IL",
      zip: "62704",
      country: "US",
    });
    expect(payload.shippingaddress).toEqual({
      addr1: "2 Oak Ave",
      city: "Shelbyville",
      state: "IL",
      zip: "62565",
      country: "US",
    });
  });

  it("omits exchange rate entirely when the order has none", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "999" }, "42");
    expect(payload.exchangerate).toBeUndefined();
  });
});

describe("canonicalRefundToNetSuiteOperation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "555",
  };

  it("builds a POST creditMemo operation for credit_memo refunds", () => {
    const op = canonicalRefundToNetSuiteOperation(refund, mapping, { "WIDGET-1": "999" });

    expect(op.method).toBe("POST");
    expect(op.recordType).toBe("creditMemo");
    expect(op.payload.createdfrom).toEqual({ id: "555" });
    expect(op.payload.item).toEqual({ items: [{ item: { id: "999" }, quantity: 1 }] });
  });

  it("builds a PATCH salesOrder operation for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToNetSuiteOperation(cancelledRefund, mapping, {});

    expect(op.method).toBe("PATCH");
    expect(op.recordType).toBe("salesOrder");
    expect(op.payload).toEqual({ id: "555", orderstatus: "cancelled" });
  });

  it("throws if a refund line item's SKU has no resolved NetSuite item id", () => {
    expect(() => canonicalRefundToNetSuiteOperation(refund, mapping, {})).toThrow(/WIDGET-1/);
  });
});
