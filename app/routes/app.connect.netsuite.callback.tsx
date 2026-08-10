import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  loadNetSuiteCredentials,
  setConnectionStatus,
  storeNetSuiteCredentials,
} from "../models/connections.server";
import { exchangeCodeForTokens } from "../adapters/netsuite/auth.server";
import { NetSuiteAdapter } from "../adapters/netsuite/adapter.server";

// NetSuite redirects the merchant's browser back here after they log in and consent (or deny).
// TODO(D4): this is a full top-level round-trip out of the Shopify embedded iframe and back --
// whether authenticate.admin() re-establishes the embedded session cleanly on return needs
// verification against a live NetSuite account, not just NetSuite's documented OAuth flow.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (!connectionId) {
    throw new Response("Missing state parameter", { status: 400 });
  }

  const backToStep2 = (message: string) =>
    redirect(`/app/connect/netsuite?connectionId=${connectionId}&error=${encodeURIComponent(message)}`);

  if (oauthError) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(`NetSuite declined the connection: ${oauthError}`);
  }
  if (!code) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2("NetSuite did not return an authorization code.");
  }

  const partialConfig = await loadNetSuiteCredentials(connectionId);
  if (!partialConfig?.accountId || !partialConfig?.clientId || !partialConfig?.clientSecret) {
    return backToStep2("Connection details were lost -- please re-enter them.");
  }

  const redirectUri = `${url.origin}/app/connect/netsuite/callback`;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(partialConfig, code, redirectUri);
  } catch (err) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(err instanceof Error ? err.message : "Token exchange failed.");
  }

  await storeNetSuiteCredentials(connectionId, { ...partialConfig, ...tokens });

  const adapter = new NetSuiteAdapter();
  await adapter.authenticate({
    authType: "oauth2",
    values: { ...partialConfig, ...tokens },
  });
  const test = await adapter.testConnection();
  if (!test.success) {
    await setConnectionStatus(connectionId, "error");
    return backToStep2(test.message ?? "Connected, but the test request to NetSuite failed.");
  }

  return redirect(`/app/connect/netsuite/environment?connectionId=${connectionId}`);
};
