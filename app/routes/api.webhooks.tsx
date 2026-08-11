import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { requireApiKeyConnection } from "../utils/apiKey.server";
import { createWebhookSubscription, listWebhookSubscriptions } from "../sync/webhookSubscriptions.server";
import { EVENT_TYPES, type WebhookEventType } from "../sync/webhookEventTypes";
import { validateExternalUrl } from "../utils/urlSafety.server";

// Agency-facing API (product spec §7.7) -- authenticated via the connection's own API key
// (app/routes/app.settings.tsx), not a Shopify session. Not under /app for exactly that reason:
// an agency's script isn't a merchant sitting in the embedded admin.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const connection = await requireApiKeyConnection(request);
  const subscriptions = await listWebhookSubscriptions(connection.id);
  return Response.json({ subscriptions });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") throw new Response("Method not allowed", { status: 405 });

  const connection = await requireApiKeyConnection(request);
  const body = (await request.json()) as { url?: string; eventTypes?: string[] };

  if (!body.url || !URL.canParse(body.url)) {
    return Response.json({ error: "A valid 'url' is required." }, { status: 400 });
  }
  // SSRF guard (erp-connector-fixes-spec.md F3): this URL is fetched server-side on every
  // matching sync event (see webhookDispatch.server.ts) -- reject anything that isn't a public
  // https:// host rather than accepting any syntactically valid URL.
  const urlCheck = await validateExternalUrl(body.url);
  if (!urlCheck.valid) {
    return Response.json({ error: `'url' is invalid: ${urlCheck.reason}` }, { status: 400 });
  }
  const eventTypes = (body.eventTypes ?? []) as WebhookEventType[];
  const invalid = eventTypes.filter((e) => !EVENT_TYPES.includes(e));
  if (eventTypes.length === 0 || invalid.length > 0) {
    return Response.json(
      { error: `'eventTypes' must be a non-empty array from: ${EVENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const { id, secret } = await createWebhookSubscription(connection.id, body.url, eventTypes);
  // secret is only ever returned here, at creation time -- store it now, it can't be retrieved
  // again (see webhookSubscriptions.server.ts).
  return Response.json({ id, secret }, { status: 201 });
};
