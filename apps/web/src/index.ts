/**
 * Placeholder for the MolTol buyer/shop console. It exists so the shared API
 * surface (types + routes) is exercised by the workspace build and so the
 * frontend can be filled in without touching the backend contract.
 *
 * The source of truth for every type here is `@moltol/contracts`.
 */
export type {
  CheckoutResult,
  CreateNegotiationInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  NegotiationState,
  ProofResult,
  Turn,
} from "@moltol/contracts";

export function negotiationPath(id: string): string {
  return `/v1/negotiations/${id}`;
}

export function eventsPath(id: string, after = -1): string {
  return `/v1/negotiations/${id}/events?after=${after}`;
}

export function proofPath(id: string): string {
  return `/v1/negotiations/${id}/proof`;
}

export function checkoutPath(id: string): string {
  return `/v1/negotiations/${id}/checkout`;
}

export function capturePath(id: string): string {
  return `/v1/negotiations/${id}/capture`;
}
