import nodemailer, { type Transporter } from "nodemailer";
import type { OtpPurpose } from "@moltol/contracts";
import type { Env } from "./env";
import { renderPasswordResetEmail, renderSignupOtpEmail, type RenderedEmail } from "./emails/templates";

function renderOtpEmail(purpose: OtpPurpose, code: string): RenderedEmail {
  return purpose === "reset" ? renderPasswordResetEmail(code) : renderSignupOtpEmail(code);
}

let cachedTransporter: Transporter | null = null;
function getTransporter(env: Env): Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false, // STARTTLS on 587
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return cachedTransporter;
}

/**
 * Sends the OTP via SMTP (Brevo relay by default). Without credentials
 * (local dev), logs the code instead of sending — same graceful-degrade
 * pattern as Channel3/LLM/PayPal below.
 */
export async function sendOtpEmail(env: Env, to: string, code: string, purpose: OtpPurpose): Promise<void> {
  const { subject, html, text } = renderOtpEmail(purpose, code);
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
    console.log(`[otp:${purpose}] SMTP not configured — code for ${to} is ${code}`);
    return;
  }
  await getTransporter(env).sendMail({ from: env.EMAIL_FROM, to, subject, html, text });
}
