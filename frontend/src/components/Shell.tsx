import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { navigate } from 'astro:transitions/client';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, ShoppingBasket, PackageCheck, Sparkles, Store, PackageOpen, Handshake, LineChart, Settings, LogOut, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { startVenueClock, startShopStatusStream, useVenue } from '@/stores/venue';
import { startMoneyEvents } from '@/lib/moneyEvents';
import VendorStatusToggle from '@/components/react/VendorStatusToggle';
import MoneySplash from '@/components/react/MoneySplash';
import { useSession, type Role } from '@/stores/session';
import { logout as backendLogout, setRole as backendSetRole, getMe, getMyShop } from '@/lib/backend';
import { ROUTES } from '@/lib/routes';
import { useUi } from '@/stores/ui';
import { useBazaar } from '@/stores/bazaar';
import { useCart, useCartLineCount } from '@/stores/cart';
import { useOrders } from '@/stores/orders';
import { useSimple, shopItemToSimpleProduct } from '@/stores/simple';
import { useInventory } from '@/stores/inventory';
import { useBuyer } from '@/stores/buyer';
import { usePrefs, useI18n } from '@/stores/prefs';
import { LOCALES } from '@/lib/i18n';

/**
 * One view at a time. The account menu (avatar) switches between buyer and seller
 * and sets the seller's dashboard (Simple or Modern). The bottom nav is the only
 * navigation, and it follows the current role and mode.
 */
const NAV_BUYER: Array<{ to: string; icon: LucideIcon; label: string; badge?: () => number }> = [
  { to: ROUTES.buy, icon: MapPin, label: 'Nearby' },
  { to: ROUTES.cart, icon: ShoppingBasket, label: 'Basket', badge: () => useCart.getState().lineCount() },
  { to: ROUTES.orders, icon: PackageCheck, label: 'Orders', badge: () => useOrders.getState().orders.length },
  { to: ROUTES.insights, icon: Sparkles, label: 'Insights' },
];

const NAV_SELLER_SIMPLE: Array<{ to: string; icon: LucideIcon; label: string; badge?: () => number }> = [
  { to: ROUTES.simple.home, icon: Store, label: 'Home' },
  { to: ROUTES.simple.deals, icon: Handshake, label: 'Deals', badge: () => (useBazaar.getState().begun ? 1 : 0) },
  { to: ROUTES.simple.earnings, icon: LineChart, label: 'Earnings' },
  { to: ROUTES.simple.settings, icon: Settings, label: 'Settings' },
];

const NAV_SELLER_MODERN: Array<{ to: string; icon: LucideIcon; label: string; badge?: () => number }> = [
  { to: ROUTES.seller.inventory, icon: PackageOpen, label: 'Stock' },
  { to: ROUTES.seller.ledger, icon: LineChart, label: 'Ledger' },
  { to: ROUTES.seller.shop, icon: Store, label: 'Shop' },
  { to: ROUTES.simple.deals, icon: Handshake, label: 'Deals', badge: () => (useBazaar.getState().begun ? 1 : 0) },
];

const isActive = (path: string, to: string) => path.replace(/\/$/, '') === to;

