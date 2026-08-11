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
});
