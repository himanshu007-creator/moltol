# MolTol — Frontend Implementation Guide

*Astro + React islands · mobile-first · fixture-driven (no backend needed yet)*

## 1. Stack

| Concern | Choice |
| --- | --- |
| Framework | **Astro 5** (`output: 'static'`) + `@astrojs/react` |
| Styling | Tailwind v4 (`@tailwindcss/vite`), tokens as CSS variables, shadcn/Radix for dialogs/forms |
| State | **Zustand** (module-level, shared across islands) + TanStack Query (later) |
| Motion | `motion` only (one lib). **D3 = math only** (`d3-scale`, `d3-shape`); React renders SVG |
| 3D | React Three Fiber + drei + postprocessing, max 2 scenes |
| Ledger | AG Grid Studio (client-only island) |
| Data (now) | MSW + fake WS emitting a JSON event fixture |
| i18n | Astro i18n routing: `en`, `hi`, `pa` |
| Nav | Astro `<ClientRouter />` (view transitions) |

Scaffold: `pnpm create astro@latest`, then `astro add react tailwind`. Add `viewport-fit=cover` in the layout `<meta viewport>`.

## 2. Structure

```
src/
  layouts/Base.astro        # fonts, tokens, ClientRouter, theme script
  pages/                    # index, buy, haggle, receipt, shop, ledger, counter
  components/               # .astro = static shell, .tsx = islands
    theatre/ (Stall, OfferTable, OfferToken, HaggleChart, Transcript, TakeoverBar, HandshakeScene)
  stores/negotiation.ts     # reducer + zustand
  lib/ (events.ts, money.ts, ws.ts, replay.ts)
  fixtures/haggle-01.json   # full event stream incl. reveal
  styles/tokens.css
```

## 3. Screens (8)

1. **Landing**: r3f lantern hero (`client:visible`), CTAs "Start haggling" / "Open your stall".
2. **Buy (Ask + Mandate)**: item, budget cap, "ask before paying" toggle, market range badge.
3. **Haggle Theatre (hero)**: two stalls, offer table, D3 chart, transcript, Take-over bar.
4. **Deal card + PayPal checkout**: agreed price, "saved vs market" badge, PayPal button.
5. **Receipt + Proof of Fair Deal**: hash-verify animation, fairness meter, audit timeline, share link.
6. **Shop setup**: products, list price, floor, persona picker.
7. **Ledger**: AG Studio widgets + "Ask your ledger" chat.
8. **Counter Mode**: QR display + mobile haggle view.

## 4. Design tokens

| Token | Light | Dark |
| --- | --- | --- |
| `--paper` | `#FBF3E4` | `#14162B` |
| `--ink` | `#1B1F3B` | `#F4E9D2` |
| `--marigold` (buyer) | `#F2A900` | `#FFC233` |
| `--chili` (shop) | `#D7263D` | `#FF5A6E` |
| `--teal` (success) | `#0E7C7B` | `#2BC4C2` |
| `--indigo` | `#2B3A8C` | `#8FA0FF` |
| `--chalk` | `#E9DFC9` | `#2A2D4D` |

**Fonts** (Google Fonts, `font-display: swap`, real fallback stacks): Fraunces (display), Instrument Sans (UI), JetBrains Mono (prices, `tabular-nums`), Noto Serif Devanagari (मोल-तोल; subset to used glyphs). Scale ×1.25. Background: faint SVG rangoli pattern, low contrast.

## 5. Data contract (mock now, real later)

Events (discriminated union): `session.started`, `commit.recorded`, `turn`, `deal.agreed`, `payment.status`, `proof.revealed`, `session.ended`. Money is **integer cents**, formatted via `Intl.NumberFormat`.

- `negotiation.ts` is a **pure reducer**: `(state, event) => state`.
- Fixture player pushes events with timers → same code path as real WS. Swapping to the backend is one env flag (`PUBLIC_USE_FIXTURE`).
- The same reducer powers **Replay mode** (label it "Replay") and tests.

## 6. Theatre details

