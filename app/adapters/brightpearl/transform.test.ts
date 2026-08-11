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

  // Regression coverage for erp-connector-fixes-spec.md F7.
  it("computes shipping/tax/discount/gift-card totals but leaves them (and addresses) unmapped by default", () => {
    const richOrder: CanonicalOrder = {
      ...baseOrder,
      exchangeRateAtTransaction: 1.35,
      discounts: [
        { type: "fixed_amount", value: 5, appliesTo: "order" },
        { type: "percentage", value: 10, appliesTo: "order" },
      ],
      taxLines: [{ title: "State Tax", rate: 0.07, amount: 2.8 }],
      shippingLines: [{ title: "Standard", amount: 6.5 }],
      giftCards: [{ code: "GC-1", amountUsed: 10 }],
    };

    const payload = canonicalOrderToBrightpearlSalesOrder(richOrder, mapping, { "WIDGET-1": "9001" }, "555");

    expect(Object.keys(payload)).toEqual(["customerId", "placedOn", "currency", "rows"]);
  });

  it("sets a computed total once mapping is retargeted to a real field", () => {
    const richOrder: CanonicalOrder = { ...baseOrder, shippingLines: [{ title: "Standard", amount: 6.5 }] };
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.shippingTotal" ? { ...m, erpField: "shippingCostIncTax" } : m,
    );

    const payload = canonicalOrderToBrightpearlSalesOrder(richOrder, customMapping, { "WIDGET-1": "9001" }, "555");

    expect(payload.shippingCostIncTax).toBe(6.5);
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
