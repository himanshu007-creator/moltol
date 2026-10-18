/**
 * Settlement currency conversion. Shops price in their own currency (INR by
 * default), but a payment gateway may not support it — PayPal does not support
 * INR — so checkout quotes the charge in the gateway's currency. The conversion
 * is explicit and recorded: the deal keeps its shop-currency amounts everywhere
 * (lines, proofs, ledger), and the payment row carries both.
 */

export interface Settlement {
  /** What the gateway is actually asked to charge, in `currency`. */
  amountCents: number;
  currency: string;
  /** deal currency minor units → settlement minor units (1 when same currency). */
  rate: number;
}

export interface SettlementOptions {
  /** The gateway's currency, e.g. "USD". */
  settlementCurrency: string;
  /**
   * Multipliers per currency pair, keyed `"FROM_TO"`, applied to minor units.
   * Exact only while both currencies have the same number of decimal places
   * (INR and USD are both 2), which is why the rate is a direct multiplier.
   */
  rates?: Record<string, number>;
}

/**
 * Quote the gateway charge for a deal amount. An unknown pair returns the deal
 * amount unchanged (rate 1) rather than guessing a rate — the gateway then
 * rejects an unsupported currency honestly.
 */
export function settleAmount(
  amountCents: number,
  currency: string,
  opts: SettlementOptions,
): Settlement {
  const from = currency.toUpperCase();
  const to = opts.settlementCurrency.toUpperCase();
  if (from === to) return { amountCents, currency: to, rate: 1 };
  const rate = opts.rates?.[`${from}_${to}`];
  if (rate === undefined || rate <= 0) return { amountCents, currency: from, rate: 1 };
  return { amountCents: Math.round(amountCents * rate), currency: to, rate };
}
