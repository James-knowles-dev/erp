import { describe, expect, it } from "vitest";
import type { CanonicalOrder, CanonicalRefund } from "../../models/canonical";
import { getDefaultFieldMappings } from "./mapping";
import { canonicalOrderToSalesOrder, canonicalRefundToSageIntacctOperation } from "./transform";

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
  it("maps header fields", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "C0001");

    expect(payload.DOCPARID).toBe("Sales Order");
    expect(payload.CUSTOMERID).toBe("C0001");
    expect(payload.WHENCREATED).toBe("2026-08-10");
    expect(payload.CURRENCY).toBe("USD");
  });

  it("resolves line items into SODOCUMENTENTRIES", () => {
    const payload = canonicalOrderToSalesOrder(baseOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "C0001");

    expect(payload.SODOCUMENTENTRIES).toEqual({
      SODOCUMENTENTRY: [{ ITEMID: "WIDGET-1", QUANTITY: 2, PRICE: 19.99 }],
    });
  });

  it("throws if a line item's SKU has no resolved Sage Intacct item", () => {
    expect(() => canonicalOrderToSalesOrder(baseOrder, mapping, {}, "C0001")).toThrow(/WIDGET-1/);
  });

  // Regression coverage for erp-connector-fixes-spec.md F7.
  it("computes shipping/tax/discount/gift-card totals but leaves them unmapped by default", () => {
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

    const payload = canonicalOrderToSalesOrder(richOrder, mapping, { "WIDGET-1": "WIDGET-1" }, "C0001");

    // No default target exists yet (see mapping.ts) -- nothing lands on the payload until a
    // merchant/agency retargets the mapping to a field confirmed against their own account.
    expect(Object.keys(payload)).toEqual(["DOCPARID", "CUSTOMERID", "WHENCREATED", "CURRENCY", "SODOCUMENTENTRIES"]);
  });

  it("sets a computed total once mapping is retargeted to a real field", () => {
    const richOrder: CanonicalOrder = { ...baseOrder, shippingLines: [{ title: "Standard", amount: 6.5 }] };
    const customMapping = mapping.map((m) =>
      m.shopifyField === "order.shippingTotal" ? { ...m, erpField: "CUSTOM_SHIPPING_TOTAL" } : m,
    );

    const payload = canonicalOrderToSalesOrder(richOrder, customMapping, { "WIDGET-1": "WIDGET-1" }, "C0001");

    expect(payload.CUSTOM_SHIPPING_TOTAL).toBe(6.5);
  });
});

describe("canonicalRefundToSageIntacctOperation", () => {
  const refund: CanonicalRefund = {
    orderId: "shopify-order-1",
    refundId: "shopify-refund-1",
    lineItems: [{ sku: "WIDGET-1", quantity: 1, amount: 19.99 }],
    targetErpDocumentType: "credit_memo",
    originalErpDocumentId: "INV-000555",
  };

  it("builds an AR adjustment against the original invoice for credit_memo refunds", () => {
    const op = canonicalRefundToSageIntacctOperation(refund, mapping);

    expect(op).toEqual({
      type: "ar_adjustment",
      payload: {
        INVOICENO: "INV-000555",
        ARADJUSTMENTITEMS: { ARADJUSTMENTITEM: [{ AMOUNT: 19.99, QUANTITY: 1 }] },
      },
    });
  });

  it("targets a cancel operation for cancelled_order refunds", () => {
    const cancelledRefund: CanonicalRefund = { ...refund, targetErpDocumentType: "cancelled_order" };
    const op = canonicalRefundToSageIntacctOperation(cancelledRefund, mapping);

    expect(op).toEqual({ type: "cancel_order", recordNo: "INV-000555" });
  });

  // Regression test for erp-connector-fixes-spec.md F6: `refund.lineItems.length` (item count)
  // was previously used where a summed quantity was needed -- the single-line, quantity-1 fixture
  // above can't catch that bug because both values happen to be 1 there.
  it("sums line item quantities rather than counting line items", () => {
    const multiQuantityRefund: CanonicalRefund = {
      ...refund,
      lineItems: [
        { sku: "WIDGET-1", quantity: 3, amount: 59.97 },
        { sku: "WIDGET-2", quantity: 2, amount: 15.0 },
      ],
    };
    const op = canonicalRefundToSageIntacctOperation(multiQuantityRefund, mapping);

    expect(op).toEqual({
      type: "ar_adjustment",
      payload: {
        INVOICENO: "INV-000555",
        ARADJUSTMENTITEMS: { ARADJUSTMENTITEM: [{ AMOUNT: 74.97, QUANTITY: 5 }] },
      },
    });
  });
});
