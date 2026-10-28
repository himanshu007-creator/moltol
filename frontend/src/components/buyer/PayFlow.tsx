import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { navigate } from "astro:transitions/client";
import { selectBazaar, useBazaar } from "@/stores/bazaar";
import { useOrders, fromBackendOrder, TRACKER_STEPS } from "@/stores/orders";
import { useCart } from "@/stores/cart";
import { useSession } from "@/stores/session";
import {
  checkoutBasket,
  captureBasket,
  retryBasketCheckout,
  getBasket,
  getOrder,
  BackendAuthError,
  type BasketCheckoutResult,
} from "@/lib/backend";
import { formatMoney } from "@/lib/money";
import { roundQty } from "@/lib/units";
import { cn } from "@/lib/cn";
import TickPrice from "@/components/motion/TickPrice";
import HashVerify from "@/components/motion/HashVerify";

const Handshake = lazy(() => import("../theatre/Handshake"));

type Stage = "ready" | "paying" | "proof" | "done";

/**
 * Settle the agreed prices against the real basket: PayPal sandbox checkout,
 * order created → approved → captured, then the real proof reveal and receipt.
 */
export default function PayFlow() {
  const bz = useBazaar();
  const cart = useCart();
  const orders = useOrders();
  const session = useSession();
  const sum = useMemo(() => selectBazaar(bz), [bz]);
  const [stage, setStage] = useState<Stage>("ready");
  const [rating, setRating] = useState<number>(0);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [showSavedBalloon, setShowSavedBalloon] = useState(false);
  // Real-basket checkout state — unused on the local mock path.
  const [realStep, setRealStep] = useState<
    "order_created" | "approved" | "captured" | null
  >(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // Set once checkout (or a retry) names a PayPal order that never got
  // captured — the next "Pay now" click must call /retry, not checkout again,
  // since checkout is idempotent and would just hand back the same stale order.
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  // Shown only when the gateway charged a different currency than the deal
  // (INR shop -> PayPal settling in USD) — see ADR 0008.
  const [charge, setCharge] = useState<BasketCheckoutResult | null>(null);

  const agreed = sum.lanes.filter((l) => !l.noDeal && l.agreedCents != null);
  const order = orderId
    ? orders.orders.find((o) => o.id === orderId)
    : undefined;

  // Proof plays once, automatically, then the receipt prints itself — no
  // "see my receipt" click in between. The savings balloon pops a beat before
  // the slip, so the "aha" lands first.
  useEffect(() => {
    if (stage !== "proof") return;
    const t1 = setTimeout(() => setShowSavedBalloon(true), 500);
    const t2 = setTimeout(() => setShowSavedBalloon(false), 2200);
    const t3 = setTimeout(() => setStage("done"), 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [stage]);

  /** After PayPal approval (or immediately, for the mock gateway's null approveUrl). */
  const finishCapture = async (token: string, basketId: string) => {
    try {
      await captureBasket(token, basketId);
      setRealStep("captured");
      const real = await getOrder(token, basketId);
      orders.upsert(fromBackendOrder(real));
      setStage("proof");
    } catch (e) {
      setPayError(
        e instanceof BackendAuthError
          ? e.detail || e.title
          : "Payment failed. Try again.",
      );
      setCheckoutFailed(true);
      setStage("ready");
    }
  };

  // The PayPal webhook can capture the order server-side before the buyer
  // clicks "I've approved it" (or even if the redirect back here never
  // happens at all, e.g. a misconfigured return URL) — poll the basket while
  // waiting on approval so the UI advances on its own either way.
  // captureBasket() is idempotent, so calling it again here is harmless.
  useEffect(() => {
    if (!approveUrl || realStep === "captured") return;
    const basketId = bz.basketId;
    const token = session.token;
    if (!basketId || !token) return;
    const t = setInterval(() => {
      getBasket(token, basketId)
        .then((b) => {
          if (b.state === "paid") void finishCapture(token, basketId);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveUrl, realStep, bz.basketId, session.token]);

  const pay = async () => {
    setPayError(null);
    setStage("paying");

    if (!bz.basketId) {
      setPayError("This basket isn't real — nothing to pay.");
      setStage("ready");
      return;
    }
    const token = useSession.getState().token;
    if (!token) {
      setPayError("Your session expired. Log in again.");
      setStage("ready");
      return;
    }
    setOrderId(bz.basketId);
    setRealStep("order_created");
    try {
      const checkout = checkoutFailed
        ? await retryBasketCheckout(token, bz.basketId)
        : await checkoutBasket(token, bz.basketId);
      setCharge(checkout);
      setCheckoutFailed(false);
      setRealStep("approved");
      if (checkout.approveUrl) {
        setApproveUrl(checkout.approveUrl);
        window.open(checkout.approveUrl, "_blank", "noopener");
        return; // wait for "I've approved it" below
      }
      await finishCapture(token, bz.basketId);
    } catch (e) {
      setPayError(
        e instanceof BackendAuthError
          ? e.detail || e.title
          : "Checkout failed. Try again.",
      );
      setCheckoutFailed(true);
      setStage("ready");
    }
  };

  const shopAgain = () => {
    cart.clear();
    bz.reset();
    // Soft nav: a hard reload can outrun the async IndexedDB writes of the
    // clear/reset just made, and the old basket or deal reappears on arrival.
    void navigate("/app/buy");
  };

  if (sum.totalDone === 0) {
    return (
      <div className="surface grid justify-items-center gap-4 p-10 text-center">
        <span
          className="grid h-20 w-20 place-items-center rounded-3xl bg-paper-3 text-4xl"
          aria-hidden="true"
        >
          🧾
        </span>
        <div>
          <p className="t-h2">Nothing to settle yet</p>
          <p className="mt-1 text-ink-muted">
            Finish a haggle first. The bill builds up as each item closes.
          </p>
        </div>
        <a href="/app/bazaar" className="btn btn-primary">
          Back to the live bazaar
        </a>
      </div>
    );
  }

  if (stage === "paying") {
    const paid = realStep;
    const steps = [
      { label: "Order created", done: true },
      {
        label: "Approved · sealed prices locked",
        done: paid === "approved" || paid === "captured",
      },
      { label: "Captured", done: paid === "captured" },
    ];
    return (
      <div className="grid min-h-[60dvh] place-items-center py-8">
        <div className="grid w-full max-w-sm gap-5 rounded-3xl bg-ink p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="pill !bg-paper/15 !text-paper">PayPal sandbox</span>
            <span className="t-num text-xs text-paper/60">{orderId}</span>
          </div>
          <div>
            <p className="text-sm text-paper/70">Paying {bz.shopName.en}</p>
            <TickPrice
              cents={sum.totalAgreedCents}
              className="t-num mt-1 block text-4xl font-semibold text-paper"
            />
            {charge && charge.fxRate !== 1 && (
              <p className="mt-1 text-xs text-paper/60">
                Charged as{" "}
                {formatMoney(charge.amountCents, charge.currency)} via PayPal
                (PayPal doesn't settle {charge.deal.currency} directly).
              </p>
            )}
          </div>
          <ol className="grid gap-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-xs font-bold",
                    s.done ? "bg-teal text-white" : "bg-paper/15 text-paper/60",
                  )}
                >
                  {s.done ? "✓" : "·"}
                </span>
                <span className={s.done ? "text-paper" : "text-paper/60"}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
          {approveUrl && paid !== "captured" && (
            <div className="grid gap-2">
              <p className="text-xs text-paper/70">
                Approve the order in the PayPal tab that just opened, then come
                back here.
              </p>
              <button
                type="button"
                onClick={() => {
                  const token = useSession.getState().token;
                  if (token && bz.basketId) void finishCapture(token, bz.basketId);
                }}
                className="btn btn-primary !min-h-11"
              >
                I've approved it on PayPal
              </button>
            </div>
          )}
          {payError && (
            <p role="alert" className="text-sm font-medium text-chili">
              {payError}
            </p>
          )}
          <p className="text-xs text-paper/60">Sandbox PayPal — no real money moves. {session.name}</p>
        </div>
      </div>
    );
  }

  if (stage === "proof") {
    return (
      <div className="relative grid gap-5 pb-40">
        <div className="overflow-hidden rounded-[2rem]">
          <Suspense fallback={<div className="h-72" />}>
            <Handshake label="Locked and proved" />
          </Suspense>
        </div>
        <p className="text-center text-sm text-ink-muted">
          Proof of fair deal: both secret limits revealed together. Printing
          your receipt…
        </p>

        <AnimatePresence>
          {showSavedBalloon && sum.totalSavedCents > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="pointer-events-none fixed inset-x-0 top-24 z-40 mx-auto w-fit rounded-full bg-teal px-5 py-2.5 text-base font-bold text-white shadow-2xl"
            >
              🎉 You saved {formatMoney(sum.totalSavedCents)}!
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (stage === "done") {
    const when = order ? new Date(order.ts) : new Date();
    return (
      <div className="grid gap-5 pb-40">
        {/* the total, as a receipt header — printed in: slides up from the "slot" and the
            bottom edge tears itself off, like a thermal till slip */}
        <motion.section
          initial={{ y: -64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 20 }}
          className="surface-accent ticket-edge grid justify-items-center gap-2 overflow-hidden p-7 text-center"
        >
          <span
            className="grid h-14 w-14 place-items-center rounded-full bg-paper/80 text-3xl text-teal"
            aria-hidden="true"
          >
            ✓
          </span>
          <p className="t-label !text-[#5b3200]">Paid and proved</p>
          <TickPrice
            cents={sum.totalAgreedCents}
            className="t-num text-4xl font-semibold text-[#23180a] sm:text-5xl"
          />
          <p className="text-sm text-[#3d2a0c]">
            {sum.totalSavedCents > 0
              ? `You saved ${formatMoney(sum.totalSavedCents)} against the sticker price`
              : "Paid at the sticker price"}
          </p>
        </motion.section>

        {/* receipt: a paper slip with a tear line */}
        <motion.section
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 180,
            damping: 20,
            delay: 0.12,
          }}
          className="surface ticket-edge grid gap-4 p-5 sm:p-6"
          aria-labelledby="receipt-h"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="receipt-h" className="t-h2">
                Receipt
              </h2>
              <p className="text-xs text-ink-muted">
                {bz.shopName.en} ·{" "}
                {when.toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <span className="pill pill-teal">Captured</span>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-muted">Order</dt>
            <dd className="t-num text-right text-ink">{orderId}</dd>
            <dt className="text-ink-muted">Sticker price</dt>
            <dd className="t-num text-right text-ink-muted line-through">
              {formatMoney(sum.totalListCents)}
            </dd>
            <dt className="font-semibold text-ink">You paid</dt>
            <dd className="t-num text-right text-lg font-semibold text-ink">
              {formatMoney(sum.totalAgreedCents)}
            </dd>
          </dl>
          <div className="border-t border-dashed border-chalk-strong pt-4">
            <ul className="grid gap-2">
              {agreed.map((l) => (
                <li key={l.sku} className="flex items-center gap-3 text-sm">
                  <span className="text-lg" aria-hidden="true">
                    {l.emoji}
                  </span>
                  <span className="flex-1 truncate text-ink">
                    {l.title.en} × {roundQty(l.qty)}
                  </span>
                  <span className="t-num text-ink">
                    {formatMoney(l.agreedCents!)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </motion.section>

        {/* proof: what the reveal means, in numbers */}
        <section
          className="surface grid gap-4 p-5 sm:p-6"
          aria-labelledby="proof-h"
        >
          <div>
            <h2 id="proof-h" className="t-h2">
              Proof of fair deal
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Each agent locked its limit before haggling. The reveal shows your
              final price sat between the shop's lowest price and the market
              median.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <ProofCell label="Limits" value="Verified" tone="text-teal" />
            <ProofCell
              label={`Items × ${agreed.length}`}
              value="Within limits"
              tone="text-teal"
            />
            <ProofCell
              label="Fairness"
              value={`${sum.fairness}%`}
              tone="text-warn"
            />
          </div>
          <div className="grid gap-2 border-t border-chalk pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Settlement hash
            </p>
            <HashVerify
              input={`${orderId}|${sum.totalAgreedCents}|${sum.totalMarketCents}`}
            />
          </div>
        </section>

        <section className="surface grid gap-4 p-5" aria-labelledby="track-h">
          <h2 id="track-h" className="t-h2">
            {bz.shopName.en} is packing your basket
          </h2>
          <Tracker />
        </section>

        <section className="surface grid gap-3 p-5" aria-labelledby="rate-h">
          <h2 id="rate-h" className="t-h2">
            How did your haggler do?
          </h2>
          <div
            className="grid grid-cols-5 gap-2"
            role="radiogroup"
            aria-label="Rating"
          >
            {["😠", "🙂", "😊", "🤩", "🥰"].map((e, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={rating === i + 1}
                onClick={() => setRating(i + 1)}
                className={cn(
                  "grid min-h-14 place-items-center rounded-2xl text-3xl transition active:scale-95",
                  rating === i + 1
                    ? "bg-marigold/35 ring-2 ring-marigold"
                    : "bg-paper-3",
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={shopAgain} className="btn btn-quiet">
            Shop again
          </button>
          <button
            type="button"
            onClick={() => {
              cart.clear();
              bz.reset();
              void navigate("/app/orders");
            }}
            className="btn btn-primary"
          >
            My orders →
          </button>
        </div>
      </div>
    );
  }

  // ready: the bill before paying
  return (
    <div className="grid gap-5 pb-40">
      <section
        className="surface grid gap-4 p-5 sm:p-6"
        aria-labelledby="bill-h"
      >
        <div className="flex items-center gap-3">
          <span
            className="grid h-14 w-14 place-items-center rounded-2xl bg-paper-3 text-3xl"
            aria-hidden="true"
          >
            {bz.shopEmoji}
          </span>
          <div className="min-w-0">
            <h1 id="bill-h" className="t-h2">
              Settle with {bz.shopName.en}
            </h1>
            <p className="text-sm text-ink-muted">
              {sum.totalDone} price{sum.totalDone === 1 ? "" : "s"} locked by
              your haggler. Both secret limits open only after you pay.
            </p>
          </div>
        </div>
        <ul className="grid gap-2 border-t border-chalk pt-4">
          {agreed.map((l) => (
            <li key={l.sku} className="flex items-center gap-3 text-sm">
              <span className="text-lg" aria-hidden="true">
                {l.emoji}
              </span>
              <span className="flex-1 truncate text-ink">
                {l.title.en} × {roundQty(l.qty)}
              </span>
              <span className="t-num text-ink">
                {formatMoney(l.agreedCents!)}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-1 border-t border-chalk pt-4 text-sm">
          <div className="flex justify-between text-ink-muted">
            <span>Sticker price</span>
            <span className="t-num line-through">
              {formatMoney(sum.totalListCents)}
            </span>
          </div>
          <div className="flex items-end justify-between">
            <span className="text-base font-semibold text-ink">You pay</span>
            <span className="price-tag !text-xl">
              {formatMoney(sum.totalAgreedCents)}
            </span>
          </div>
        </div>
        {sum.totalSavedCents > 0 && (
          <p className="pill pill-teal w-fit">
            Saves {formatMoney(sum.totalSavedCents)} against sticker
          </p>
        )}
      </section>

      <a href="/app/bazaar" className="btn btn-link mx-auto">
        Back to the live bazaar
      </a>

      {payError && (
        <p
          role="alert"
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+10rem)] z-30 mx-auto max-w-md rounded-2xl bg-chili/15 px-4 py-2 text-sm font-medium text-chili sm:bottom-40"
        >
          {payError}
        </p>
      )}

      {/* pay bar, thumb reach, above the bottom nav */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 px-4 sm:bottom-24">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-ink p-3 pl-4 shadow-2xl">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-paper/60">
              You pay
            </p>
            <p className="t-num text-xl font-semibold text-paper">
              {formatMoney(sum.totalAgreedCents)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void pay()}
            className="btn btn-primary !min-h-12"
          >
            {checkoutFailed ? "Retry payment" : "Pay now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProofCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="surface-soft grid gap-1 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className={cn("text-sm font-bold", tone)}>{value}</p>
    </div>
  );
}

function Tracker() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => Math.min(i + 1, TRACKER_STEPS.length - 1)),
      1400,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <ol className="grid grid-cols-3 gap-2">
      {TRACKER_STEPS.map((s, i) => {
        const done = i <= idx;
        return (
          <li key={s} className="grid justify-items-center gap-2 text-center">
            <span
              className={cn(
                "grid h-10 w-10 place-items-center rounded-full text-sm font-bold transition",
                done ? "bg-teal text-white" : "bg-paper-3 text-ink-faint",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "text-xs font-semibold",
                done ? "text-ink" : "text-ink-faint",
              )}
            >
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
