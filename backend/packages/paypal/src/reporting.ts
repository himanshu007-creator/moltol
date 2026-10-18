import { PayPalClient } from "./client";
import type { PayPalConfig } from "./config";

/**
 * Read-only PayPal reporting tools for the Ledger Agent. These are best-effort:
 * sandbox app credentials often lack the `transaction_search` scope, and no
 * report should ever break the seller's own ledger. Every call returns `null`
 * on any failure and the caller falls back to the ledger's own numbers.
 */

export interface PayPalTransaction {
  transactionId: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  date: string | null;
}

export interface MerchantInsights {
  grossCents: number | null;
  feesCents: number | null;
  netCents: number | null;
  currency: string | null;
  transactionCount: number;
}

export interface PayPalReporting {
  /** Recent transaction-search results, or null if unavailable. */
  listTransactions(window: { from: Date; to: Date }): Promise<PayPalTransaction[] | null>;
  /** Aggregate gross/fee/net for the window, or null if unavailable. */
  getMerchantInsights(window: { from: Date; to: Date }): Promise<MerchantInsights | null>;
}

const iso = (d: Date) => d.toISOString();

interface TransactionItem {
  transaction_info?: {
    transaction_status?: string;
    transaction_amount?: { value?: string; currency_code?: string };
  };
  transaction_id?: string;
}

/** Only constructed when PayPal is configured; otherwise the agent runs ledger-only. */
export function createPayPalReporting(config: PayPalConfig): PayPalReporting {
  const client = new PayPalClient(config);

  async function search(window: { from: Date; to: Date }) {
    const query = new URLSearchParams({
      start_date: iso(window.from),
      end_date: iso(window.to),
      fields: "transaction_info,transaction_id",
      page_size: "100",
    });
    return client.request<{ transaction_details?: TransactionItem[] }>(
      "GET",
      `/v1/reporting/transactions?${query.toString()}`,
    );
  }

  return {
    async listTransactions(window) {
      try {
        const res = await search(window);
        if (!res.ok) return null;
        return (res.data.transaction_details ?? []).map((item) => ({
          transactionId: item.transaction_id ?? null,
          status: item.transaction_info?.transaction_status ?? null,
          amountCents: item.transaction_info?.transaction_amount?.value
            ? Math.round(Number(item.transaction_info.transaction_amount.value) * 100)
            : null,
          currency: item.transaction_info?.transaction_amount?.currency_code ?? null,
          date: null,
        }));
      } catch {
        return null;
      }
    },

    async getMerchantInsights(window) {
      try {
        const res = await search(window);
        if (!res.ok) return null;
        const items = res.data.transaction_details ?? [];
        let grossCents = 0;
        let currency: string | null = null;
        let count = 0;
        for (const item of items) {
          const value = item.transaction_info?.transaction_amount?.value;
          if (!value) continue;
          grossCents += Math.round(Number(value) * 100);
          currency = item.transaction_info?.transaction_amount?.currency_code ?? currency;
          count += 1;
        }
        return { grossCents, feesCents: null, netCents: null, currency, transactionCount: count };
      } catch {
        return null;
      }
    },
  };
}
