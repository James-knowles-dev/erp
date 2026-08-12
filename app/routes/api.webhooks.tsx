import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { requireApiKeyConnection } from "../utils/apiKey.server";
import { createWebhookSubscription, listWebhookSubscriptions, type ChannelKind } from "../sync/webhookSubscriptions.server";
import { EVENT_TYPES, type WebhookEventType } from "../sync/webhookEventTypes";
import { validateExternalUrl } from "../utils/urlSafety.server";

const CHANNEL_KINDS: ChannelKind[] = ["generic", "slack", "email"];
// Deliberately simple (no RFC 5322 edge cases) -- good enough to reject an obvious mistake (a URL
// pasted where an email was expected, a typo with no '@'), not to be the sole validator of
// deliverability. nodemailer/SMTP will reject anything this lets through that still isn't real.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const body = (await request.json()) as { url?: string; eventTypes?: string[]; channelKind?: string };

  const channelKind = (body.channelKind ?? "generic") as ChannelKind;
  if (!CHANNEL_KINDS.includes(channelKind)) {
    return Response.json({ error: `'channelKind' must be one of: ${CHANNEL_KINDS.join(", ")}` }, { status: 400 });
  }

  if (channelKind === "email") {
    // No outbound fetch happens for this kind (see webhookDispatch.server.ts's deliverEmail) --
    // 'url' holds a destination email address instead, so the SSRF check below doesn't apply.
    if (!body.url || !EMAIL_PATTERN.test(body.url)) {
      return Response.json({ error: "A valid email address is required in 'url' for channelKind 'email'." }, { status: 400 });
    }
  } else {
    if (!body.url || !URL.canParse(body.url)) {
      return Response.json({ error: "A valid 'url' is required." }, { status: 400 });
    }
    // SSRF guard (erp-connector-fixes-spec.md F3): this URL is fetched server-side on every
    // matching sync event (see webhookDispatch.server.ts) -- reject anything that isn't a public
    // https:// host rather than accepting any syntactically valid URL. Applies to 'slack' too --
    // it's still an outbound POST to a merchant/agency-supplied URL, same risk as 'generic'.
    const urlCheck = await validateExternalUrl(body.url);
    if (!urlCheck.valid) {
      return Response.json({ error: `'url' is invalid: ${urlCheck.reason}` }, { status: 400 });
    }
  }

  const eventTypes = (body.eventTypes ?? []) as WebhookEventType[];
  const invalid = eventTypes.filter((e) => !EVENT_TYPES.includes(e));
  if (eventTypes.length === 0 || invalid.length > 0) {
    return Response.json(
      { error: `'eventTypes' must be a non-empty array from: ${EVENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const { id, secret } = await createWebhookSubscription(connection.id, body.url, eventTypes, channelKind);
  // secret is only ever returned here, at creation time -- store it now, it can't be retrieved
  // again (see webhookSubscriptions.server.ts). Unused by 'slack'/'email' deliveries but still
  // returned uniformly for a consistent response shape across channel kinds.
  return Response.json({ id, secret }, { status: 201 });
};
