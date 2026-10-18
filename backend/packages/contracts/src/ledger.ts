import { z } from "zod";
import { CurrencySchema } from "./money";

/**
 * The seller's Merchant Ledger: the data engine AG Grid Studio binds to, plus
 * the aggregate/KPI widgets and the "Ledger Agent" Q&A. Everything here is
 * seller-private (owner-only auth) — it includes the vendor's own floor and the
 * margin kept, which never leaves the seller's own view.
 */

export const LedgerPeriodSchema = z.enum(["7d", "30d", "90d", "all"]).default("30d");
export type LedgerPeriod = z.infer<typeof LedgerPeriodSchema>;

/** A period as a concrete window. `from` is null for "all" (open-ended). */
export const LedgerWindowSchema = z.object({
  period: LedgerPeriodSchema,
  from: z.string().nullable(),
  to: z.string(),
});
export type LedgerWindow = z.infer<typeof LedgerWindowSchema>;

/** One haggled line, as the ledger grid sees it. Money is integer cents. */
export const LedgerRowSchema = z.object({
  id: z.string().uuid(),
  ts: z.string(),
  basketId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  name: z.string(),
  emoji: z.string().nullable(),
  unit: z.string().nullable(),
  qty: z.number(),
  won: z.boolean(),
  /** Agreed per-unit price; null when the line did not close. */
  unitCents: z.number().int().nullable(),
  lineCents: z.number().int().nullable(),
  /** Sticker (list) price per unit and for the line. */
  listCents: z.number().int(),
  listLineCents: z.number().int(),
  /** The vendor's own floor for the line (seller-only). */
  floorCents: z.number().int().nullable(),
  floorLineCents: z.number().int().nullable(),
  /** Realised margin on a won line: agreed line − floor line. */
  marginCents: z.number().int().nullable(),
  /** How much came off the sticker, in whole percent (0–100). */
  discountPct: z.number().int().min(0).max(100),
  /** Fairness of the line's proof, or null until the proof is revealed. */
  fairness: z.number().int().min(0).max(100).nullable(),
  proofVerified: z.boolean(),
  currency: CurrencySchema,
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export const LedgerKpisSchema = z.object({
  deals: z.object({
    total: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    /** Won / total, in whole percent. */
    winRatePct: z.number().int().min(0).max(100),
  }),
  unitsSold: z.number(),
  revenueCents: z.number().int().nonnegative(),
  listCents: z.number().int().nonnegative(),
  /** Total given away vs. sticker on won lines. */
  savingsGivenCents: z.number().int().nonnegative(),
  /** Agreed minus the vendor's own floor, summed over won lines. */
  marginKeptCents: z.number().int(),
  avgDiscountPct: z.number().int().min(0).max(100),
  avgFairness: z.number().int().min(0).max(100).nullable(),
  /** Share of won lines whose proof verified, whole percent. */
  proofVerifiedRatePct: z.number().int().min(0).max(100),
});
export type LedgerKpis = z.infer<typeof LedgerKpisSchema>;

/** A named value, for a bar/column widget (e.g. margin kept by item). */
export const LedgerBarSchema = z.object({
  label: z.string(),
  valueCents: z.number().int(),
  count: z.number().int().nonnegative(),
});
export type LedgerBar = z.infer<typeof LedgerBarSchema>;

/** One bucket of a histogram (e.g. fairness score bands). */
export const LedgerBucketSchema = z.object({
  label: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  count: z.number().int().nonnegative(),
});
export type LedgerBucket = z.infer<typeof LedgerBucketSchema>;

/** One stage of the deal funnel, from baskets created to baskets paid. */
export const LedgerFunnelStageSchema = z.object({
  stage: z.enum(["created", "settled", "checked_out", "paid"]),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type LedgerFunnelStage = z.infer<typeof LedgerFunnelStageSchema>;

export const LedgerWidgetsSchema = z.object({
  /** Top items by margin kept (won lines only). */
  marginByItem: z.array(LedgerBarSchema),
  /** Top items by revenue. */
  revenueByItem: z.array(LedgerBarSchema),
  /** Fairness-score distribution, 20-point bands. */
  fairnessHistogram: z.array(LedgerBucketSchema),
  /** Baskets created → settled → checked out → paid. */
  dealFunnel: z.array(LedgerFunnelStageSchema),
});
export type LedgerWidgets = z.infer<typeof LedgerWidgetsSchema>;

/** GET /v1/ledger — everything the grid and its widgets bind to, in one call. */
export const LedgerSchema = z.object({
  window: LedgerWindowSchema,
  currency: CurrencySchema,
  kpis: LedgerKpisSchema,
  widgets: LedgerWidgetsSchema,
  rows: z.array(LedgerRowSchema),
});
export type Ledger = z.infer<typeof LedgerSchema>;

/** GET /v1/ledger/summary — the KPI cards alone (no grid rows). */
export const LedgerSummarySchema = z.object({
  window: LedgerWindowSchema,
  currency: CurrencySchema,
  kpis: LedgerKpisSchema,
});
export type LedgerSummary = z.infer<typeof LedgerSummarySchema>;

/* ----------------------------- buyer insights ----------------------------- */

export const BuyerInsightCardSchema = z.object({
  kind: z.enum(["savings", "streak", "budget", "fairness", "shops", "spend"]),
  title: z.string(),
  /** A short human number ("₹420", "3 days"); `value` is the raw figure. */
  value: z.number(),
  detail: z.string(),
});
export type BuyerInsightCard = z.infer<typeof BuyerInsightCardSchema>;

export const BuyerInsightsSchema = z.object({
  orders: z.number().int().nonnegative(),
  totalSpentCents: z.number().int().nonnegative(),
  totalListCents: z.number().int().nonnegative(),
  totalSavedCents: z.number().int().nonnegative(),
  avgSavingsPct: z.number().int().min(0).max(100),
  avgFairness: z.number().int().min(0).max(100).nullable(),
  /** Consecutive days with at least one order, ending today or yesterday. */
  streakDays: z.number().int().nonnegative(),
  /** Optional monthly budget the buyer set; nudges stay silent without one. */
  budgetCents: z.number().int().nonnegative().nullable(),
  cards: z.array(BuyerInsightCardSchema),
});
export type BuyerInsights = z.infer<typeof BuyerInsightsSchema>;

export const BuyerInsightsQuerySchema = z.object({
  budgetCents: z.coerce.number().int().nonnegative().optional(),
});
export type BuyerInsightsQuery = z.infer<typeof BuyerInsightsQuerySchema>;

/* ------------------------------ ledger agent ------------------------------ */

/** POST /v1/ledger/ask — a natural-language question about the seller's ledger. */
export const LedgerAskRequestSchema = z.object({
  question: z.string().min(1).max(500),
  period: LedgerPeriodSchema,
});
export type LedgerAskRequest = z.infer<typeof LedgerAskRequestSchema>;

export const LedgerAnswerSchema = z.object({
  answer: z.string(),
  /** "hybrid" when an LLM grounded the answer in the ledger data. */
  source: z.enum(["hybrid", "heuristic", "paypal"]),
  /** Which numbers the answer is grounded in (labels the caller can cite). */
  facts: z.array(z.string()),
  window: LedgerWindowSchema,
});
export type LedgerAnswer = z.infer<typeof LedgerAnswerSchema>;
