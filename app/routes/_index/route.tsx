import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

const FEATURES = [
  {
    title: "Real-time sync",
    text:
      "Orders push to your ERP the moment they're placed, wherever the ERP's own API supports it -- " +
      "reconciled continuously everywhere else, so nothing is quietly batch-polled without you knowing.",
  },
  {
    title: "Reconciliation that never sleeps",
    text:
      "Every order is checked against your ERP on a short cycle, not just nightly -- a webhook that " +
      "silently failed gets caught in minutes, not discovered during month-end close.",
  },
  {
    title: "Built for agencies",
    text:
      "Manage every client's connection from one dashboard, with reusable mapping templates and " +
      "white-label reports -- one tool across NetSuite, Business Central, Acumatica, and Sage clients alike.",
  },
];

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <p className={styles.eyebrow}>Shopify Multi-ERP Connector</p>
        <h1 className={styles.heading}>Sync Shopify to your ERP, without an integrator</h1>
        <p className={styles.text}>
          One consistent setup for NetSuite, Business Central, Acumatica, Sage Intacct, Sage 300, or
          Brightpearl -- self-serve, transparently priced, and reconciled around the clock.
        </p>

        {showForm && (
          <div className={styles.card}>
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label} htmlFor="shop">
                Shop domain
              </label>
              <div className={styles.formRow}>
                <input
                  id="shop"
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="my-shop-domain.myshopify.com"
                  autoComplete="off"
                />
                <button className={styles.button} type="submit">
                  Log in
                </button>
              </div>
            </Form>
          </div>
        )}

        <ul className={styles.list}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className={styles.listItem}>
              <span className={styles.listAccent} aria-hidden="true" />
              <strong className={styles.listTitle}>{feature.title}</strong>
              <span className={styles.listText}>{feature.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
