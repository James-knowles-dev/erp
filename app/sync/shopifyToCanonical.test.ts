import { describe, expect, it } from "vitest";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "./shopifyToCanonical";

const payload: ShopifyOrderPayload = {
  // Kept within Number.MAX_SAFE_INTEGER deliberately -- see the precision-loss note in
  // shopifyToCanonical.ts. A real order id can exceed this; that's a Shopify-side limitation
  // this test isn't the place to demonstrate.
  id: 820982911946154,
  created_at: "2026-08-10T12:00:00-04:00",
  currency: "USD",
  total_discounts: "5.00",
  customer: { id: 207119551, email: "bob@example.com", tags: "vip, wholesale" },
  billing_address: {
    first_name: "Bob",
    last_name: "Norman",
    address1: "1 Main St",
    city: "Ottawa",
    province_code: "ON",
    country_code: "CA",
    zip: "K1A 0B1",
  },
  shipping_address: {
    first_name: "Bob",
    last_name: "Norman",
    address1: "1 Main St",
    city: "Ottawa",
    province_code: "ON",
    country_code: "CA",
    zip: "K1A 0B1",
  },
  line_items: [
    {
      sku: "WIDGET-1",
      quantity: 2,
      price: "19.99",
      taxable: true,
      fulfillable_quantity: 1,
      fulfillment_status: "partial",
    },
  ],
  tax_lines: [{ title: "HST", price: "2.60", rate: 0.13 }],
  shipping_lines: [{ title: "Standard", price: "5.00" }],
  financial_status: "paid",
  fulfillment_status: "partial",
  fulfillments: [
    {
      id: 255858046,
      status: "success",
      tracking_number: "1Z999",
      line_items: [{ sku: "WIDGET-1", quantity: 1 }],
    },
  ],
};

describe("shopifyOrderToCanonical", () => {
  it("maps identifiers, currency, and financial/fulfillment status", () => {
    const order = shopifyOrderToCanonical("shop-1", payload);

    expect(order.id).toBe("820982911946154");
    expect(order.shopId).toBe("shop-1");
    expect(order.currency).toBe("USD");
    expect(order.financialStatus).toBe("paid");
    expect(order.fulfillmentStatus).toBe("partial");
  });

  it("maps customer email, guest status, and split tags", () => {
    const order = shopifyOrderToCanonical("shop-1", payload);

    expect(order.customer.email).toBe("bob@example.com");
    expect(order.customer.isGuest).toBe(false);
    expect(order.customer.tags).toEqual(["vip", "wholesale"]);
  });

  it("treats an order with no customer record as a guest", () => {
    const guestPayload = { ...payload, customer: null, email: "guest@example.com" };
    const order = shopifyOrderToCanonical("shop-1", guestPayload);

    expect(order.customer.isGuest).toBe(true);
    expect(order.customer.id).toBe("guest");
    expect(order.customer.email).toBe("guest@example.com");
  });

  it("maps line items with computed fulfilledQuantity", () => {
    const order = shopifyOrderToCanonical("shop-1", payload);

    expect(order.lineItems).toEqual([
      {
        sku: "WIDGET-1",
        quantity: 2,
        unitPrice: 19.99,
        isBundle: false,
        taxable: true,
        fulfillableQuantity: 1,
        fulfilledQuantity: 1,
      },
    ]);
  });

  it("collapses total_discounts into a single order-level discount", () => {
    const order = shopifyOrderToCanonical("shop-1", payload);

    expect(order.discounts).toEqual([{ type: "fixed_amount", value: 5, appliesTo: "order" }]);
  });

  it("omits discounts entirely when total_discounts is zero", () => {
    const order = shopifyOrderToCanonical("shop-1", { ...payload, total_discounts: "0.00" });
    expect(order.discounts).toEqual([]);
  });
});
