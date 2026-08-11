// The one place that knows which ERPs exist. Everything else -- the wizard routes, the sync
// worker, reconciliation -- goes through this rather than importing a specific adapter module
// directly, which is what makes adding a new ERP prove the pattern actually holds: if it meant
// touching every wizard route's internals instead of adding one entry to ADAPTERS below, the
// "adding an ERP later means writing a new adapter against an already-proven model, not
// rebuilding the product" claim in the dev spec's Core architecture section would be false.
//
// Table-driven rather than per-ERP if/else chains (which is how this started with two ERPs) --
// with three adapters, ternary chains were already getting hard to read, and a fourth would have
// made it worse. Adding an ERP now means one entry in ADAPTERS, not touching every exported
// function's branching logic.

import type { ERPAdapter, ERPCredentials, FieldMappingTemplate, ValidationIssue, FieldMapping } from "./types";
import { NetSuiteAdapter } from "./netsuite/adapter.server";
import * as netsuiteMapping from "./netsuite/mapping";
import * as netsuiteAuth from "./netsuite/auth.server";
import { AcumaticaAdapter } from "./acumatica/adapter.server";
import * as acumaticaMapping from "./acumatica/mapping";
import * as acumaticaAuth from "./acumatica/auth.server";
import { BusinessCentralAdapter } from "./businesscentral/adapter.server";
import * as businessCentralMapping from "./businesscentral/mapping";
import * as businessCentralAuth from "./businesscentral/auth.server";
import { SageIntacctAdapter } from "./sageintacct/adapter.server";
import * as sageIntacctMapping from "./sageintacct/mapping";
import * as sageIntacctAuth from "./sageintacct/auth.server";
import { Sage300Adapter } from "./sage300/adapter.server";
import * as sage300Mapping from "./sage300/mapping";
import * as sage300Auth from "./sage300/auth.server";
import { BrightpearlAdapter } from "./brightpearl/adapter.server";
import * as brightpearlMapping from "./brightpearl/mapping";
import * as brightpearlAuth from "./brightpearl/auth.server";

export const SUPPORTED_ERPS = [
  { id: "netsuite", name: "NetSuite", available: true },
  { id: "acumatica", name: "Acumatica", available: true },
  { id: "business_central", name: "Business Central", available: true },
  { id: "sage_intacct", name: "Sage Intacct", available: true },
  { id: "sage_300", name: "Sage 300", available: true },
  { id: "brightpearl", name: "Brightpearl", available: true },
] as const;

export type AvailableErpType =
  | "netsuite"
  | "acumatica"
  | "business_central"
  | "sage_intacct"
  | "sage_300"
  | "brightpearl";

export interface ConnectFormField {
  name: string;
  label: string;
  helpText: string;
  // "url" fields are validated server-side against SSRF (see urlSafety.server.ts) before being
  // persisted -- both fields marked this way are a merchant-supplied base URL the server later
  // sends requests to with an auth header attached (erp-connector-fixes-spec.md F3).
  type?: "password" | "url";
}

interface ErpAdapterEntry {
  createAdapter: () => ERPAdapter;
  getDefaultFieldMappings: () => FieldMappingTemplate;
  validateMapping: (mapping: FieldMapping[]) => ValidationIssue[];
  connectFormFields: ConnectFormField[];
  connectIntro: { name: string; instructions: string };
  // Not every ERP authenticates via OAuth2 (see Sage Intacct's session-based XML gateway and
  // Sage 300's Basic Auth) -- the callback route reads this per-ERP instead of assuming oauth2,
  // so each adapter's own authenticate() gets credentials shaped the way it actually expects.
  authType: ERPCredentials["authType"];
  buildAuthorizationUrl: (values: Record<string, string>, redirectUri: string, state: string) => string;
  // Widened from a fixed {accessToken,refreshToken,expiresAt} shape to a generic string record --
  // Brightpearl's token response also carries a regional apiDomain that has to survive into the
  // stored credentials, and Sage Intacct/Sage 300 don't have real OAuth tokens at all (see their
  // auth.server.ts files). Every adapter's authenticate() reads whatever subset of keys it needs
  // back out of credentials.values, so widening this doesn't change behavior for NetSuite/
  // Acumatica/Business Central, which still only ever return the original three keys.
  exchangeCodeForTokens: (
    config: Record<string, string>,
    code: string,
    redirectUri: string,
  ) => Promise<Record<string, string>>;
}

