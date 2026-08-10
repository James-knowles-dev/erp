import type { ActionFunctionArgs } from "@remix-run/node";
import { requireApiKeyConnection } from "../utils/apiKey.server";
import { deleteWebhookSubscription } from "../sync/webhookSubscriptions.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "DELETE") throw new Response("Method not allowed", { status: 405 });

  const connection = await requireApiKeyConnection(request);
  const deleted = await deleteWebhookSubscription(connection.id, params.id!);
  if (!deleted) throw new Response("Not found", { status: 404 });

  return new Response(null, { status: 204 });
};
