import type { PersonaId } from './policy';

/**
 * Demo catalog + shops. NOTE: a product's `floorCents` is the shop's SECRET
 * reservation price. It is used only to run the mock engine/commitment and is
 * NEVER rendered before `proof.revealed` (FE_plan §10.2). The UI reads prices
 * through components that only know the public list price.
 */

export interface Shop {
  id: string;
  displayName: string;
  ownerName: string;
  persona: PersonaId;
  location: string;
  paypalAccount: string;
}

export interface Product {
  id: string;
  shopId: string;
  title: string;
  category: string;
  sku: string;
  listPriceCents: number;
  /** secret — shop side only */
  floorCents: number;
  currency: string;
  /** lucide icon name, resolved in the UI */
  icon: string;
}

export const SHOPS: Shop[] = [
  {
    id: 'sharma-hardware',
    displayName: 'Sharma Hardware & Home',
    ownerName: 'Rakesh Sharma',
    persona: 'stoic',
    location: 'Sadar Bazaar, Delhi',
    paypalAccount: 'sharma-hardware@sandbox',
  },
  {
    id: 'kumar-kitchen',
    displayName: 'Kumar Kitchen Store',
    ownerName: 'Meena Kumar',
    persona: 'charmer',
    location: 'Johari Bazaar, Jaipur',
    paypalAccount: 'kumar-kitchen@sandbox',
  },
  {
    id: 'alam-emporium',
    displayName: 'Alam Emporium',
    ownerName: 'Faisal Alam',
    persona: 'storyteller',
    location: 'Chandni Chowk, Delhi',
    paypalAccount: 'alam-emporium@sandbox',
  },
];

export const PRODUCTS: Product[] = [
  {
    id: 'bottle-1l',
    shopId: 'sharma-hardware',
    title: 'Stainless Steel 1L Water Bottle',
    category: 'Home & Kitchen',
    sku: 'SHW-BTL-1L',
    listPriceCents: 2400,
    floorCents: 1250,
    currency: 'INR',
    icon: 'milk',
  },
  {
    id: 'tawa-cast',
    shopId: 'kumar-kitchen',
    title: 'Cast Iron Tawa (10 in)',
    category: 'Cookware',
    sku: 'KMR-TWA-10',
    listPriceCents: 4500,
    floorCents: 2600,
    currency: 'INR',
    icon: 'cooking-pot',
  },
  {
    id: 'cooker-3l',
    shopId: 'kumar-kitchen',
    title: 'Stainless Pressure Cooker 3L',
    category: 'Cookware',
    sku: 'KMR-CKR-3L',
    listPriceCents: 5200,
    floorCents: 3400,
    currency: 'INR',
    icon: 'soup',
  },
  {
    id: 'diya-brass',
    shopId: 'alam-emporium',
    title: 'Brass Diya Set (12)',
    category: 'Festive',
    sku: 'ALM-DYA-12',
    listPriceCents: 3600,
    floorCents: 1800,
    currency: 'INR',
    icon: 'flame',
  },
  {
    id: 'kurta-cotton',
    shopId: 'alam-emporium',
    title: 'Handloom Cotton Kurta',
    category: 'Apparel',
    sku: 'ALM-KRT-01',
    listPriceCents: 2800,
    floorCents: 1300,
    currency: 'INR',
    icon: 'shirt',
  },
  {
    id: 'masala-dabba',
    shopId: 'kumar-kitchen',
    title: 'Masala Dabba Spice Box',
    category: 'Home & Kitchen',
    sku: 'KMR-SPC-07',
    listPriceCents: 1900,
    floorCents: 900,
    currency: 'INR',
    icon: 'utensils',
  },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getShop(id: string): Shop | undefined {
  return SHOPS.find((s) => s.id === id);
}

export function productsByShop(shopId: string): Product[] {
  return PRODUCTS.filter((p) => p.shopId === shopId);
}

/** The single demo product used by the video / default flows. */
export const DEMO_PRODUCT_ID = 'bottle-1l';
