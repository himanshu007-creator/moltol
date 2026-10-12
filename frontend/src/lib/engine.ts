import type { NegotiationEvent, Tactic } from './events';
import { getProduct, getShop, type Shop } from './catalog';
import { getComps } from './market';
import { formatMoney } from './money';
import {
  commitment,
  concession,
  fairnessScore,
  PERSONAS,
  randomSaltHex,
  nextOffer,
  shouldAccept,
  zopaExists,
  type PersonaId,
} from './policy';

/**
 * The mock negotiation runner — stands in for the Render Workflow (plan.md §9.2.4).
 * It emits the exact wire contract the UI consumes, so swapping in the real
 * engine later changes nothing above `ws.ts`.
 */

export interface RunOptions {
  negotiationId: string;
  productId: string;
  buyerMaxCents: number;
  buyerBeta?: number;
  buyerSalt?: string;
  shopSalt?: string;
  roundsMax?: number;
  /** injectable for tests/fixtures; defaults to the real Channel3 stub */
  market?: NegotiationEvent extends never ? never : Awaited<ReturnType<typeof getComps>>['market'];
}

const DEFAULT_ROUNDS = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function personaVoice(persona: PersonaId): string {
  return PERSONAS[persona].voice;
}

/* deterministic but flavourful lines — the "LLM banter" stand-in */
function buyerLine(price: number, market: number, currency: string, round: number, isAnchor: boolean): string {
  if (isAnchor) {
    return `I'll open at ${formatMoney(price, currency)}. Comparable listings sit near ${formatMoney(market, currency)}.`;
  }
  if (round % 3 === 0) {
    return `Still high. I can do ${formatMoney(price, currency)} — that's my honest number.`;
  }
  return `How about ${formatMoney(price, currency)}? Keep it fair and I'll take it today.`;
}

function shopLine(
  price: number,
  currency: string,
  persona: PersonaId,
  round: number,
  isFinal: boolean,
): string {
  const amount = formatMoney(price, currency);
  if (isFinal) return `Final offer: ${amount}. Not a cent lower, I'd be losing on it.`;
  switch (persona) {
    case 'charmer':
      return round % 2 === 0
        ? `You drive a hard bargain! Take two and I'll meet you at ${amount}.`
        : `For you, ${amount}. That already includes the discount I give my regulars.`;
    case 'storyteller':
      return `My regulars pay more than ${amount}, but you seem like good people.`;
    case 'analyst':
      return `At ${amount} my margin is already thin — the market across town runs higher.`;
    default:
      return `${amount}. Firm.`;
  }
}

