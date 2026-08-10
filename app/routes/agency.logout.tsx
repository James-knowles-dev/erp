import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { destroyAgencySession } from "../utils/agencyAuth.server";

export const action = async ({ request }: ActionFunctionArgs) => destroyAgencySession(request);

// GET here is a convenience for a plain link -- there's no state-changing risk in visiting a
// logout URL (it only ever destroys the caller's own session).
export const loader = async ({ request }: LoaderFunctionArgs) => destroyAgencySession(request);

export default function AgencyLogout() {
  return null;
}
