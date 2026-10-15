import type { NegotiationEvent } from "@moltol/contracts";
import type { StepActor } from "@moltol/store";
import { nextMover, type HaggleState } from "./state";
import {
  loadContext,
  planBuyerAgentStep,
  planShopAgentStep,
  planStart,
  type LineContext,
  type PlannedStep,
} from "./steps";
import type { EngineDeps, HaggleOutcome } from "./types";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Commit one planned step (all of it or none) and publish what was written. */
export async function commitPlanned(
  ctx: LineContext,
  step: PlannedStep,
  actor: StepActor,
  deps: EngineDeps,
): Promise<NegotiationEvent[] | null> {
  const events = await deps.store.commitStep({
    negotiationId: ctx.negotiation.id,
    expectedSeq: ctx.state.nextSeq,
    actor,
    bodies: step.bodies,
    ...(step.patch ? { patch: step.patch } : {}),
    ...(step.transition ? { transition: step.transition } : {}),
  });
  if (events && deps.onEvent) for (const event of events) await deps.onEvent(event);
  return events;
}

function outcomeOf(ctx: LineContext, handedOver: boolean): HaggleOutcome {
  const s: HaggleState = ctx.state;
  const state: HaggleOutcome["state"] =
    s.agreedPriceCents !== null
      ? "agreed"
      : s.endedReason === "no_zopa"
        ? "no_deal"
        : handedOver
          ? "handed_over"
          : "ended";
  return {
    state,
    agreedPriceCents: s.agreedPriceCents,
    turns: s.turns,
    rounds: s.buyerOffers.length,
  };
}

/**
 * The negotiation runner. Each iteration rebuilds state from the event log,
 * plans exactly one step (every price from policy, through the guard), and
 * commits it atomically with the seq it expects. So:
 *
 *  - a restarted worker resumes where the log stops — nothing is replayed or duplicated;
 *  - a human taking the lane over makes the next agent commit fail, and the
 *    runner stops without moving again ("handed_over");
 *  - with `turnDelayMs` the haggle streams at a watchable pace.
 */
export async function runHaggle(negotiationId: string, deps: EngineDeps): Promise<HaggleOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  let refusals = 0;
  for (let i = 0; i < 64; i++) {
    const ctx = await loadContext(negotiationId, deps);
    const mover = nextMover(ctx.state);
    if (mover === "done" || ctx.negotiation.controlled) {
      const outcome = outcomeOf(ctx, ctx.negotiation.controlled && mover !== "done");
      deps.log?.({
        negotiationId,
        state: outcome.state,
        agreed: outcome.agreedPriceCents,
        turns: outcome.turns.length,
      });
      return outcome;
    }

    const step =
      mover === "start"
        ? planStart(ctx)
        : mover === "buyer"
          ? await planBuyerAgentStep(ctx, deps)
          : await planShopAgentStep(ctx, deps);
    if (step.paced && deps.turnDelayMs) await sleep(deps.turnDelayMs);

    const written = await commitPlanned(ctx, step, "agent", deps);
    if (written) {
      refusals = 0;
      continue;
    }
    // Refused: a human took over, or another writer moved the log. Re-read and decide again.
    if (++refusals > 5) throw new Error(`negotiation ${negotiationId}: commit refused repeatedly`);
  }
  throw new Error(`negotiation ${negotiationId} did not finish within its step budget`);
}
