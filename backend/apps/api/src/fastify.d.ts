import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** sub = user id; tv = the user's token version at issue; jti = this session's id. */
    payload: { sub: string; email: string; tv: number; jti: string };
    user: { sub: string; email: string; tv: number; jti: string; exp?: number };
  }
}
