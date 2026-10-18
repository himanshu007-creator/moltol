import { z } from "zod";

/** ISO-4217 currency code, uppercase. */
export const CurrencySchema = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase());
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * Money is always an integer count of minor units (cents) plus a currency.
 * Never floats. See AGENTS.md invariant #1.
 */
export const MoneySchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: CurrencySchema.default("INR"),
});
export type Money = z.infer<typeof MoneySchema>;

/** Render cents for humans, e.g. 3500 + "USD" -> "$35.00". */
export function formatMoney(money: Money): string {
  const value = (money.amountCents / 100).toFixed(2);
  const symbol = money.currency === "USD" ? "$" : "";
  return `${symbol}${value} ${money.currency === "USD" ? "" : money.currency}`.trim();
}

/**
 * Short price for negotiation wording: "$35.00", "₹35" / "₹35.50", "35.00 EUR".
 * Display only — never parse it back into money.
 */
export function formatCents(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  if (code === "INR") {
    const rupees = cents / 100;
    return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
  }
  const value = (cents / 100).toFixed(2);
  return code === "USD" ? `$${value}` : `${value} ${code}`;
}
