import type { Container } from "./container";

/**
 * Create the PayPal order for a deal. The deal amount is in the shop's currency
 * (INR); the gateway is charged in its own currency (USD) via the container's
 * settling rate. Returns the quote so callers can record both.
 */
export async function createCheckoutForDeal(
  container: Container,
  deal: { referenceId: string; amountCents: number; currency: string },
): Promise<{
  order: { orderId: string; approveUrl: string | null };
  charged: { amountCents: number; currency: string; fxRate: number };
}> {
  const settlement = container.settle(deal.amountCents, deal.currency);
  const order = await container.checkout.createCheckout({
    referenceId: deal.referenceId,
    amountCents: settlement.amountCents,
    currency: settlement.currency,
  });
  return {
    order,
    charged: {
      amountCents: settlement.amountCents,
      currency: settlement.currency,
      fxRate: settlement.rate,
    },
  };
}
