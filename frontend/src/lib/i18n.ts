/**
 * Light i18n (FE_plan §9). English is the base; Hindi and Punjabi cover the
 * demo moment. One dictionary, applied to React islands via `useI18n()` and to
 * static Astro chrome via `[data-i18n]` attributes (see Base.astro).
 * Later this can graduate to Astro i18n routing without touching call sites.
 */

export type Locale = 'en' | 'hi';

export const LOCALES: Array<{ id: Locale; label: string; native: string }> = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

type Dict = Record<string, string>;

const legacyEn: Dict = {
  'nav.home': 'Home',
  'nav.buy': 'Buy',
  'nav.shop': 'Your stall',
  'nav.ledger': 'Ledger',
  'nav.theme': 'Theme',
  'nav.language': 'Language',
  'common.startHaggling': 'Start haggling',
  'common.openStall': 'Open your stall',
  'common.viewLedger': 'Ask your ledger',
  'common.replay': 'Replay',
  'common.live': 'Live',
  'hero.eyebrow': 'Agent-to-agent commerce',
  'hero.title': 'Where agents haggle and PayPal settles.',
  'hero.sub':
    'Every shopkeeper gets an AI agent that never undersells them. Every buyer gets one that never overpays. They negotiate in the open, then settle through PayPal.',
  'hero.trust': 'Sealed limits. Proof of Fair Deal. Real sandbox settlement.',
  'buy.title': 'What do you want?',
  'buy.what': 'Item',
  'buy.budget': 'Your ceiling',
  'buy.askBefore': 'Ask me before paying',
  'buy.market': 'Going rate nearby',
  'buy.start': 'Let the agents haggle',
  'buy.hint': 'Your ceiling is sealed and never shared with the shop.',
  'theatre.title': 'The Haggle',
  'theatre.buyer': 'Buyer agent',
  'theatre.shop': 'Shop agent',
  'theatre.table': 'The table',
  'theatre.transcript': 'Live transcript',
  'theatre.takeover': 'Take over',
  'theatre.release': 'Let the agent continue',
  'theatre.youNow': 'You’re negotiating',
  'theatre.yourOffer': 'Your offer',
  'theatre.send': 'Send offer',
  'theatre.market': 'Market range',
  'theatre.settling': 'Settling with PayPal…',
  'theatre.dealClosed': 'Deal closed',
  'receipt.title': 'Proof of Fair Deal',
  'receipt.fairness': 'Fairness',
  'receipt.saved': 'Saved vs market',
  'receipt.verified': 'Verified',
  'receipt.buyerLimit': 'Buyer’s sealed ceiling',
  'receipt.shopFloor': 'Shop’s sealed floor',
  'receipt.share': 'Share this receipt',
  'receipt.reveal': 'Reveal the sealed limits',
  'receipt.timeline': 'Audit timeline',
  'shop.title': 'Your stall',
  'shop.products': 'Products',
  'shop.list': 'List price',
  'shop.floor': 'Secret floor',
  'shop.persona': 'Haggle style',
  'shop.floorHint': 'Stored sealed. Agents can never price below it.',
  'ledger.title': 'Merchant ledger',
  'ledger.ask': 'Ask your ledger',
  'ledger.askPlaceholder': 'e.g. deals below list this week',
  'counter.title': 'Counter Mode',
  'counter.scan': 'Scan to haggle in person',
  'counter.invoice': 'Invoice',
};

import { en as copyEn } from './copy/en.ts';
import { hi as copyHi } from './copy/hi.ts';

/** Copy for both locales. Hindi falls back to English only for legacy keys not yet translated. */
export const dict: Record<Locale, Dict> = {
  en: { ...legacyEn, ...copyEn },
  hi: { ...legacyEn, ...copyHi },
};

export function t(locale: Locale, key: string): string {
  return dict[locale][key] ?? dict.en[key] ?? key;
}

/**
 * Apply translations to the static Astro chrome. Elements opt in with
 *   <span data-i18n="hero.title"></span>
 *   <button data-i18n-attr="placeholder:ledger.askPlaceholder"></button>
 * Missing keys fall back to English.
 */
export function applyI18n(root: ParentNode, locale: Locale): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(locale, key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    const spec = el.dataset.i18nAttr;
    if (!spec) return;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(locale, key.trim()));
    }
  });
  const html = root instanceof Document ? root.documentElement : document.documentElement;
  html.lang = locale;
}
