import type {
  MarketRange,
  Negotiation,
  NegotiationEvent,
  Persona,
  Side,
  Tactic,
  Turn,
} from "@moltol/contracts";
import type { SealedRecord, StepCommit } from "@moltol/store";

/** Market comps lookup (Channel3 or seeded fallback). */
export interface MarketProvider {
  /** `referenceCents` (e.g. a shop's list price) anchors the offline fallback's spread. */
  getComps(
    query: string,
    currency: string,
    hint?: { referenceCents?: number | undefined },
  ): Promise<MarketRange>;
}

export interface TurnContext {
  negotiationId: string;
  actor: Side;
  persona: Persona;
  round: number;
  roundsMax: number;
  market: MarketRange;
  currency: string;
  /** The price policy intends to offer. The LLM may only nudge it within the band. */
  policyPriceCents: number;
  opponentLastPriceCents?: number;
  history: { actor: Side; priceCents?: number; message: string }[];
}

export interface TurnSuggestion {
  priceCents: number;
  message: string;
  tactic?: Tactic;
}

/** The LLM port. It only ever writes wording and a within-band price nudge. */
export interface TurnGenerator {
  generate(ctx: TurnContext): Promise<TurnSuggestion>;
}

/**
 * The persistence port. Implemented by @moltol/store's MoltolStore. Kept narrow so
 * the engine can run against an in-memory double in tests. Every write goes
 * through `commitStep`, which appends a whole step atomically or not at all.
 */
export interface EngineStore {
  getNegotiation(id: string): Promise<Negotiation | null>;
  listEvents(negotiationId: string, afterSeq?: number): Promise<NegotiationEvent[]>;
  putSealed(record: SealedRecord): Promise<void>;
  getSealed(negotiationId: string, side: Side): Promise<SealedRecord | null>;
  commitStep(commit: StepCommit): Promise<NegotiationEvent[] | null>;
}

export interface EngineDeps {
  store: EngineStore;
  llm: TurnGenerator;
  market: MarketProvider;
  bandPct?: number;
  onEvent?: (event: NegotiationEvent) => Promise<void>;
  log?: (fields: Record<string, unknown>) => void;
  /** Pause before each agent turn so the haggle streams at a watchable pace (0 in tests). */
  turnDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HaggleOutcome {
  /** handed_over: a human took the buyer side, the runner stopped without moving. */
  state: "agreed" | "no_deal" | "handed_over" | "ended";
  agreedPriceCents: number | null;
  turns: Turn[];
  rounds: number;
}
