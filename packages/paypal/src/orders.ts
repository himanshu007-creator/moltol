import type { PayPalClient } from "./client";

export interface CreateOrderResult {
  orderId: string;
  approveUrl: string | null;
  status: string;
}

export interface CaptureResult {
  orderId: string;
  status: string;
  captureId: string | null;
  captureStatus: string | null;
}

interface OrderResponse {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
}

interface CaptureResponse {
  id: string;
  status: string;
  purchase_units?: {
    payments?: { captures?: { id: string; status: string }[] };
  }[];
}

function moneyValue(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

/**
 * Create a CAPTURE-intent order for the agreed price. `requestId` is a stable
 * idempotency key (use `<negotiationId>:create`), so a retry never double-creates.
 */
export async function createOrder(
  client: PayPalClient,
  params: {
    amountCents: number;
    currency: string;
    referenceId: string;
    requestId: string;
    returnUrl?: string;
    cancelUrl?: string;
  },
): Promise<CreateOrderResult> {
  const body: Record<string, unknown> = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: params.referenceId,
        amount: { currency_code: params.currency, value: moneyValue(params.amountCents) },
      },
    ],
  };
  if (params.returnUrl || params.cancelUrl) {
    body.application_context = {
      ...(params.returnUrl ? { return_url: params.returnUrl } : {}),
      ...(params.cancelUrl ? { cancel_url: params.cancelUrl } : {}),
      user_action: "PAY_NOW",
    };
  }
  const { ok, status, data } = await client.request<OrderResponse>("POST", "/v2/checkout/orders", {
    body,
    requestId: params.requestId,
  });
  if (!ok || !data.id) {
    throw new Error(`paypal create order failed: ${status} ${JSON.stringify(data)}`);
  }
  const approve =
    data.links?.find((l) => l.rel === "approve") ??
    data.links?.find((l) => l.rel === "payer-action");
  return { orderId: data.id, approveUrl: approve?.href ?? null, status: data.status };
}

export async function getOrder(client: PayPalClient, orderId: string): Promise<OrderResponse> {
  const { ok, data } = await client.request<OrderResponse>("GET", `/v2/checkout/orders/${orderId}`);
  if (!ok) throw new Error(`paypal get order failed: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Capture an approved order. `requestId` is a stable idempotency key (use
 * `<negotiationId>:capture`) so a webhook retry and an onApprove click cannot
 * both capture twice.
 */
export async function captureOrder(
  client: PayPalClient,
  orderId: string,
  requestId: string,
): Promise<CaptureResult> {
  const { ok, status, data } = await client.request<CaptureResponse>(
    "POST",
    `/v2/checkout/orders/${orderId}/capture`,
    { body: {}, requestId },
  );
  if (!ok) throw new Error(`paypal capture failed: ${status} ${JSON.stringify(data)}`);
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: data.id ?? orderId,
    status: data.status,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
  };
}