export async function runNegotiation(opts: RunOptions): Promise<NegotiationEvent[]> {
  const product = getProduct(opts.productId);
  const shop: Shop | undefined = product ? getShop(product.shopId) : undefined;
  if (!product || !shop) throw new Error(`Unknown product: ${opts.productId}`);

  const currency = product.currency;
  const market = opts.market ?? (await getComps(opts.productId)).market;

  const T = opts.roundsMax ?? DEFAULT_ROUNDS;
  const Rb = opts.buyerMaxCents;
  const Rs = product.floorCents;
  const Ps0 = product.listPriceCents;

  const buyerBeta = opts.buyerBeta ?? PERSONAS.analyst.beta;
  const shopBeta = PERSONAS[shop.persona].beta;

  const p25 = market.p25Cents;
  const Pb0 = clamp(Math.round(p25 * 0.85), Math.round(Rb * 0.5), Rb);

  const buyerSalt = opts.buyerSalt ?? randomSaltHex();
  const shopSalt = opts.shopSalt ?? randomSaltHex();

  const events: NegotiationEvent[] = [];
  events.push({
    t: 'session.started',
    negotiationId: opts.negotiationId,
    item: product.title,
    currency,
    roundsMax: T,
    market,
  });
  events.push({ t: 'commit.recorded', side: 'buyer', commit: await commitment(Rb, buyerSalt) });
  events.push({ t: 'commit.recorded', side: 'shop', commit: await commitment(Rs, shopSalt) });

  let seq = 0;
  let agreedPrice: number | null = null;

  if (!zopaExists(Rs, Rb)) {
    // no possible agreement — agents walk away honestly
    events.push({
      t: 'turn',
      seq: seq++,
      actor: 'buyer',
      kind: 'offer',
      priceCents: Pb0,
      message: buyerLine(Pb0, market.medianCents, currency, 1, true),
      tactic: 'anchor',
    });
    events.push({
      t: 'turn',
      seq: seq++,
      actor: 'shop',
      kind: 'walkaway',
      message: `I can't go anywhere near that. We're too far apart.`,
    });
    events.push({ t: 'session.ended', reason: 'no_zopa' });
    return events;
  }

  for (let t = 1; t <= T && agreedPrice == null; t++) {
    const buyerOffer = Math.round(nextOffer('buyer', t, T, buyerBeta, Pb0, Rb));
    const isAnchor = t === 1;
    const buyerTactic: Tactic = isAnchor ? 'anchor' : t === T ? 'final-offer' : 'market-cite';
    events.push({
      t: 'turn',
      seq: seq++,
      actor: 'buyer',
      kind: 'offer',
      priceCents: buyerOffer,
      message: buyerLine(buyerOffer, market.medianCents, currency, t, isAnchor),
      tactic: buyerTactic,
    });

    const shopNextAsk = Math.round(nextOffer('shop', t + 1, T, shopBeta, Ps0, Rs));
    if (shouldAccept('shop', buyerOffer, shopNextAsk, Rs)) {
      agreedPrice = buyerOffer;
      events.push({
        t: 'turn',
        seq: seq++,
        actor: 'shop',
        kind: 'accept',
        priceCents: buyerOffer,
        message: `Deal. ${formatMoney(buyerOffer, currency)} it is.`,
      });
      break;
    }

    const shopCounter = Math.round(nextOffer('shop', t, T, shopBeta, Ps0, Rs));
    const shopTactic: Tactic =
      t === T ? 'final-offer' : shop.persona === 'charmer' ? 'bundle' : shop.persona === 'storyteller' ? 'loyalty' : 'market-cite';
    events.push({
      t: 'turn',
      seq: seq++,
      actor: 'shop',
      kind: 'counter',
      priceCents: shopCounter,
      message: shopLine(shopCounter, currency, shop.persona, t, t === T),
      tactic: shopTactic,
    });

    const buyerNextAsk = Math.round(nextOffer('buyer', t + 1, T, buyerBeta, Pb0, Rb));
    if (shouldAccept('buyer', shopCounter, buyerNextAsk, Rb)) {
      agreedPrice = shopCounter;
      events.push({
        t: 'turn',
        seq: seq++,
        actor: 'buyer',
        kind: 'accept',
        priceCents: shopCounter,
        message: `Agreed — ${formatMoney(shopCounter, currency)}. Let's settle it.`,
      });
      break;
    }
  }

  if (agreedPrice == null) {
    // round limit reached inside the ZOPA — settle at the midpoint, clamped
    const lastBuyer = lastPrice(events, 'buyer') ?? Rb;
    const lastShop = lastPrice(events, 'shop') ?? Rs;
    agreedPrice = clamp(Math.round((lastBuyer + lastShop) / 2), Rs, Rb);
  }

  events.push({ t: 'deal.agreed', priceCents: agreedPrice });

  const orderId = `PP-${opts.negotiationId.slice(0, 8).toUpperCase()}`;
  events.push({ t: 'payment.status', status: 'order_created', orderId });
  events.push({ t: 'payment.status', status: 'approved', orderId });
  events.push({ t: 'payment.status', status: 'captured', orderId });
  events.push({
    t: 'proof.revealed',
    verified: true,
    fairness: fairnessScore(agreedPrice, Rs, Rb),
    buyerSavedCents: Math.max(0, market.medianCents - agreedPrice),
    reveal: {
      buyerLimitCents: Rb,
      buyerSalt,
      shopFloorCents: Rs,
      shopSalt,
    },
  });
  events.push({ t: 'session.ended', reason: 'deal' });

  return events;
}

function lastPrice(events: NegotiationEvent[], side: 'buyer' | 'shop'): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.t === 'turn' && e.actor === side && typeof e.priceCents === 'number') return e.priceCents;
  }
  return null;
}

/** Convenience: a demo plan with a sensible budget cap derived from the list price. */
export function defaultBuyerMax(productId: string): number {
  const product = getProduct(productId);
  if (!product) return 5000;
  return Math.round(product.listPriceCents * 0.92);
}

export { personaVoice, concession };
