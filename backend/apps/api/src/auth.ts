import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Container } from "./container";
import { sendProblem } from "./http";

/**
 * Sessions are JWTs that expire (JWT_TTL) and can be revoked two ways:
 *  - logout revokes one session: its `jti` is denied in Redis until it would expire anyway;
 *  - a password reset revokes all of them: the user's `tokenVersion` moves past every `tv` issued.
 * Tokens from before this scheme (no `tv`/`jti`, and no expiry) are refused.
 */

const revokedKey = (jti: string) => `moltol:revoked:${jti}`;

export function issueToken(
  app: FastifyInstance,
  user: { id: string; email: string; tokenVersion: number },
): string {
  return app.jwt.sign({
    sub: user.id,
    email: user.email,
    tv: user.tokenVersion,
    jti: randomUUID(),
  });
}

export async function revokeSession(
  container: Container,
  claims: { jti: string; exp?: number | undefined },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = claims.exp ? Math.max(1, claims.exp - now) : 7 * 24 * 3600;
  await container.redis.set(revokedKey(claims.jti), "1", "EX", ttl);
}

export function registerAuthenticate(app: FastifyInstance, container: Container): void {
  app.decorate("authenticate", async (req, reply) => {
    const deny = () => sendProblem(reply, 401, "unauthorized", "Log in again.");
    try {
      await req.jwtVerify();
    } catch {
      return deny();
    }
    const { sub, tv, jti } = req.user;
    if (typeof tv !== "number" || typeof jti !== "string") return deny();
    if (await container.redis.exists(revokedKey(jti))) return deny();
    const user = await container.store.getUserById(sub);
    if (!user || user.tokenVersion !== tv) return deny();
  });
}
