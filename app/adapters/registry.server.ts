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

import type { ERPAdapter, FieldMappingTemplate, ValidationIssue, FieldMapping } from "./types";
import { NetSuiteAdapter } from "./netsuite/adapter.server";
import * as netsuiteMapping from "./netsuite/mapping";
import * as netsuiteAuth from "./netsuite/auth.server";
import { AcumaticaAdapter } from "./acumatica/adapter.server";
import * as acumaticaMapping from "./acumatica/mapping";
import * as acumaticaAuth from "./acumatica/auth.server";
import { BusinessCentralAdapter } from "./businesscentral/adapter.server";
import * as businessCentralMapping from "./businesscentral/mapping";
import * as businessCentralAuth from "./businesscentral/auth.server";

export const SUPPORTED_ERPS = [
  { id: "netsuite", name: "NetSuite", available: true },
  { id: "acumatica", name: "Acumatica", available: true },
  { id: "business_central", name: "Business Central", available: true },
  { id: "sage_intacct", name: "Sage Intacct", available: false },
  { id: "sage_300", name: "Sage 300", available: false },
  { id: "brightpearl", name: "Brightpearl", available: false },
] as const;

export type AvailableErpType = "netsuite" | "acumatica" | "business_central";

export interface ConnectFormField {
  name: string;
  label: string;
  helpText: string;
  type?: "password";
}

interface ErpAdapterEntry {
  createAdapter: () => ERPAdapter;
  getDefaultFieldMappings: () => FieldMappingTemplate;
  validateMapping: (mapping: FieldMapping[]) => ValidationIssue[];
  connectFormFields: ConnectFormField[];
  connectIntro: { name: string; instructions: string };
  buildAuthorizationUrl: (values: Record<string, string>, redirectUri: string, state: string) => string;
  exchangeCodeForTokens: (
    config: Record<string, string>,
    code: string,
    redirectUri: string,
  ) => Promise<{ accessToken: string; refreshToken: string; expiresAt: string }>;
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
    buildAuthorizationUrl: (values, redirectUri, state) =>
      netsuiteAuth.buildAuthorizationUrl(
        { accountId: values.accountId, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: (config, code, redirectUri) =>
      netsuiteAuth.exchangeCodeForTokens(
        { accountId: config.accountId, clientId: config.clientId, clientSecret: config.clientSecret },
        code,
        redirectUri,
      ),
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
    buildAuthorizationUrl: (values, redirectUri, state) =>
      acumaticaAuth.buildAuthorizationUrl(
        { instanceUrl: values.instanceUrl, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: (config, code, redirectUri) =>
      acumaticaAuth.exchangeCodeForTokens(
        { instanceUrl: config.instanceUrl, clientId: config.clientId, clientSecret: config.clientSecret },
        code,
        redirectUri,
      ),
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
    buildAuthorizationUrl: (values, redirectUri, state) =>
      businessCentralAuth.buildAuthorizationUrl(
        { tenantId: values.tenantId, clientId: values.clientId },
        redirectUri,
        state,
      ),
    exchangeCodeForTokens: (config, code, redirectUri) =>
      businessCentralAuth.exchangeCodeForTokens(
        {
          tenantId: config.tenantId,
          environment: config.environment,
          companyId: config.companyId,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
        },
        code,
        redirectUri,
      ),
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
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  return getEntry(erpType).exchangeCodeForTokens(config, code, redirectUri);
}
