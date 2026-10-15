import type { ProofResult } from "@moltol/contracts";
import type { PaymentRow } from "@moltol/store";
import type { Container } from "./container";
import { revealProof } from "./proof";
import { hasDeal } from "./views";

/**
 * Settlement, shared by the capture endpoints and the PayPal webhook. Every
 * step is conditional (state transitions, once-only events), so a capture call
 * racing the CAPTURE.COMPLETED webhook — or a retry after a crash halfway —
 * simply finishes whatever the other one has not done yet.
 */

/** The negotiations a payment covers: the standalone one, or the basket's closed lines. */
async function coveredLines(c: Container, payment: PaymentRow): Promise<string[]> {
  if (payment.basketId) {
    return (await c.store.listBasketLines(payment.basketId)).filter(hasDeal).map((l) => l.id);
  }
  return payment.negotiationId ? [payment.negotiationId] : [];
}

async function settleLine(
  c: Container,
  negotiationId: string,
  orderId: string,
  captureId: string | null,
): Promise<ProofResult | null> {
  // A checkout interrupted before this line moved to payment_pending still settles.
  const pending = await c.store.appendSystemEvent(
    negotiationId,
    { t: "payment.status", status: "order_created", paypalOrderId: orderId },
    { transition: { from: ["agreed"], to: "payment_pending", required: true } },
  );
  if (pending) await c.publish(pending);
  const event = await c.store.appendSystemEvent(
    negotiationId,
    {
      t: "payment.status",
      status: "captured",
      paypalOrderId: orderId,
      ...(captureId ? { paypalCaptureId: captureId } : {}),
    },
    { transition: { from: ["payment_pending"], to: "paid", required: true } },
  );
  if (event) await c.publish(event);
  return revealProof(c.store, negotiationId, c.publish);
}

/** Record a completed capture and settle everything it pays for. Returns the revealed proofs. */
export async function settleCapture(
  c: Container,
  payment: PaymentRow,
  captureId: string | null,
): Promise<ProofResult[]> {
  // Never resurrect a refunded or failed payment.
  await c.store.setPaymentStatus(payment.paypalOrderId, "captured", {
    captureId,
    onlyFrom: ["order_created", "approved", "captured"],
  });
  const fresh = await c.store.getPaymentByOrder(payment.paypalOrderId);
  if (!fresh || fresh.status !== "captured") return [];
  const capture = fresh.paypalCaptureId ?? captureId;

  if (fresh.basketId) {
    const lines = (await c.store.listBasketLines(fresh.basketId)).filter(hasDeal);
    // Only the call that flips the basket to paid takes the quantities out of stock.
    await c.store.markBasketPaid(
      fresh.basketId,
      lines.map((l) => ({ shopItemId: l.shopItemId!, qty: l.qty ?? 1 })),
    );
  } else if (fresh.negotiationId) {
    await c.store.setPayment(fresh.negotiationId, fresh.paypalOrderId, capture ?? undefined);
  }

  const proofs: ProofResult[] = [];
  for (const id of await coveredLines(c, fresh)) {
    const proof = await settleLine(c, id, fresh.paypalOrderId, capture);
    if (proof) proofs.push(proof);
  }
  return proofs;
}

/**
 * Act on a capture result from PayPal itself: settle only COMPLETED; a PENDING
 * capture waits for the webhook; anything else (DECLINED, FAILED) fails it.
 */
export async function applyCapture(
  c: Container,
  payment: PaymentRow,
  capture: { captureId: string; status: string },
): Promise<{ outcome: "captured" | "pending" | "failed"; proofs: ProofResult[] }> {
  if (capture.status === "COMPLETED") {
    return { outcome: "captured", proofs: await settleCapture(c, payment, capture.captureId) };
  }
  if (capture.status === "PENDING") {
    await c.store.setPaymentStatus(payment.paypalOrderId, "approved", {
      onlyFrom: ["order_created"],
    });
    return { outcome: "pending", proofs: [] };
  }
  await failPayment(c, payment);
  return { outcome: "failed", proofs: [] };
}

/** CHECKOUT.ORDER.APPROVED: note it, then capture server-side so a dropped onApprove still settles. */
export async function approveAndCapture(c: Container, payment: PaymentRow): Promise<void> {
  if (
    await c.store.setPaymentStatus(payment.paypalOrderId, "approved", {
      onlyFrom: ["order_created"],
    })
  ) {
    for (const id of await coveredLines(c, payment)) {
      const event = await c.store.appendSystemEvent(id, {
        t: "payment.status",
        status: "approved",
        paypalOrderId: payment.paypalOrderId,
      });
      if (event) await c.publish(event);
    }
  }
  const reference = payment.basketId ?? payment.negotiationId;
  if (!reference || payment.status === "captured") return;
  // Idempotent (PayPal-Request-Id): PayPal answers with the capture's real status.
  await applyCapture(c, payment, await c.checkout.capture(reference, payment.paypalOrderId));
}

/** PAYMENT.CAPTURE.DENIED: the order can't be paid; its lines end failed. */
export async function failPayment(c: Container, payment: PaymentRow): Promise<void> {
  const moved = await c.store.setPaymentStatus(payment.paypalOrderId, "failed", {
    onlyFrom: ["order_created", "approved"],
  });
  if (!moved) return;
  for (const id of await coveredLines(c, payment)) {
    const event = await c.store.appendSystemEvent(
      id,
      { t: "payment.status", status: "failed", paypalOrderId: payment.paypalOrderId },
      { transition: { from: ["payment_pending"], to: "failed" } },
    );
    if (event) await c.publish(event);
  }
  if (payment.basketId)
    await c.store.transitionBasket(payment.basketId, ["payment_pending"], "failed");
}

/** PAYMENT.CAPTURE.REFUNDED: the deal and its proof stand; the payment is marked refunded. */
export async function refundPayment(c: Container, payment: PaymentRow): Promise<void> {
  const moved = await c.store.setPaymentStatus(payment.paypalOrderId, "refunded", {
    onlyFrom: ["captured"],
  });
  if (!moved) return;
  for (const id of await coveredLines(c, payment)) {
    const event = await c.store.appendSystemEvent(id, {
      t: "payment.status",
      status: "refunded",
      paypalOrderId: payment.paypalOrderId,
    });
    if (event) await c.publish(event);
  }
}
