import type { FastifyInstance } from "fastify";
import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  ResendOtpRequestSchema,
  ResetPasswordRequestSchema,
  SetHagglePresetRequestSchema,
  SetRoleRequestSchema,
  SignupRequestSchema,
  VerifyOtpRequestSchema,
  normalizeEmail,
  type HagglePreset,
  type Me,
  type OtpPurpose,
  type Role,
} from "@moltol/contracts";
import type { UserRow } from "@moltol/store";
import { issueToken, revokeSession } from "./auth";
import type { Container } from "./container";
import { sendOtpEmail } from "./email";
import { invalidBody, sendProblem } from "./http";
import {
  generateOtp,
  hashOtp,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  secondsUntil,
} from "./otp";
import { hashPassword, verifyPassword } from "./password";

/** Brute-force and email-spam guard for the unauthenticated auth endpoints (per client IP). */
const AUTH_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } };

async function issueOtp(
  container: Container,
  userId: string,
  email: string,
  purpose: OtpPurpose,
): Promise<void> {
  const code = generateOtp();
  await container.store.putOtp(
    userId,
    purpose,
    hashOtp(code, userId),
    new Date(Date.now() + OTP_TTL_MS),
  );
  await sendOtpEmail(container.env, email, code, purpose);
}

/** Resolves the caller's own active-code cooldown, or null if none/elapsed. */
async function activeCooldown(container: Container, userId: string): Promise<number | null> {
  const otp = await container.store.getOtp(userId);
  if (!otp) return null;
  const remaining = secondsUntil(new Date(otp.createdAt.getTime() + OTP_RESEND_COOLDOWN_MS));
  return remaining > 0 ? remaining : null;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  const { store } = container;

  const session = async (user: UserRow) => {
    const shop = await store.getShopByUserId(user.id);
    return {
      token: issueToken(app, user),
      user: { id: user.id, email: user.email, hasShop: Boolean(shop) },
    };
  };

  const meView = async (user: UserRow): Promise<Me> => {
    const shop = await store.getShopByUserId(user.id);
    return {
      id: user.id,
      email: user.email,
      hasShop: Boolean(shop),
      activeRole: user.activeRole as Role,
      hagglePreset: user.hagglePreset as HagglePreset,
      ...(shop ? { shop: { id: shop.id, name: shop.name, emoji: shop.emoji } } : {}),
    };
  };

  app.post("/v1/auth/signup", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = SignupRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");
    const { normalized: email } = normalized;

    const existing = await store.getUserByEmail(email);
    const passwordHash = await hashPassword(parsed.data.password);

    let userId: string;
    if (existing) {
      if (existing.emailVerifiedAt) {
        return sendProblem(
          reply,
          409,
          "account_exists",
          "An account already exists for this email. Log in instead.",
        );
      }
      const cooldown = await activeCooldown(container, existing.id);
      if (cooldown !== null) {
        return sendProblem(reply, 429, "resend_cooldown", undefined, {
          secondsRemaining: cooldown,
        });
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

  app.post("/v1/auth/otp/verify", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = VerifyOtpRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user) return sendProblem(reply, 404, "not_found");

    const otp = await store.getOtp(user.id);
    if (!otp || otp.purpose !== "signup" || otp.consumedAt) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    if (otp.expiresAt.getTime() < Date.now())
      return sendProblem(reply, 400, "code_expired", "Request a new code.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return sendProblem(reply, 400, "too_many_attempts", "Request a new code.");
    }

    if (otp.codeHash !== hashOtp(parsed.data.code, user.id)) {
      await store.incrementOtpAttempts(otp.id);
      return sendProblem(
        reply,
        400,
        "wrong_code",
        `${OTP_MAX_ATTEMPTS - otp.attempts - 1} attempts left.`,
      );
    }

    if (!(await store.consumeOtp(otp.id))) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    await store.markEmailVerified(user.id);
    return reply.send(await session(user));
  });

  app.post("/v1/auth/otp/resend", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = ResendOtpRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user || user.emailVerifiedAt) return sendProblem(reply, 404, "not_found");

    const cooldown = await activeCooldown(container, user.id);
    if (cooldown !== null) {
      return sendProblem(reply, 429, "resend_cooldown", undefined, { secondsRemaining: cooldown });
    }

    await issueOtp(container, user.id, user.email, "signup");
    return reply.send({
      ok: true,
      resendCooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
    });
  });

  app.post("/v1/auth/login", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 401, "invalid_credentials");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return sendProblem(reply, 401, "invalid_credentials");
    }
    if (!user.emailVerifiedAt) {
      return sendProblem(reply, 403, "not_verified", "Verify your email first.");
    }
    return reply.send(await session(user));
  });

  /** Ends this session only (the token is denied until it would have expired). */
  app.post("/v1/auth/logout", { preHandler: [app.authenticate] }, async (req, reply) => {
    await revokeSession(container, req.user);
    return reply.code(204).send();
  });

  /* ------------------------------ password reset ---------------------------- */

  app.post("/v1/auth/password/forgot", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = ForgotPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

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

  app.post("/v1/auth/password/reset", { config: AUTH_LIMIT }, async (req, reply) => {
    const parsed = ResetPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);

    const normalized = normalizeEmail(parsed.data.email);
    if (!normalized) return sendProblem(reply, 400, "invalid_email");

    const user = await store.getUserByEmail(normalized.normalized);
    if (!user) return sendProblem(reply, 400, "wrong_code");

    const otp = await store.getOtp(user.id);
    if (!otp || otp.purpose !== "reset" || otp.consumedAt) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    if (otp.expiresAt.getTime() < Date.now())
      return sendProblem(reply, 400, "code_expired", "Request a new code.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return sendProblem(reply, 400, "too_many_attempts", "Request a new code.");
    }
    if (otp.codeHash !== hashOtp(parsed.data.code, user.id)) {
      await store.incrementOtpAttempts(otp.id);
      return sendProblem(
        reply,
        400,
        "wrong_code",
        `${OTP_MAX_ATTEMPTS - otp.attempts - 1} attempts left.`,
      );
    }

    if (!(await store.consumeOtp(otp.id))) {
      return sendProblem(reply, 400, "no_active_code", "Request a new code.");
    }
    // A reset signs every existing session out: whoever held the old password loses access.
    const updated = await store.setUserPassword(
      user.id,
      await hashPassword(parsed.data.newPassword),
      { revokeSessions: true },
    );
    return reply.send(await session(updated ?? user));
  });

  /* ---------------------------------- me ------------------------------------ */

  app.get("/v1/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await store.getUserById(req.user.sub);
    if (!user) return sendProblem(reply, 404, "not_found");
    return reply.send(await meView(user));
  });

  /** The dual-role switch is a view preference; it never changes what a token may do. */
  app.patch("/v1/me/role", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = SetRoleRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    await store.setUserPreferences(req.user.sub, { activeRole: parsed.data.activeRole });
    return reply.send({ activeRole: parsed.data.activeRole });
  });

  app.put("/v1/me/preferences/haggle", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = SetHagglePresetRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(reply, parsed.error);
    await store.setUserPreferences(req.user.sub, { hagglePreset: parsed.data.preset });
    return reply.send({ preset: parsed.data.preset });
  });
}
