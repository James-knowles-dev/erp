import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireAgencyUser } from "../utils/agencyAuth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // requireAgencyUser itself throws a redirect to /agency/login when there's no session -- this
  // route only needs to handle the "already logged in" case.
  await requireAgencyUser(request);
  throw redirect("/agency/dashboard");
};

export default function AgencyIndex() {
  return null;
}