- **Offer token** = a price-tag object sliding between stalls (spring physics, not linear).
- **Chart**: x = round 0..T (T=8), y = price. Two step lines (`curveStepAfter`), market band p25–p75 as a faint strip. **ZOPA band animates in only after `proof.revealed`**; final price pin drops into it. Use `motion` for transitions, not `d3-transition`.
- **Transcript**: `aria-live="polite"`, one entry per turn, announced as "Shop offers 450 dollars".
- **Take over**: one tap, input guarded client-side for numeric only (server validates for real later).
- **Handshake** (r3f): two emissive orbs, particle stream on a Catmull-Rom curve, bloom, 2.5 s, then crossfade to receipt. It is the **only big motion moment**; keep everything else quiet.
- Reduced motion: skip to a static teal "Deal closed" state.

## 7. Astro quirks and gotchas

- **Islands are isolated.** React Context does not cross islands. Use module-level Zustand (or nanostores) so the Theatre, header and receipt share state.
- **Directives**: r3f and AG Studio use `client:only="react"` (they break in SSR; window/WebGL). Theatre uses `client:load`. Below-fold things use `client:visible`.
- **Static output has no runtime dynamic routes.** `/haggle/:id` won't work. Use `/haggle?id=…` and read it on the client (or switch to an adapter later).
- **View transitions re-mount islands.** Put `transition:persist` on the theatre and WS client island, or you will drop the socket mid-haggle. Re-run scripts on `astro:page-load`, not `DOMContentLoaded`.
- **Theme flash**: inline a blocking script in `<head>` that sets `data-theme` before paint.
- **PayPal JS SDK v6**: load on the client only, after a user gesture or in a `client:only` island. Don't copy v5 snippets.
- **Env vars**: only `PUBLIC_*` reach the browser. No secrets in FE.
- **Lazy-load** r3f and AG chunks. Budget: initial JS < 200 KB gz, LCP < 2.5 s on mid-range mobile.

## 8. Mobile responsive UX

- Design at **375 px first**, then scale up. Theatre on mobile: stalls stacked at top (buyer left, shop right, compact), table in the middle, chart collapsed into a bottom sheet, transcript below, **sticky bottom Take-over bar**.
- Use `100dvh` (not `100vh`); iOS Safari's URL bar breaks vh. Pad for notches with `env(safe-area-inset-*)`.
- Touch targets ≥ 44 px. Inputs ≥ 16 px font (prevents iOS zoom-on-focus). Numeric fields: `inputmode="decimal"`.
- Cap r3f DPR at 2, particles ≤ 2–3k on mobile, and fall back to 2D if WebGL fails. iOS Safari limits WebGL contexts, so **mount one canvas at a time and dispose on unmount**.
- Keyboard open shrinks the viewport: keep the Take-over input above it (`visualViewport` listener).
- Counter Mode is phone-first; QR scan lands on `/counter?invoice=…`.
- PWA manifest and theme-color for "add to home screen".

## 9. Accessibility

Semantic landmarks, visible focus rings, full keyboard use, colour is never the only signal (icons and labels on buyer/shop), contrast ≥ 4.5:1, `prefers-reduced-motion` fallback for every animation, `lang` attribute switched per locale (`hi`, `pa`) and proper font fallback for Devanagari/Gurmukhi (add Noto Sans Gurmukhi).

## 10. Aha moments

1. **Reducer + fixture = everything**: dev without backend, Replay demo insurance, tests and storybook-style states from one source.
2. **Never render limits before reveal.** Even debug UI. Chart shows only offers until `proof.revealed`; the reveal is the payoff.
3. **Tag tactics in the UI** (`anchor`, `market-cite`, `final-offer`) as small chips; it makes the AI feel legible.
4. **Prices tick, not jump**: mono font + tabular-nums + a short spring on value change.
5. **Hash-verify animation** (hex scrambling into a green check) sells the trust layer in 1 second of video.
6. **One quiet screen, one loud moment**: judges remember the Handshake.

## 11. Build order

1. Scaffold, tokens, fonts, layout shell, theme toggle.
2. Reducer + fixture player + Transcript.
3. Offer table + tokens + D3 chart.
4. Buy flow, then Deal card (PayPal button mocked).
5. Receipt + Proof animation.
6. Shop setup, then Ledger shell (start AG trial \~Oct 20).
7. r3f Handshake and landing hero.
8. Counter Mode, i18n strings, reduced-motion and axe pass, Lighthouse.

## 12. Definition of done (per screen)

Works at 375 px and desktop · keyboard + screen-reader pass · reduced-motion variant · empty, loading and error states · no console logs · runs from fixture with `pnpm dev`.
