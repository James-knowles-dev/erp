import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { loadErpCredentials, setConnectionStatus, storeErpCredentials } from "../models/connections.server";
import { createAdapter, exchangeCodeForTokens, getAuthType, getConnectFormFields } from "../adapters/registry.server";

// The ERP redirects the merchant's browser back here after they log in and consent (or deny).
// TODO(D4): this is a full top-level round-trip out of the Shopify embedded iframe and back --
// whether authenticate.admin() re-establishes the embedded session cleanly on return needs
// verification against a live account, not just each ERP's documented OAuth flow.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const erpType = params.erpType!;

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (!connectionId) {
    throw new Response("Missing state parameter", { status: 400 });
  }

  const backToStep2 = (message: string) =>
    redirect(`/app/connect/${erpType}?connectionId=${connectionId}&error=${encodeURIComponent(message)}`);

  if (oauthError) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(`Connection declined: ${oauthError}`);
  }
  if (!code) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2("No authorization code was returned.");
  }

  const partialConfig = await loadErpCredentials(connectionId);
  const requiredFields = getConnectFormFields(erpType).map((f) => f.name);
  if (!partialConfig || requiredFields.some((name) => !partialConfig[name])) {
    return backToStep2("Connection details were lost -- please re-enter them.");
  }

  const redirectUri = `${url.origin}/app/connect/${erpType}/callback`;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(erpType, partialConfig, code, redirectUri);
  } catch (err) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(err instanceof Error ? err.message : "Token exchange failed.");
  }

  const fullCredentials = { ...partialConfig, ...tokens };
  await storeErpCredentials(connectionId, fullCredentials);

  const adapter = createAdapter(erpType);
  await adapter.authenticate({ authType: getAuthType(erpType), values: fullCredentials });
  const test = await adapter.testConnection();
  if (!test.success) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(test.message ?? "Connected, but the test request failed.");
  }

  return redirect(`/app/connect/${erpType}/environment?connectionId=${connectionId}`);
};
