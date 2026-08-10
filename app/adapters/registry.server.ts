// The one place that knows which ERPs exist. Everything else -- the wizard routes, the sync
// worker, reconciliation -- goes through this rather than importing a specific adapter module
// directly, which is what makes adding Acumatica (Milestone 5) prove the pattern actually holds:
// if adding a second ERP meant touching every wizard route's internals instead of adding one
// case here, the "adding an ERP later means writing a new adapter against an already-proven
// model, not rebuilding the product" claim in the dev spec's Core architecture section would be
// false.

import type { ERPAdapter, FieldMappingTemplate, ValidationIssue, FieldMapping } from "./types";
import { NetSuiteAdapter } from "./netsuite/adapter.server";
import * as netsuiteMapping from "./netsuite/mapping";
import * as netsuiteAuth from "./netsuite/auth.server";
import type { NetSuiteConfig, NetSuiteTokens } from "./netsuite/types";
import { AcumaticaAdapter } from "./acumatica/adapter.server";
import * as acumaticaMapping from "./acumatica/mapping";
import * as acumaticaAuth from "./acumatica/auth.server";
import type { AcumaticaConfig, AcumaticaTokens } from "./acumatica/types";

export const SUPPORTED_ERPS = [
  { id: "netsuite", name: "NetSuite", available: true },
  { id: "acumatica", name: "Acumatica", available: true },
  { id: "business_central", name: "Business Central", available: false },
  { id: "sage_intacct", name: "Sage Intacct", available: false },
  { id: "sage_300", name: "Sage 300", available: false },
  { id: "brightpearl", name: "Brightpearl", available: false },
] as const;

export type AvailableErpType = "netsuite" | "acumatica";

function assertAvailable(erpType: string): asserts erpType is AvailableErpType {
  if (erpType !== "netsuite" && erpType !== "acumatica") {
    throw new Response(`Unsupported or not-yet-built ERP type: ${erpType}`, { status: 400 });
  }
}

export function createAdapter(erpType: string): ERPAdapter {
  assertAvailable(erpType);
  return erpType === "netsuite" ? new NetSuiteAdapter() : new AcumaticaAdapter();
}

export function getDefaultFieldMappings(erpType: string): FieldMappingTemplate {
  assertAvailable(erpType);
  return erpType === "netsuite"
    ? netsuiteMapping.getDefaultFieldMappings()
    : acumaticaMapping.getDefaultFieldMappings();
}

export function validateMapping(erpType: string, mapping: FieldMapping[]): ValidationIssue[] {
  assertAvailable(erpType);
  return erpType === "netsuite"
    ? netsuiteMapping.validateMapping(mapping)
    : acumaticaMapping.validateMapping(mapping);
}

// The one place the two ERPs genuinely can't share a shape: NetSuite's connect step needs an
// Account ID, Acumatica's needs an Instance URL -- everything else about the field is the same
// (a labeled text input, required, with merchant-facing help text).
export interface ConnectFormField {
  name: string;
  label: string;
  helpText: string;
  type?: "password";
}

const CONNECT_FORM_FIELDS: Record<AvailableErpType, ConnectFormField[]> = {
  netsuite: [
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
  acumatica: [
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
};

const CONNECT_INTRO: Record<AvailableErpType, { name: string; instructions: string }> = {
  netsuite: {
    name: "NetSuite",
    instructions:
      "You'll need an Integration record in your NetSuite account with OAuth 2.0 Authorization Code Grant " +
      "and REST Web Services enabled. In NetSuite, go to Setup > Integration > Manage Integrations > New, " +
      "and set the redirect URI to the one shown below.",
  },
  acumatica: {
    name: "Acumatica",
    instructions:
      "You'll need a Connected Application in your Acumatica instance (Setup > Integration > Connected " +
      "Applications, screen SM303010) with the authorization code grant enabled, and the \"api\" and " +
      '"offline_access" scopes. Set the redirect URI to the one shown below.',
  },
};

export function getConnectFormFields(erpType: string): ConnectFormField[] {
  assertAvailable(erpType);
  return CONNECT_FORM_FIELDS[erpType];
}

export function getConnectIntro(erpType: string): { name: string; instructions: string } {
  assertAvailable(erpType);
  return CONNECT_INTRO[erpType];
}

export function buildAuthorizationUrl(
  erpType: string,
  values: Record<string, string>,
  redirectUri: string,
  state: string,
): string {
  assertAvailable(erpType);
  return erpType === "netsuite"
    ? netsuiteAuth.buildAuthorizationUrl(
        { accountId: values.accountId, clientId: values.clientId },
        redirectUri,
        state,
      )
    : acumaticaAuth.buildAuthorizationUrl(
        { instanceUrl: values.instanceUrl, clientId: values.clientId },
        redirectUri,
        state,
      );
}

export async function exchangeCodeForTokens(
  erpType: string,
  config: Record<string, string>,
  code: string,
  redirectUri: string,
): Promise<NetSuiteTokens | AcumaticaTokens> {
  assertAvailable(erpType);
  return erpType === "netsuite"
    ? netsuiteAuth.exchangeCodeForTokens(config as unknown as NetSuiteConfig, code, redirectUri)
    : acumaticaAuth.exchangeCodeForTokens(config as unknown as AcumaticaConfig, code, redirectUri);
}