export default function Shell() {
  const { activeRole, loggedIn, name, setRole, sellerProfileDone, markProfile, sellerMode, setSellerMode, logout, pendingNote, setPending } = useSession();
  const cartCount = useCartLineCount();
  const liveDeal = useBazaar((s) => s.begun);
  const { toasts, dismiss } = useUi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fade, setFade] = useState<'in' | 'out'>('in');
  const [path, setPath] = useState(() => (typeof location === 'undefined' ? '/' : location.pathname));
  const menuRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();
  const setLocale = usePrefs((st) => st.setLocale);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById('account-slot'));
    startVenueClock();
    startShopStatusStream();
    startMoneyEvents();
    const onPage = () => setPath(location.pathname);
    document.addEventListener('astro:page-load', onPage);
    return () => document.removeEventListener('astro:page-load', onPage);
  }, []);

  // Hydrate from the backend's own view once per load (covers logging in on a
  // new device, where local state has never seen this account before).
  // Additive only — never forces a navigation or overrides a local choice.
  useEffect(() => {
    const token = useSession.getState().token;
    if (!token) return;
    void getMe(token)
      .then((me) => {
        if (me.hasShop) markProfile('seller');
        if (me.hagglePreset !== useBuyer.getState().personality) {
          useBuyer.setState({ personality: me.hagglePreset });
        }
        if (!me.shop) return;
        useSession.setState({ shopId: me.shop.id });
        // Hydrate this device's local caches from the real shop — covers
        // logging in on a new device, where Simple Mode/the Modern console
        // have never seen this account's products before.
        void getMyShop(token)
          .then((shop) => {
            useSimple.setState({
              onboarded: true,
              stallName: shop.name,
              stallEmoji: shop.emoji,
              products: shop.items.map(shopItemToSimpleProduct),
            });
          })
          .catch(() => {});
        void useInventory.getState().fetch(token);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    setFade('out');
    const t = setTimeout(() => setFade('in'), 180);
    return () => clearTimeout(t);
  }, [activeRole]);

  useEffect(() => {
    if (loggedIn) document.documentElement.dataset.auth = '1';
    else delete document.documentElement.dataset.auth;
  }, [loggedIn]);

  if (!loggedIn) return null;

  const nav =
    activeRole === 'buyer' ? NAV_BUYER : sellerMode === 'modern' ? NAV_SELLER_MODERN : NAV_SELLER_SIMPLE;

  // Switch roles from the account menu: instant, client-side, state preserved.
  function switchRole(role: Role) {
    if (role === activeRole) return;
    setMenuOpen(false);
    // View preference only — never changes what the token may do server-side.
    const token = useSession.getState().token;
    if (token) void backendSetRole(token, role).catch(() => {});
    if (role === 'buyer') {
      setRole('buyer', ROUTES.buy);
      void navigate(ROUTES.buy);
      return;
    }
    if (!sellerProfileDone) {
      markProfile('seller');
      setRole('seller', ROUTES.simple.setup);
      void navigate(ROUTES.simple.setup);
      return;
    }
    if (!sellerMode) {
      setRole('seller', ROUTES.seller.home);
      void navigate(ROUTES.seller.home);
      return;
    }
    const dest = sellerMode === 'modern' ? ROUTES.seller.inventory : ROUTES.simple.home;
    setRole('seller', dest);
    void navigate(dest);
  }

  function chooseMode(mode: 'simple' | 'modern') {
    setSellerMode(mode);
    setMenuOpen(false);
    const dest = mode === 'modern' ? ROUTES.seller.inventory : ROUTES.simple.home;
    setRole('seller', dest);
    void navigate(dest);
  }

  const account = (
    <div ref={menuRef} className={cn('relative', slot ? '' : 'fixed right-4 top-3 z-40')}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="grid h-11 w-11 place-items-center rounded-full bg-paper-2 text-xl shadow-sm ring-1 ring-chalk transition active:scale-95"
        aria-label={t('menu.account')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {name ? '🙍🏽‍♀️' : '👤'}
      </button>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="surface absolute right-0 top-full z-50 mt-2 w-72 p-3 text-left shadow-xl"
          >
            <p className="truncate px-3 pb-1 pt-2 text-base font-semibold text-ink">{name}</p>
            <p className="px-3 pb-2 text-sm text-ink-muted">{activeRole === 'buyer' ? t('menu.signedBuyer') : t('menu.signedSeller')}</p>

            <button
              type="button"
              role="menuitem"
              onClick={() => switchRole(activeRole === 'buyer' ? 'seller' : 'buyer')}
              className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-3 text-base font-semibold text-ink hover:bg-paper-3"
            >
              <span>{activeRole === 'buyer' ? `🏪 ${t('menu.switchSeller')}` : `🛒 ${t('menu.switchBuyer')}`}</span>
              {activeRole === 'buyer' && liveDeal && <span className="pill pill-chili">Live</span>}
            </button>

            {activeRole === 'seller' && (
              <div className="mt-1 grid gap-1 border-t border-chalk pb-1 pt-2" role="group" aria-label="Seller dashboard">
                <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('menu.dashboard')}</p>
                {(['simple', 'modern'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sellerMode === m}
                    onClick={() => chooseMode(m)}
                    className={cn(
                      'flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-base font-semibold text-ink hover:bg-paper-3',
                      sellerMode === m && 'bg-marigold/25',
                    )}
                  >
                    <span>{m === 'simple' ? t('menu.simple') : t('menu.modern')}</span>
                    {sellerMode === m && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-1 grid gap-1 border-t border-chalk pt-2" role="group" aria-label={t('menu.language')}>
              <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('menu.language')}</p>
              <div className="flex gap-2 px-2 pb-1">
                {LOCALES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={locale === l.id}
                    onClick={() => setLocale(l.id)}
                    className={cn(
                      'min-h-11 flex-1 rounded-2xl border text-base font-semibold text-ink transition',
                      locale === l.id ? 'border-ink bg-marigold' : 'border-chalk-strong bg-paper-2',
                    )}
                  >
                    {l.native}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Full local reset — every store back to its seeded state — then
                // out of the app. Only a real login/signup gets back in; logout()
                // itself sets everLoggedOut so the first-visit auto-login never
                // re-fires (see stores/session.ts).
                useCart.getState().clear();
                useBazaar.getState().reset();
                useOrders.getState().reset();
                useSimple.getState().reset();
                useVenue.getState().reset();
                useInventory.getState().reset();
                useBuyer.getState().reset();
                // Fire-and-forget: revoke the backend session, but don't make
                // the person wait on the network to leave the app.
                const token = useSession.getState().token;
                if (token) void backendLogout(token).catch(() => {});
                logout();
                void navigate('/login');
              }}
              className="mt-1 flex min-h-12 w-full items-center gap-2 rounded-2xl border-t border-chalk px-3 pt-1 text-base font-semibold text-chili hover:bg-paper-3"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> {t('menu.logout')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className={fade === 'out' ? 'opacity-0' : 'opacity-100 transition-opacity duration-200'}>
      <MoneySplash />
      {slot ? createPortal(account, slot) : account}

      {activeRole === 'seller' && !path.startsWith('/app/seller/simple') && path.replace(/\/$/, '') !== ROUTES.seller.shop && (
        <div className="mx-auto max-w-md px-4 pb-1 pt-3 sm:max-w-6xl sm:px-8">
          <VendorStatusToggle compact />
        </div>
      )}

      {pendingNote && (
        <div role="status" className="mx-auto mt-3 flex max-w-md items-center gap-2 rounded-2xl border border-marigold/50 bg-marigold/15 px-4 py-2.5">
          <p className="flex-1 text-sm font-medium text-ink">{pendingNote}</p>
          <button type="button" aria-label="Dismiss" onClick={() => setPending(null)} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-chalk/70 bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[min(92vw,40rem)] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:shadow-2xl"
      >
        <div className="mx-auto flex max-w-md items-stretch px-1 sm:max-w-none sm:px-3">
          {nav.map((item) => {
            const active = isActive(path, item.to);
            const badge = item.badge?.() ?? 0;
            return (
              <a
                key={item.to}
                href={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-wide transition-colors',
                  active ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                <span className="relative flex h-8 w-16 items-center justify-center rounded-full">
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full bg-marigold/40"
                      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    />
                  )}
                  <item.icon className="relative h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} aria-hidden="true" />
                </span>
                {item.label}
                {badge > 0 && (
                  <span className="absolute right-[22%] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-chili px-1 text-[10px] font-bold text-paper">
                    {badge}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </nav>

      <span className="sr-only" aria-live="polite">{activeRole === 'buyer' && cartCount > 0 ? `${cartCount} items in your basket` : ''}</span>

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-xl"
            >
              <span className="flex-1">{t.text}</span>
              {t.undo && (
                <button
                  type="button"
                  onClick={() => {
                    t.undo?.();
                    dismiss(t.id);
                  }}
                  className="min-h-10 px-2 font-semibold text-marigold"
                >
                  Undo
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
