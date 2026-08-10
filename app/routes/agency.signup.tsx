import { useState } from "react";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { createAgencyAccount, createAgencySession } from "../utils/agencyAuth.server";

// No self-serve signup flow is described in either spec (the dev spec's API list assumes an
// agency account already exists) -- this fills that gap with the simplest reasonable answer: an
// open signup form, same as most B2B SaaS onboarding. Not gated behind an invite or approval step,
// which a real launch might want, but nothing in either spec asks for that.
export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const agencyName = String(formData.get("agencyName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!agencyName || !email || !password || password.length < 8) {
    return { error: "Agency name, email, and an 8+ character password are all required." };
  }

  try {
    const user = await createAgencyAccount(agencyName, email, password);
    return createAgencySession(user.id, "/agency/dashboard");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create account." };
  }
};

export default function AgencySignup() {
  const actionData = useActionData<typeof action>();
  const [agencyName, setAgencyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Create your agency account</h1>
      {actionData?.error && <p style={{ color: "crimson" }}>{actionData.error}</p>}
      <Form method="post">
        <div style={{ marginBottom: "1rem" }}>
          <label>
            Agency name
            <br />
            <input
              name="agencyName"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label>
            Email
            <br />
            <input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label>
            Password (8+ characters)
            <br />
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <button type="submit">Create account</button>
      </Form>
      <p>
        Already have an account? <a href="/agency/login">Log in</a>
      </p>
    </div>
  );
}
