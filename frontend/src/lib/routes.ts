/**
 * The only place app paths are written. Everything else imports ROUTES, so a
 * route move is a one-file change. Landing lives at the root; the product lives
 * under /app.
 */
export const ROUTES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  app: '/app',
  buy: '/app/buy',
  stall: '/app/stall',
  cart: '/app/cart',
  bazaar: '/app/bazaar',
  checkout: '/app/checkout',
  orders: '/app/orders',
  insights: '/app/insights',
  haggle: '/app/haggle',
  receipt: '/app/receipt',
  counter: '/app/counter',
  seller: {
    home: '/app/seller',
    inventory: '/app/seller/inventory',
    ledger: '/app/seller/ledger',
    shop: '/app/seller/shop',
  },
  simple: {
    home: '/app/seller/simple',
    setup: '/app/seller/simple/setup',
    scan: '/app/seller/simple/scan',
    price: '/app/seller/simple/price',
    haggle: '/app/seller/simple/haggle',
    deals: '/app/seller/simple/deals',
    earnings: '/app/seller/simple/earnings',
    settings: '/app/seller/simple/settings',
  },
} as const;

export type SellerMode = 'simple' | 'modern';
export type Role = 'buyer' | 'seller';

/** The page a role lands on after switching, given the seller's mode. */
export function homeFor(role: Role, mode: SellerMode | null): string {
  if (role === 'buyer') return ROUTES.buy;
  return mode === 'modern' ? ROUTES.seller.home : ROUTES.simple.home;
}

export const isAppPath = (p: string) => p === ROUTES.app || p.startsWith(ROUTES.app + '/');
export const isSimplePath = (p: string) => p.replace(/\/$/, '').startsWith(ROUTES.simple.home);

/** Old flat paths from before /app existed, so persisted lastRoute values still resolve. */
export const LEGACY: Record<string, string> = {
  '/buy': ROUTES.buy,
  '/stall': ROUTES.stall,
  '/cart': ROUTES.cart,
  '/bazaar': ROUTES.bazaar,
  '/checkout': ROUTES.checkout,
  '/orders': ROUTES.orders,
  '/insights': ROUTES.insights,
  '/haggle': ROUTES.haggle,
  '/receipt': ROUTES.receipt,
  '/counter': ROUTES.counter,
  '/inventory': ROUTES.seller.inventory,
  '/ledger': ROUTES.seller.ledger,
  '/shop': ROUTES.seller.shop,
  '/simple': ROUTES.simple.home,
  '/simple/setup': ROUTES.simple.setup,
  '/simple/scan': ROUTES.simple.scan,
  '/simple/price': ROUTES.simple.price,
  '/simple/haggle': ROUTES.simple.haggle,
  '/simple/deals': ROUTES.simple.deals,
  '/simple/earnings': ROUTES.simple.earnings,
  '/simple/settings': ROUTES.simple.settings,
};

/** Map any stored path (old or new) to a current route; unknown paths fall back to /app. */
export function migratePath(p: string | undefined | null): string {
  if (!p) return ROUTES.app;
  const clean = p.replace(/\/$/, '') || '/';
  if (LEGACY[clean]) return LEGACY[clean];
  if (isAppPath(clean)) return clean;
  return ROUTES.app;
}
