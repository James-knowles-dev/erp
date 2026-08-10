import { useState } from "react";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";
import { verifyAgencyLogin, createAgencySession } from "../utils/agencyAuth.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = await verifyAgencyLogin(email, password);
  if (!user) return { error: "Incorrect email or password." };

  return createAgencySession(user.id, "/agency/dashboard");
};

export default function AgencyLogin() {
  const actionData = useActionData<typeof action>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={{ maxWidth: 400, margin: "4rem auto", fontFamily: "system-ui" }}>
      <h1>Agency login</h1>
      {actionData?.error && <p style={{ color: "crimson" }}>{actionData.error}</p>}
      <Form method="post">
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
            Password
            <br />
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
        </div>
        <button type="submit">Log in</button>
      </Form>
      <p>
        Need an account? <a href="/agency/signup">Sign up</a>
      </p>
    </div>
  );
}
