import {
  lineCents,
  type Basket,
  type BasketLine,
  type BasketState,
  type HaggleTone,
  type HagglePreset,
  type NearbyShop,
  type Negotiation,
  type Order,
  type PaymentStatus,
  type Persona,
  type Shop,
  type ShopDeal,
  type ShopItem,
  type ShopStatus,
} from "@moltol/contracts";
import type { BasketRow, PaymentRow, ShopItemRow, ShopRow } from "@moltol/store";

/** Row -> contract mapping. Nothing here ever reads the vault. */

const TERMINAL_LINE_STATES = new Set([
  "agreed",
  "payment_pending",
  "paid",
  "revealed",
  "no_deal",
  "failed",
]);

export const isTerminal = (line: Negotiation): boolean => TERMINAL_LINE_STATES.has(line.state);
export const hasDeal = (line: Negotiation): boolean => line.agreedPriceCents !== null;

/** Stall status with any timer that has come due already applied (the frontend's tick, server-side). */
export function shopStatus(row: ShopRow, now = Date.now()): ShopStatus {
  const closeAt = row.closeAt?.getTime() ?? null;
  const reopenAt = row.reopenAt?.getTime() ?? null;
  if (row.isOpen && closeAt !== null && now >= closeAt) {
    return { open: false, closeAt: null, reopenAt: null };
  }
  if (!row.isOpen && reopenAt !== null && now >= reopenAt) {
    return { open: true, closeAt: null, reopenAt: null };
  }
  return { open: row.isOpen, closeAt, reopenAt };
}

export function shopView(row: ShopRow): Shop {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    persona: row.persona as Persona,
    currency: row.currency,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    status: shopStatus(row),
    locationUpdatedAt: row.locationUpdatedAt ? row.locationUpdatedAt.getTime() : null,
  };
}

export function nearbyView(row: ShopRow, distanceM: number, itemCount: number): NearbyShop {
  return {
    ...shopView(row),
    distanceM: Math.round(distanceM),
    itemCount,
    locationUpdatedAt: row.locationUpdatedAt ? row.locationUpdatedAt.getTime() : null,
  };
}

export function shopItemView(row: ShopItemRow): ShopItem {
  return {
    id: row.id,
    shopId: row.shopId,
    name: row.name,
    emoji: row.emoji,
    sellCents: row.sellCents,
    floorCents: row.floorCents,
    costCents: row.costCents ?? null,
    category: row.category ?? null,
    quantity: row.quantity,
    lowStockAt: row.lowStockAt !== null && row.lowStockAt !== undefined ? Number(row.lowStockAt) : null,
    archived: row.archived ?? false,
    unit: row.unit,
    customUnit: row.customUnit ?? null,
    packSize: row.packSize !== null && row.packSize !== undefined ? Number(row.packSize) : null,
    hindiName: row.hindiName,
  };
}

/** Great-circle distance in metres. */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineView(line: Negotiation): BasketLine {
  const qty = line.qty ?? 1;
  const list = line.openCents ?? line.maxTotalCents;
  let ask = list;
  let lastBuyer: number | null = null;
  for (const turn of line.turns) {
    if (turn.kind !== "offer" && turn.kind !== "counter") continue;
    if (turn.actor === "shop" && turn.priceCents !== undefined) ask = turn.priceCents;
    if (turn.actor === "buyer" && turn.priceCents !== undefined) lastBuyer = turn.priceCents;
  }
  return {
    lineItemId: line.id,
    itemId: line.shopItemId!,
    name: line.query,
    emoji: line.itemEmoji,
    unit: line.itemUnit,
    qty,
    listCents: list,
    listLineCents: lineCents(list, qty),
    state: line.state,
    controlled: line.controlled,
    askCents: ask,
    lastBuyerCents: lastBuyer,
    agreedUnitCents: line.agreedPriceCents,
    agreedLineCents: line.agreedPriceCents === null ? null : lineCents(line.agreedPriceCents, qty),
    market: line.market,
  };
}

export function basketState(basket: BasketRow, lines: Negotiation[]): BasketState {
  if (basket.state === "paid" || basket.state === "payment_pending" || basket.state === "failed") {
    return basket.state;
  }
  return lines.every(isTerminal) ? "settled" : "negotiating";
}

