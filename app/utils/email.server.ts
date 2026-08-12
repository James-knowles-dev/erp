import nodemailer from "nodemailer";

// SMTP-based alert delivery -- used by webhookDispatch.server.ts's 'email' channel kind. Kept as
// a thin wrapper around nodemailer (rather than a specific provider's SDK) so any SMTP-speaking
// provider (Postmark, SES, Sendgrid, a plain mailbox) works via the same four env vars.

let transporter: nodemailer.Transporter | undefined;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new Error(
      "SMTP_HOST is not set -- email alerts aren't configured. Set SMTP_HOST/SMTP_PORT/" +
        "SMTP_USER/SMTP_PASS/SMTP_FROM to enable them.",
    );
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendAlertEmail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.SMTP_FROM ?? "alerts@erp-connector.local";
  await getTransporter().sendMail({ from, to, subject, text });
}
