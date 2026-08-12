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

export interface ConnectIntro {
  name: string;
  // One line naming who typically has the access this step needs (an Administrator role inside
  // the ERP, a company's Azure/Microsoft 365 admin, IT/hosting for a self-hosted product, or
  // "no admin access needed" when that's genuinely true) -- added so a store owner reading this
  // can tell up front whether they can do this themselves or need to loop someone in, rather than
  // discovering it three steps into a form they can't finish.
  requirement: string;
  // Numbered, click-by-click steps rather than a single paragraph -- written for whoever is
  // actually doing this (which is often the store owner, not an implementation agency), so each
  // step names the exact screen/menu to look for rather than assuming familiarity with the ERP's
  // admin area.
  instructions: string[];
}

interface ErpAdapterEntry {
  createAdapter: () => ERPAdapter;
  getDefaultFieldMappings: () => FieldMappingTemplate;
  validateMapping: (mapping: FieldMapping[]) => ValidationIssue[];
  connectFormFields: ConnectFormField[];
  connectIntro: ConnectIntro;
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
      {
        name: "clientId",
        label: "Client ID",
        helpText: "Shown on the Integration record's page right after you save it in step 5 below.",
      },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once, on that same page, right after saving -- if you've lost it, edit the Integration " +
          "record and reset it (this invalidates the old secret).",
        type: "password",
      },
    ],
    connectIntro: {
      name: "NetSuite",
      requirement:
        "You'll need Administrator access in NetSuite to complete this -- if that's not you, ask whoever " +
        "manages your NetSuite account to do the steps below (it only takes a few minutes).",
      instructions: [
        'Make sure REST Web Services is turned on: Setup > Company > Enable Features > SuiteCloud tab, check ' +
          '"REST Web Services" if it isn\'t already (this is a one-time account setting; skip if already on).',
        "Go to Setup > Integration > Manage Integrations > New.",
        'Give it any name (e.g. "Shopify Connector"). Under Authentication, check "OAuth 2.0 Authorization ' +
          'Code Grant" -- leave Token-Based Authentication unchecked.',
        'Under the OAuth 2.0 section, check the "REST Web Services" scope, and paste the redirect URI shown ' +
          "above into the Redirect URI field.",
        "Save. NetSuite immediately shows a Client ID and Client Secret on the page -- copy both now, the " +
          "secret will not be shown again.",
        'Your Account ID is under Setup > Company > Company Information (a sandbox account\'s ID ends in "_SB1").',
      ],
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
        helpText: 'The address you use to log into Acumatica in a browser, e.g. "https://mycompany.acumatica.com" -- no trailing slash.',
        type: "url",
      },
      {
        name: "clientId",
        label: "Client ID",
        helpText: "Shown on the Connected Application's page right after you save it in step 4 below.",
      },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once, on that same page, right after saving -- if you've lost it, edit the Connected " +
          "Application and reset it (this invalidates the old secret).",
        type: "password",
      },
    ],
    connectIntro: {
      name: "Acumatica",
      requirement:
        "You'll need admin access to your Acumatica instance to complete this -- if that's not you, ask " +
        "whoever manages your Acumatica instance to do the steps below.",
      instructions: [
        "Log into Acumatica, then go to Configuration > Integration > Connected Applications (screen ID " +
          'SM303010) and click "Add New Record" (the + icon).',
        'Give it any name, set the type to OAuth 2.0, and enable the "Authorization Code" grant.',
        'Under Scopes, check "api" and "offline_access".',
        "Paste the redirect URI shown above into the application's Redirect URI field, then save.",
        "Acumatica immediately shows a Client ID and Client Secret on the page -- copy both now, the secret " +
          "will not be shown again.",
      ],
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
        helpText:
          'Look at your browser\'s address bar while inside Business Central: it\'s the value right after ' +
          '"dynamics.com/" -- either a GUID or something like "yourcompany.onmicrosoft.com", either works. ' +
          'Also shown as "Directory (tenant) ID" on your App Registration\'s Overview page in step 3 below.',
      },
      {
        name: "environment",
        label: "Environment name",
        helpText:
          'Also in that same browser address bar, right after the tenant ID -- typically "Production", ' +
          '"Sandbox", or a custom name your admin chose. Note: if the address bar shows a referrer/redirect ' +
          "URL with nothing after the tenant ID, that page hasn't finished loading into a specific " +
          "environment yet -- wait for it to land inside the actual company, or check " +
          '"<tenant-id>/admin" for a list of every environment in your tenant by name.',
      },
      {
        name: "clientId",
        label: "Client ID",
        helpText: 'Labeled "Application (client) ID" on your App Registration\'s Overview page, step 3 below.',
      },
      {
        name: "clientSecret",
        label: "Client Secret",
        helpText:
          "Only shown once, right after you create it in step 4 below -- if you've lost it, add a new client " +
          "secret on the App Registration (the old one still works until it expires or you delete it).",
        type: "password",
      },
    ],
    connectIntro: {
      name: "Business Central",
      requirement:
        "You'll need to be (or get help from) whoever manages your Microsoft 365 subscription -- Global " +
        "Administrator or Application Administrator in Azure Active Directory. If you signed yourself up for " +
        "a Business Central trial, that's you.",
      instructions: [
        'Go to portal.azure.com and sign in with your Business Central admin account, then open "App ' +
          'registrations" (search for it in the top search bar) > New registration.',
        'Name it anything (e.g. "Shopify Connector"), leave the default account-type option, and under ' +
          '"Redirect URI" choose type Web and paste in the redirect URI shown above.',
        'Click Register. On the Overview page that opens, note the "Application (client) ID" and "Directory ' +
          '(tenant) ID" -- you\'ll need both.',
        'Left sidebar > "Certificates & secrets" > New client secret > give it any description/expiry > Add. ' +
          "Copy the Value column immediately -- it will not be shown again once you leave the page.",
        'Left sidebar > "API permissions" > Add a permission > APIs my organization uses > search "Dynamics ' +
          '365 Business Central" > Delegated permissions > check "user_impersonation" > Add, then click ' +
          '"Grant admin consent" on that same page.',
        "You don't need to look up a Company ID yourself -- after you click Connect below and approve " +
          "access, we detect it automatically (or ask you to pick, if this environment has more than one " +
          "company).",
      ],
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
        helpText: 'Shown top-right of the Sage Intacct screen once logged in, or under Company > Subscriptions.',
      },
      {
        name: "userId",
        label: "User ID",
        helpText:
          "A dedicated integration user is recommended over a personal login, so this connection doesn't " +
          "break if that person leaves. Either way, this user needs Web Services access -- see step 2 below.",
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
      requirement:
        "You'll need a Sage Intacct Administrator to complete step 1 below (authorizing our access) -- if " +
        "that's not you, send them this page's link and ask them to do it first, then come back.",
      // Genuinely different from every other ERP here: there's no redirect to a Sage login/
      // consent screen -- clicking Connect submits these credentials directly to us, and we
      // establish an API session with them immediately. Said plainly so the copy doesn't imply an
      // OAuth-style screen the merchant will never see.
      instructions: [
        'An Administrator needs to authorize Web Services access first: in Sage Intacct, go to Company > ' +
          'Setup > Web Services Authorizations, and add an authorization for our Sender ID (shown to you or ' +
          "your admin when you request access -- if you don't have it yet, that's the one thing to ask us for).",
        "Create (or reuse) a user for this connection -- Company > Company Setup > Users -- and make sure " +
          '"Web Services User" is checked on that user\'s record, since a user without it can\'t authenticate ' +
          "here even with the right password.",
        "There's no separate login screen after this: entering the right Company ID, User ID, and password " +
          'below and clicking Connect verifies them immediately against Sage Intacct.',
      ],
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
          'e.g. "https://erp.mycompany.com/Sage300WebApi" -- your IT team or Sage partner sets this up ' +
          "(see step 2 below); no trailing slash.",
        type: "url",
      },
      {
        name: "company",
        label: "Company (Org) ID",
        helpText: 'The short Sage 300 company database code, e.g. "SAMLTD" -- ask whoever manages Sage 300 if unsure.',
      },
      {
        name: "username",
        label: "Username",
        helpText: "A Sage 300 user with Web API access (see step 3 below) -- not necessarily your own login.",
      },
      { name: "password", label: "Password", helpText: "The password for the username above.", type: "password" },
    ],
    connectIntro: {
      name: "Sage 300",
      requirement:
        "This one usually isn't something a store owner can finish alone: Sage 300 normally runs on your " +
        "own server, so steps 1-2 below typically need your IT team, hosting provider, or Sage partner. Once " +
        "they've done those, entering the details below is easy.",
      instructions: [
        "Confirm Sage 300 Web Screens (the Web API) is installed and turned on -- this is a checkbox chosen " +
          "when Sage 300 was set up; ask whoever manages your Sage 300 install to confirm or enable it.",
        "That Web API needs to be reachable from the public internet, not just your office network -- your " +
          "IT team or hosting provider will need to expose it (e.g. via a reverse proxy) and give you the " +
          "public URL to enter below.",
        "Ask your Sage 300 administrator for a username/password with Web API access -- this can be a " +
          "dedicated account for this connection rather than a personal login.",
        "There's no separate login screen after this: entering the URL, Company ID, username, and password " +
          "below and clicking Connect verifies them immediately.",
      ],
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
        helpText: 'The short code in your Brightpearl web address, e.g. "mystore" from mystore.brightpearlapp.com.',
      },
    ],
    connectIntro: {
      name: "Brightpearl",
      requirement: "This one's simple -- no admin or IT help needed beyond your own normal Brightpearl login.",
      instructions: [
        "Find your account code in your Brightpearl web address bar -- it's the part before " +
          '".brightpearlapp.com", e.g. "mystore" from mystore.brightpearlapp.com.',
        "Enter it below and click Connect.",
        "You'll be taken to Brightpearl to log in (if not already) and approve access for this app -- any " +
          "normal Brightpearl user can do this step.",
      ],
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

export function getConnectIntro(erpType: string): ConnectIntro {
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