const ADAPTERS: Record<AvailableErpType, ErpAdapterEntry> = {
  netsuite: {
    createAdapter: () => new NetSuiteAdapter(),
    getDefaultFieldMappings: netsuiteMapping.getDefaultFieldMappings,
    validateMapping: netsuiteMapping.validateMapping,
    connectFormFields: [
      {
        name: "accountId",
        label: "NetSuite Account ID",
        helpText:
          'Found in NetSuite under Setup > Company > Company Information. Sandbox account IDs end in "_SB1".',
      },
      { name: "clientId", label: "Client ID", helpText: "From your NetSuite Integration record." },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once when the Integration record is created in NetSuite -- if you've lost it, reset it there first.",
        type: "password",
      },
    ],
    connectIntro: {
      name: "NetSuite",
      instructions:
        "You'll need an Integration record in your NetSuite account with OAuth 2.0 Authorization Code Grant " +
        "and REST Web Services enabled. In NetSuite, go to Setup > Integration > Manage Integrations > New, " +
        "and set the redirect URI to the one shown below.",
    },
    authType: "oauth2",
    buildAuthorizationUrl: (values, redirectUri, state) =>
      netsuiteAuth.buildAuthorizationUrl(
        { accountId: values.accountId, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: async (config, code, redirectUri) => ({
      ...(await netsuiteAuth.exchangeCodeForTokens(
        { accountId: config.accountId, clientId: config.clientId, clientSecret: config.clientSecret },
        code,
        redirectUri,
      )),
    }),
  },
  acumatica: {
    createAdapter: () => new AcumaticaAdapter(),
    getDefaultFieldMappings: acumaticaMapping.getDefaultFieldMappings,
    validateMapping: acumaticaMapping.validateMapping,
    connectFormFields: [
      {
        name: "instanceUrl",
        label: "Acumatica Instance URL",
        helpText: 'e.g. "https://mycompany.acumatica.com" -- no trailing slash.',
        type: "url",
      },
      {
        name: "clientId",
        label: "Client ID",
        helpText: "From your Acumatica instance's Connected Applications screen (SM303010).",
      },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once when the Connected Application is created -- if you've lost it, reset it there first.",
        type: "password",
      },
    ],
    connectIntro: {
      name: "Acumatica",
      instructions:
        "You'll need a Connected Application in your Acumatica instance (Setup > Integration > Connected " +
        "Applications, screen SM303010) with the authorization code grant enabled, and the \"api\" and " +
        '"offline_access" scopes. Set the redirect URI to the one shown below.',
    },
    authType: "oauth2",
    buildAuthorizationUrl: (values, redirectUri, state) =>
      acumaticaAuth.buildAuthorizationUrl(
        { instanceUrl: values.instanceUrl, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: async (config, code, redirectUri) => ({
      ...(await acumaticaAuth.exchangeCodeForTokens(
        { instanceUrl: config.instanceUrl, clientId: config.clientId, clientSecret: config.clientSecret },
        code,
        redirectUri,
      )),
    }),
  },
  business_central: {
    createAdapter: () => new BusinessCentralAdapter(),
    getDefaultFieldMappings: businessCentralMapping.getDefaultFieldMappings,
    validateMapping: businessCentralMapping.validateMapping,
    connectFormFields: [
      {
        name: "tenantId",
        label: "Azure AD Tenant ID",
        helpText: 'From Azure Active Directory > Overview, or your tenant domain (e.g. "contoso.onmicrosoft.com").',
      },
      {
        name: "environment",
        label: "Environment name",
        helpText: 'e.g. "Production" or "Sandbox" -- shown in the Business Central admin center.',
      },
      {
        name: "companyId",
        label: "Company ID",
        helpText: "The GUID for the company within that environment -- found via the companies API or admin center.",
      },
      { name: "clientId", label: "Client ID", helpText: "From your Azure AD App Registration." },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once when the App Registration's secret is created -- if you've lost it, reset it there first.",
        type: "password",
      },
    ],
    connectIntro: {
      name: "Business Central",
      instructions:
        "You'll need an App Registration in your Azure Active Directory with the " +
        "https://api.businesscentral.dynamics.com/.default API permission and admin consent granted. " +
        "Set the redirect URI to the one shown below.",
    },
    authType: "oauth2",
    buildAuthorizationUrl: (values, redirectUri, state) =>
      businessCentralAuth.buildAuthorizationUrl(
        { tenantId: values.tenantId, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: async (config, code, redirectUri) => ({
      ...(await businessCentralAuth.exchangeCodeForTokens(
        {
          tenantId: config.tenantId,
          environment: config.environment,
          companyId: config.companyId,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
        },
        code,
        redirectUri,
      )),
    }),
  },
  sage_intacct: {
    createAdapter: () => new SageIntacctAdapter(),
    getDefaultFieldMappings: sageIntacctMapping.getDefaultFieldMappings,
    validateMapping: sageIntacctMapping.validateMapping,
    connectFormFields: [
      {
        name: "companyId",
        label: "Company ID",
        helpText: "Your Sage Intacct Company ID (Company > Subscriptions, or top-right of the Intacct UI).",
      },
      {
        name: "userId",
        label: "User ID",
        helpText:
          "A dedicated integration user is recommended over a personal login. That user must have Web " +
          'Services authorization enabled (Company > Web Services Authorizations) for our Sender ID.',
      },
      {
        name: "userPassword",
        label: "User Password",
        helpText: "The password for the User ID above.",
        type: "password",
      },
    ],
    connectIntro: {
      name: "Sage Intacct",
      // Genuinely different from every other ERP here: there's no redirect to a Sage login/
      // consent screen -- clicking Connect submits these credentials directly to us, and we
      // establish an API session with them immediately. Said plainly so the copy doesn't imply an
      // OAuth-style screen the merchant will never see.
      instructions:
        "Sage Intacct doesn't use an OAuth redirect -- clicking Connect verifies these credentials directly. " +
        "Your Company ID needs to have authorized our Sender ID for Web Services access first " +
        "(Company > Setup > Web Services Authorizations in Sage Intacct); ask your Intacct administrator if " +
        "you're not sure this has been done.",
    },
    authType: "session",
    buildAuthorizationUrl: (_values, redirectUri, state) =>
      sageIntacctAuth.buildAuthorizationUrl(undefined, redirectUri, state),
    exchangeCodeForTokens: (config, code, redirectUri) =>
      sageIntacctAuth.exchangeCodeForTokens(
        { companyId: config.companyId, userId: config.userId, userPassword: config.userPassword },
        code,
        redirectUri,
      ),
  },
  sage_300: {
    createAdapter: () => new Sage300Adapter(),
    getDefaultFieldMappings: sage300Mapping.getDefaultFieldMappings,
    validateMapping: sage300Mapping.validateMapping,
    connectFormFields: [
      {
        name: "serverUrl",
        label: "Sage 300 Web API URL",
        helpText:
          'e.g. "https://erp.mycompany.com/Sage300WebApi" -- Sage 300 is typically self-hosted, so this ' +
          "needs to already be reachable from the internet (via your IT team or a reverse proxy). No trailing slash.",
        type: "url",
      },
      {
        name: "company",
        label: "Company (Org) ID",
        helpText: 'The Sage 300 company database ID, e.g. "SAMLTD".',
      },
      { name: "username", label: "Username", helpText: "A Sage 300 user with Web API access." },
      { name: "password", label: "Password", helpText: "The password for the username above.", type: "password" },
    ],
    connectIntro: {
      name: "Sage 300",
      instructions:
        "Sage 300 doesn't use an OAuth redirect either -- clicking Connect verifies these credentials " +
        "directly against your Web API URL. Sage 300 is typically self-hosted per company, so this endpoint " +
        "needs to already be exposed to the internet before you can connect (ask your IT team or Sage partner " +
        "if you're not sure).",
    },
    authType: "api_key",
    buildAuthorizationUrl: (_values, redirectUri, state) =>
      sage300Auth.buildAuthorizationUrl(undefined, redirectUri, state),
    exchangeCodeForTokens: (config, code, redirectUri) =>
      sage300Auth.exchangeCodeForTokens(
        { serverUrl: config.serverUrl, company: config.company, username: config.username, password: config.password },
        code,
        redirectUri,
      ),
  },
  brightpearl: {
    createAdapter: () => new BrightpearlAdapter(),
    getDefaultFieldMappings: brightpearlMapping.getDefaultFieldMappings,
    validateMapping: brightpearlMapping.validateMapping,
    connectFormFields: [
      {
        name: "accountCode",
        label: "Brightpearl Account Code",
        helpText: 'The short code in your Brightpearl URL, e.g. "mystore" from mystore.brightpearlapp.com.',
      },
    ],
    connectIntro: {
      name: "Brightpearl",
      instructions:
        "Enter your Brightpearl account code below, then you'll be taken to Brightpearl to approve access.",
    },
    authType: "oauth2",
    buildAuthorizationUrl: (values, redirectUri, state) =>
      brightpearlAuth.buildAuthorizationUrl(values.accountCode, redirectUri, state),
    exchangeCodeForTokens: async (config, code, redirectUri) => ({
      ...(await brightpearlAuth.exchangeCodeForTokens(config.accountCode, code, redirectUri)),
    }),
  },
};

function getEntry(erpType: string): ErpAdapterEntry {
  const entry = ADAPTERS[erpType as AvailableErpType];
  if (!entry) throw new Response(`Unsupported or not-yet-built ERP type: ${erpType}`, { status: 400 });
  return entry;
}

export function createAdapter(erpType: string): ERPAdapter {
  return getEntry(erpType).createAdapter();
}

export function getDefaultFieldMappings(erpType: string): FieldMappingTemplate {
  return getEntry(erpType).getDefaultFieldMappings();
}

export function validateMapping(erpType: string, mapping: FieldMapping[]): ValidationIssue[] {
  return getEntry(erpType).validateMapping(mapping);
}

export function getConnectFormFields(erpType: string): ConnectFormField[] {
  return getEntry(erpType).connectFormFields;
}

export function getConnectIntro(erpType: string): { name: string; instructions: string } {
  return getEntry(erpType).connectIntro;
}

export function getAuthType(erpType: string): ERPCredentials["authType"] {
  return getEntry(erpType).authType;
}

export function buildAuthorizationUrl(
  erpType: string,
  values: Record<string, string>,
  redirectUri: string,
  state: string,
): string {
  return getEntry(erpType).buildAuthorizationUrl(values, redirectUri, state);
}

export async function exchangeCodeForTokens(
  erpType: string,
  config: Record<string, string>,
  code: string,
  redirectUri: string,
): Promise<Record<string, string>> {
  return getEntry(erpType).exchangeCodeForTokens(config, code, redirectUri);
}
