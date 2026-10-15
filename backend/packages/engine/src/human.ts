import type { Negotiation, NegotiationEvent, Turn } from "@moltol/contracts";
import { formatCents } from "@moltol/contracts";
import { validateOffer } from "@moltol/policy";
import { commitPlanned } from "./run-haggle";
import { askOf, nextMover } from "./state";
import {
  acceptStep,
  controlStep,
  EngineError,
  loadContext,
  planShopHumanResponse,
  planStart,
  withTurn,
  type LineContext,
  type PlannedStep,
} from "./steps";
import type { EngineDeps } from "./types";

/**
 * The buyer taking a lane over from its agent. Every human action is a step
 * committed through the same guard-checked, seq-checked path as the agent's,
 * so the two can never interleave: whoever commits second sees a stale seq and
 * re-reads. The shop side always stays with policy.
 */
export interface HumanResult {
  negotiation: Negotiation;
  /** True when this action closed the deal. */
  accepted: boolean;
  /** The shop's new ask when it countered. */
  counterCents: number | null;
  events: NegotiationEvent[];
}

const MAX_ATTEMPTS = 5;

/** Run `attempt` until it commits; it returns null when a commit was refused (stale seq). */
async function withRetries(
  negotiationId: string,
  attempt: () => Promise<Omit<HumanResult, "negotiation"> | null>,
  deps: EngineDeps,
): Promise<HumanResult> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const result = await attempt();
    if (result) {
      const negotiation = await deps.store.getNegotiation(negotiationId);
      if (!negotiation)
        throw new EngineError("not_found", `negotiation ${negotiationId} not found`);
      return { ...result, negotiation };
    }
  }
  throw new EngineError("conflict", "the negotiation kept moving; try again");
}

type Progress = { events: NegotiationEvent[]; accepted: boolean; counterCents: number | null };

/** Commit a step as the human; null means it was refused and the caller must re-read. */
async function apply(
  ctx: LineContext,
  step: PlannedStep,
  deps: EngineDeps,
  progress: Progress,
): Promise<boolean> {
  const written = await commitPlanned(ctx, step, "human", deps);
  if (!written) return false;
  progress.events.push(...written);
  if (step.outcome.kind === "deal") progress.accepted = true;
  if (step.outcome.kind === "counter") progress.counterCents = step.outcome.priceCents;
  return true;
}

/**
 * Bring a lane to "the buyer's move, under human control": start it if the
 * runner hasn't yet, flip control, and let the shop answer a pending agent
 * offer (the shop may even accept it). Returns the fresh context, or null when
 * a commit was refused.
 */
async function takeControl(
  negotiationId: string,
  deps: EngineDeps,
  progress: Progress,
): Promise<LineContext | null> {
  let ctx = await loadContext(negotiationId, deps);
  if (nextMover(ctx.state) === "done") return ctx;
  if (nextMover(ctx.state) === "start") {
    if (!(await apply(ctx, planStart(ctx), deps, progress))) return null;
    ctx = await loadContext(negotiationId, deps);
  }
  if (!ctx.negotiation.controlled) {
    if (!(await apply(ctx, controlStep(), deps, progress))) return null;
    ctx = await loadContext(negotiationId, deps);
  }
  if (nextMover(ctx.state) === "shop") {
    if (!(await apply(ctx, await planShopHumanResponse(ctx, deps), deps, progress))) return null;
    ctx = await loadContext(negotiationId, deps);
  }
  return ctx;
}

export async function takeOver(negotiationId: string, deps: EngineDeps): Promise<HumanResult> {
  return withRetries(
    negotiationId,
    async () => {
      const progress: Progress = { events: [], accepted: false, counterCents: null };
      const first = await loadContext(negotiationId, deps);
      if (nextMover(first.state) === "done") {
        throw new EngineError("ended", "this haggle has already finished");
      }
      return (await takeControl(negotiationId, deps, progress)) ? progress : null;
    },
    deps,
  );
}

/**
 * A human counter-offer. The guard holds it to the buyer's sealed ceiling; an
 * offer at or above the shop's standing ask simply takes the ask. The shop
 * answers in the same atomic step.
 */
export async function humanOffer(
  negotiationId: string,
  priceCents: number,
  deps: EngineDeps,
): Promise<HumanResult> {
  return withRetries(
    negotiationId,
    async () => {
      const progress: Progress = { events: [], accepted: false, counterCents: null };
      const first = await loadContext(negotiationId, deps);
      if (nextMover(first.state) === "done") {
        throw new EngineError("ended", "this haggle has already finished");
      }
      if (!first.negotiation.controlled) {
        throw new EngineError("not_controlled", "take the lane over before making an offer");
      }
      const ctx = await takeControl(negotiationId, deps, progress);
      if (!ctx) return null;
      if (nextMover(ctx.state) === "done") return progress;

      const { sides, state, negotiation: n } = ctx;
      const check = validateOffer({
        side: "buyer",
        priceCents,
        limitCents: sides.buyerMax,
        maxTotalCents: sides.buyerMax,
      });
      if (!check.ok) {
        throw new EngineError("above_ceiling", "that offer is above your sealed ceiling");
      }

      const ask = askOf(state, sides.shopOpen);
      if (priceCents >= ask) {
        const step = acceptStep(ctx, "buyer", ask, `Deal at ${formatCents(ask, n.currency)}.`);
        return (await apply(ctx, { ...step, paced: false }, deps, progress)) ? progress : null;
      }

      const offer: Turn = {
        seq: state.turns.length,
        actor: "buyer",
        kind: state.buyerOffers.length === 0 ? "offer" : "counter",
        priceCents,
        message: `Can you do ${formatCents(priceCents, n.currency)}?`,
      };
      const reply = await planShopHumanResponse({ ...ctx, state: withTurn(state, offer) }, deps);
      const step: PlannedStep = { ...reply, bodies: [{ t: "turn", turn: offer }, ...reply.bodies] };
      return (await apply(ctx, step, deps, progress)) ? progress : null;
    },
    deps,
  );
}

/** Accept the shop's standing ask (taking the lane over first if the agent still has it). */
export async function humanAccept(negotiationId: string, deps: EngineDeps): Promise<HumanResult> {
  return withRetries(
    negotiationId,
    async () => {
      const progress: Progress = { events: [], accepted: false, counterCents: null };
      const first = await loadContext(negotiationId, deps);
      if (nextMover(first.state) === "done") {
        throw new EngineError("ended", "this haggle has already finished");
      }
      const ctx = await takeControl(negotiationId, deps, progress);
      if (!ctx) return null;
      // The shop may have just accepted the agent's pending offer: done, and cheaper.
      if (nextMover(ctx.state) === "done") return progress;

      const { sides, state, negotiation: n } = ctx;
      const ask = askOf(state, sides.shopOpen);
      if (ask > sides.buyerMax) {
        throw new EngineError("above_ceiling", "the shop's ask is above your sealed ceiling");
      }
      const step = acceptStep(ctx, "buyer", ask, `Deal at ${formatCents(ask, n.currency)}.`);
      return (await apply(ctx, { ...step, paced: false }, deps, progress)) ? progress : null;
    },
    deps,
  );
}