export function basketView(
  basket: BasketRow,
  shop: ShopRow | null,
  lines: Negotiation[],
  payment: PaymentRow | null,
): Basket {
  const views = lines.map(lineView);
  const closed = views.filter((l) => l.agreedLineCents !== null);
  const listCents = closed.reduce((sum, l) => sum + l.listLineCents, 0);
  const agreedCents = closed.reduce((sum, l) => sum + l.agreedLineCents!, 0);
  return {
    id: basket.id,
    shopId: basket.shopId,
    shopName: shop?.name ?? "",
    shopEmoji: shop?.emoji ?? "🏪",
    currency: basket.currency,
    state: basketState(basket, lines),
    request: {
      rounds: basket.roundsMax,
      tone: basket.tone as HaggleTone,
      preset: (basket.preset as HagglePreset | null) ?? null,
    },
    lines: views,
    totals: {
      listCents,
      agreedCents,
      savedCents: Math.max(0, listCents - agreedCents),
      agreedLines: closed.length,
      openLines: lines.filter((l) => !isTerminal(l)).length,
    },
    paypalOrderId: payment?.paypalOrderId ?? null,
    createdAt: basket.createdAt.toISOString(),
  };
}

export function orderView(
  basket: BasketRow,
  shop: ShopRow | null,
  lines: Negotiation[],
  payment: PaymentRow,
  proofs: { negotiationId: string; fairness: number; verified: string }[],
): Order {
  const closed = lines.filter(hasDeal);
  const lineCentsOf = (l: Negotiation) => lineCents(l.agreedPriceCents!, l.qty ?? 1);
  const listOf = (l: Negotiation) => lineCents(l.openCents ?? l.maxTotalCents, l.qty ?? 1);
  const totalCents = closed.reduce((sum, l) => sum + lineCentsOf(l), 0);
  const listCents = closed.reduce((sum, l) => sum + listOf(l), 0);
  const marketCents = closed.reduce(
    (sum, l) => sum + (l.market ? lineCents(l.market.medianCents, l.qty ?? 1) : 0),
    0,
  );
  const ownProofs = proofs.filter((p) => closed.some((l) => l.id === p.negotiationId));
  const allProved = closed.length > 0 && ownProofs.length === closed.length;
  return {
    id: basket.id,
    ts: (basket.paidAt ?? payment.createdAt).toISOString(),
    shopId: basket.shopId,
    shopName: shop?.name ?? "",
    shopEmoji: shop?.emoji ?? "🏪",
    currency: basket.currency,
    lines: lines.map((l) => ({
      lineItemId: l.id,
      itemId: l.shopItemId,
      title: l.query,
      emoji: l.itemEmoji,
      unit: l.itemUnit,
      qty: l.qty ?? 1,
      unitCents: l.agreedPriceCents,
      lineCents: hasDeal(l) ? lineCentsOf(l) : null,
      listLineCents: listOf(l),
      noDeal: !hasDeal(l),
    })),
    totalCents,
    listCents,
    marketCents,
    savingsCents: Math.max(0, listCents - totalCents),
    fairness: allProved
      ? Math.round(ownProofs.reduce((sum, p) => sum + p.fairness, 0) / ownProofs.length)
      : null,
    proofVerified: allProved && ownProofs.every((p) => p.verified === "true"),
    paymentStatus: payment.status as PaymentStatus,
  };
}

/**
 * The checkout quote for a stored payment: the gateway charge (`amountCents` /
 * `currency`) plus the deal total in the shop's currency and the rate used. Rows
 * from before FX support fall back to the charge as the deal at rate 1.
 */
export function paymentQuote(payment: PaymentRow): {
  paypalOrderId: string;
  approveUrl: string | null;
  amountCents: number;
  currency: string;
  deal: { amountCents: number; currency: string };
  fxRate: number;
} {
  return {
    paypalOrderId: payment.paypalOrderId,
    approveUrl: payment.approveUrl,
    amountCents: payment.amountCents,
    currency: payment.currency,
    deal: {
      amountCents: payment.dealAmountCents ?? payment.amountCents,
      currency: payment.dealCurrency ?? payment.currency,
    },
    fxRate: payment.fxRate !== null ? Number(payment.fxRate) : 1,
  };
}

export function dealView(line: Negotiation, basket: BasketRow): ShopDeal {
  const qty = line.qty ?? 1;
  return {
    id: line.id,
    ts: (basket.paidAt ?? basket.createdAt).toISOString(),
    itemId: line.shopItemId,
    name: line.query,
    emoji: line.itemEmoji,
    unit: line.itemUnit,
    qty,
    won: hasDeal(line),
    unitCents: line.agreedPriceCents,
    lineCents: hasDeal(line) ? lineCents(line.agreedPriceCents!, qty) : null,
    listCents: line.openCents ?? line.maxTotalCents,
    currency: line.currency,
  };
}
