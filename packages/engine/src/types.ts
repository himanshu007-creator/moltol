import type {
  EventInput,
  MarketRange,
  Negotiation,
  NegotiationEvent,
  NegotiationState,
  Persona,
  Side,
  Tactic,
  Turn,
} from "@moltol/contracts";
import type { SealedRecord } from "@moltol/store";

/** Market comps lookup (Channel3 or seeded fallback). */
export interface MarketProvider {
  getComps(query: string, currency: string): Promise<MarketRange>;
}

export interface TurnContext {
  negotiationId: string;
  actor: Side;
  persona: Persona;
  round: number;
  roundsMax: number;
  market: MarketRange;
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
 * the engine can run against an in-memory double in tests.
 */
export interface EngineStore {
  getNegotiation(id: string): Promise<Negotiation | null>;
  nextSeq(id: string): Promise<number>;
  appendEvent(event: NegotiationEvent): Promise<void>;
  makeEvent(negotiationId: string, seq: number, body: EventInput): NegotiationEvent;
  putSealed(record: SealedRecord): Promise<void>;
  getSealed(negotiationId: string, side: Side): Promise<SealedRecord | null>;
  transition(id: string, from: NegotiationState, to: NegotiationState): Promise<boolean>;
  setAgreed(
    id: string,
    priceCents: number,
    market: MarketRange | null,
    turns: Turn[],
  ): Promise<void>;
  setTurns(id: string, turns: Turn[]): Promise<void>;
}

export interface EngineDeps {
  store: EngineStore;
  llm: TurnGenerator;
  market: MarketProvider;
  bandPct?: number;
  onEvent?: (event: NegotiationEvent) => Promise<void>;
  log?: (fields: Record<string, unknown>) => void;
}

export interface HaggleOutcome {
  state: "agreed" | "no_deal";
  agreedPriceCents: number | null;
  turns: Turn[];
  rounds: number;
}
