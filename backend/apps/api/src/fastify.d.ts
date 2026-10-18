import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /**
     * A session token carries sub/tv/jti. A short-lived seller stream ticket
     * carries shopId/scope instead and no session claims, so all are optional
     * here; `authenticate` still rejects anything without a valid sub/tv/jti.
     */
    payload: {
      sub?: string;
      email?: string;
      tv?: number;
      jti?: string;
      shopId?: string;
      scope?: string;
    };
    user: { sub: string; email: string; tv: number; jti: string; exp?: number };
  }
}
