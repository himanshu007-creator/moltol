import { useOrders } from '@/stores/orders';
import { playVoice } from '@/lib/voiceClips';
import { useUi } from '@/stores/ui';

/**
 * Money reaches the vendor when a buyer's payment is captured. Announce it once per
 * order, so the shopkeeper hears "N rupees credited" without looking at the screen.
 */
let started = false;

export function startMoneyEvents() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const announced = new Set(useOrders.getState().orders.filter((o) => o.paymentStatus === 'captured').map((o) => o.id));
  useOrders.subscribe((state) => {
    for (const o of state.orders) {
      if (o.paymentStatus !== 'captured' || announced.has(o.id)) continue;
      announced.add(o.id);
      // the splash is pure visual — no autoplay-gate wait, it's there the instant the
      // payment lands, even on a tab that hasn't had a click yet to unlock audio
      useUi.getState().showMoneySplash(o.totalCents);
      playVoice('money.credited', { amount: Math.round(o.totalCents / 100) });
    }
  });
}
