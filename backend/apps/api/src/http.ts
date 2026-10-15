import type { FastifyReply } from "fastify";
import { problem } from "@moltol/contracts";
import { EngineError, type EngineErrorCode } from "@moltol/engine";
import { PayPalApiError } from "@moltol/paypal";
import type { ZodError } from "zod";

/** Every non-2xx is RFC 9457 problem+json; `extra` adds fields such as `secondsRemaining`. */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ ...problem(status, title, detail), ...extra });
}

export function invalidBody(reply: FastifyReply, error: ZodError): FastifyReply {
  return sendProblem(reply, 400, "invalid_body", JSON.stringify(error.flatten()));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are uuids; anything else is a 404 here rather than a Postgres cast error (500). */
export function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

const ENGINE_STATUS: Record<EngineErrorCode, number> = {
  not_found: 404,
  ended: 409,
  not_controlled: 409,
  above_ceiling: 422,
  conflict: 409,
};

/** Map engine/payment failures to problems; anything else is rethrown (500 via the error handler). */
export function sendKnownError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof EngineError) {
    return sendProblem(reply, ENGINE_STATUS[err.code], err.code, err.message);
  }
  if (err instanceof PayPalApiError) {
    if (err.issue === "ORDER_NOT_APPROVED") {
      return sendProblem(reply, 409, "not_approved", "Approve the payment in PayPal first.");
    }
    return sendProblem(reply, 502, "payment_provider_error", err.message);
  }
  throw err;
}
