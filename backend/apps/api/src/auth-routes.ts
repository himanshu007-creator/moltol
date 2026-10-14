import type { FastifyInstance, FastifyReply } from "fastify";
import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  ResendOtpRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  VerifyOtpRequestSchema,
  normalizeEmail,
  problem,
  type OtpPurpose,
} from "@moltol/contracts";
import type { Container } from "./container";
import { hashPassword, verifyPassword } from "./password";
import { generateOtp, hashOtp, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, secondsUntil } from "./otp";
import { sendOtpEmail } from "./email";

function sendProblem(reply: FastifyReply, status: number, title: string, detail?: string): void {
  reply.code(status).type("application/problem+json").send(problem(status, title, detail));
}

async function issueOtp(container: Container, userId: string, email: string, purpose: OtpPurpose): Promise<void> {
  const code = generateOtp();
  await container.store.putOtp(userId, purpose, hashOtp(code, userId), new Date(Date.now() + OTP_TTL_MS));
  await sendOtpEmail(container.env, email, code, purpose);
}

/** Resolves the caller's own active-code cooldown, or null if none/elapsed. */
async function activeCooldown(container: Container, userId: string): Promise<number | null> {
  const otp = await container.store.getOtp(userId);
  if (!otp) return null;
  const remaining = secondsUntil(new Date(otp.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS));
  return remaining > 0 ? remaining : null;
}

export async function registerAuthRoutes(app: FastifyInstance, container: Container): Promise<void> {
  const { store } = container;

  app.post("/v1/auth/signup", async (req, reply) => {
    const parsed = SignupRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");
    const { normalized: email } = normalized;

    const existing = await store.getUserByEmail(email);
    const passwordHash = await hashPassword(parsed.data.password);

    let userId: string;
    if (existing) {
      if (existing.emailVerifiedAt) {
        return sendProblem(reply, 409, "account_exists", "An account already exists for this email. Log in instead.");
      }
      const cooldown = await activeCooldown(container, existing.id);
      if (cooldown !== null) {
        return reply.code(429).send({ type: "about:blank", title: "resend_cooldown", status: 429, secondsRemaining: cooldown });
      }
      await store.setUserPassword(existing.id, passwordHash);
      userId = existing.id;
    } else {
      const created = await store.createUser({ email, passwordHash });
      userId = created.id;
    }

    await issueOtp(container, userId, email, "signup");
    return reply.code(existing ? 200 : 201).send({
      normalizedEmail: email,
      message: `We sent a 6-digit code to ${email}.`,
      resendCooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
    });
  });

  app.post("/v1/auth/otp/verify", async (req, reply) => {
    const parsed = VerifyOtpRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user) return sendProblem(reply, 404, "not_found");

    const otp = await store.getOtp(user.id);
    if (!otp || otp.purpose !== "signup" || otp.consumedAt) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    if (otp.expiresAt.getTime() < Date.now()) return sendProblem(reply, 400, "code_expired", "Request a new code.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return sendProblem(reply, 400, "too_many_attempts", "Request a new code.");
    }

    if (otp.codeHash !== hashOtp(parsed.data.code, user.id)) {
      await store.incrementOtpAttempts(otp.id);
      return sendProblem(reply, 400, "wrong_code", `${OTP_MAX_ATTEMPTS - otp.attempts - 1} attempts left.`);
    }

    await store.consumeOtp(otp.id);
    await store.markEmailVerified(user.id);
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    const shop = await store.getShopByUserId(user.id);
    return reply.send({ token, user: { id: user.id, email: user.email, hasShop: Boolean(shop) } });
  });

  app.post("/v1/auth/otp/resend", async (req, reply) => {
    const parsed = ResendOtpRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user || user.emailVerifiedAt) return sendProblem(reply, 404, "not_found");

    const cooldown = await activeCooldown(container, user.id);
    if (cooldown !== null) {
      return reply.code(429).send({ type: "about:blank", title: "resend_cooldown", status: 429, secondsRemaining: cooldown });
    }

    await issueOtp(container, user.id, user.email, "signup");
    return reply.send({ ok: true, resendCooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000) });
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 401, "invalid_credentials");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return sendProblem(reply, 401, "invalid_credentials");
    }
    if (!user.emailVerifiedAt) {
      return sendProblem(reply, 403, "not_verified", "Verify your email first.");
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email });
    const shop = await store.getShopByUserId(user.id);
    return reply.send({ token, user: { id: user.id, email: user.email, hasShop: Boolean(shop) } });
  });

  /* ------------------------------ password reset ---------------------------- */

  app.post("/v1/auth/password/forgot", async (req, reply) => {
    const parsed = ForgotPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    // Never reveal whether an account exists for this address.
    const ok = { ok: true, message: "If an account exists for that email, we sent a reset code." };
    if (!normalized) return reply.send(ok);

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user || !user.emailVerifiedAt) return reply.send(ok);

    const cooldown = await activeCooldown(container, user.id);
    if (cooldown !== null) return reply.send(ok);

    await issueOtp(container, user.id, user.email, "reset");
    return reply.send(ok);
  });

  app.post("/v1/auth/password/reset", async (req, reply) => {
    const parsed = ResetPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendProblem(reply, 400, "invalid_body", JSON.stringify(parsed.error.flatten()));

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user) return sendProblem(reply, 400, "wrong_code");

    const otp = await store.getOtp(user.id);
    if (!otp || otp.purpose !== "reset" || otp.consumedAt) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    if (otp.expiresAt.getTime() < Date.now()) return sendProblem(reply, 400, "code_expired", "Request a new code.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return sendProblem(reply, 400, "too_many_attempts", "Request a new code.");
    }
    if (otp.codeHash !== hashOtp(parsed.data.code, user.id)) {
      await store.incrementOtpAttempts(otp.id);
      return sendProblem(reply, 400, "wrong_code", `${OTP_MAX_ATTEMPTS - otp.attempts - 1} attempts left.`);
    }

    await store.consumeOtp(otp.id);
    await store.setUserPassword(user.id, await hashPassword(parsed.data.newPassword));
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    const shop = await store.getShopByUserId(user.id);
    return reply.send({ token, user: { id: user.id, email: user.email, hasShop: Boolean(shop) } });
  });

  app.get("/v1/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await store.getUserById(req.user.sub);
    if (!user) return sendProblem(reply, 404, "not_found");
    const shop = await store.getShopByUserId(user.id);
    return reply.send({
      id: user.id,
      email: user.email,
      hasShop: Boolean(shop),
      shop: shop ? { id: shop.id, name: shop.name, emoji: shop.emoji } : undefined,
    });
  });
}
