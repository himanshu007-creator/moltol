import { z } from "zod";
import { PersonaSchema } from "./common";

const LatSchema = z.number().min(-90).max(90);
const LngSchema = z.number().min(-180).max(180);

export const LocationSchema = z.object({ lat: LatSchema, lng: LngSchema });
export type Location = z.infer<typeof LocationSchema>;

/**
 * PATCH /v1/shops/me/location — the vendor's device pushes its moving pin while
 * the stall is open. Deliberately tiny so a 3-second poll stays cheap.
 */
export const UpdateShopLocationSchema = LocationSchema;
export type UpdateShopLocation = z.infer<typeof UpdateShopLocationSchema>;

/**
 * Stall status, the same shape as the frontend's `StallStatus`: epoch-ms timers.
 * `closeAt` is a scheduled close while open; `reopenAt` a scheduled reopen while
 * closed. A timer that has come due is already applied when the API returns it.
 */
export const ShopStatusSchema = z.object({
  open: z.boolean(),
  closeAt: z.number().int().nullable(),
  reopenAt: z.number().int().nullable(),
});
export type ShopStatus = z.infer<typeof ShopStatusSchema>;

export const CreateShopRequestSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().min(1).max(8).default("🏪"),
  persona: PersonaSchema.optional(),
  location: LocationSchema.optional(),
});
export type CreateShopRequest = z.infer<typeof CreateShopRequestSchema>;

/** PATCH /v1/shops/me. `location: null` clears it (the stall drops off the nearby map). */
export const UpdateShopRequestSchema = z
  .object({
    name: z.string().min(1).max(80),
    emoji: z.string().min(1).max(8),
    persona: PersonaSchema,
    location: LocationSchema.nullable(),
  })
  .partial();
export type UpdateShopRequest = z.infer<typeof UpdateShopRequestSchema>;

/** PUT /v1/shops/me/status — mirrors the frontend's setOpen / closeIn / reopenIn. */
export const SetShopStatusRequestSchema = z
  .object({
    open: z.boolean(),
    /** Only while open: close automatically in N minutes. */
    closeInMin: z.number().int().min(1).max(1440).optional(),
    /** Only while closed: reopen automatically in N minutes. */
    reopenInMin: z.number().int().min(1).max(1440).optional(),
  })
  .refine((s) => !(s.closeInMin !== undefined && !s.open), {
    message: "closeInMin only applies to an open stall",
    path: ["closeInMin"],
  })
  .refine((s) => !(s.reopenInMin !== undefined && s.open), {
    message: "reopenInMin only applies to a closed stall",
    path: ["reopenInMin"],
  });
export type SetShopStatusRequest = z.infer<typeof SetShopStatusRequestSchema>;

export const ShopSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  emoji: z.string(),
  persona: PersonaSchema,
  currency: z.string(),
  location: LocationSchema.nullable(),
  status: ShopStatusSchema,
  /** Epoch ms the pin last moved; how fresh a "live" vendor location is. */
  locationUpdatedAt: z.number().int().nullable().optional(),
});
export type Shop = z.infer<typeof ShopSchema>;

export const NearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(50).max(50_000).default(3000),
});
export type NearbyQuery = z.infer<typeof NearbyQuerySchema>;

/** GET /v1/shops/nearby — open stalls by distance first, closed stalls after. */
export const NearbyShopSchema = ShopSchema.extend({
  distanceM: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  /** Epoch ms the pin last moved; how stale a "live" vendor location is. */
  locationUpdatedAt: z.number().int().nullable(),
});
export type NearbyShop = z.infer<typeof NearbyShopSchema>;

/** Live `shop.status` fan-out frame (GET /v1/shops/status/stream). */
export const ShopStatusEventSchema = z.object({
  t: z.literal("shop.status"),
  shopId: z.string().uuid(),
  status: ShopStatusSchema,
});
export type ShopStatusEvent = z.infer<typeof ShopStatusEventSchema>;

/**
 * Quantity is stock in `unit`: fractional (≤ 3 dp) for mass/volume units, whole
 * otherwise — checked against the unit by the API (`isValidStock`).
 */
export const CreateShopItemRequestSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).optional(),
  sellCents: z.number().int().positive(),
  /** 0 is allowed (giveaway pricing); must stay ≤ sellCents — the API enforces that. */
  floorCents: z.number().int().nonnegative(),
  /** What the vendor paid. Seller-only; never included in a buyer response. */
  costCents: z.number().int().nonnegative().optional(),
  category: z.string().max(30).optional(),
  quantity: z.number().min(0).max(1_000_000).optional(),
  /** Low-stock alert threshold in `unit`; 0 (default) disables the hint. */
  lowStockAt: z.number().min(0).max(1_000_000).optional(),
  unit: z.string().max(20).optional(),
  /** Required in spirit when `unit = 'custom'` — the API rejects a custom unit without it. */
  customUnit: z.string().max(20).optional(),
  /** Grams (mass) or millilitres (volume) per unit, for `pack`/`custom`. */
  packSize: z.number().positive().max(1_000_000).optional(),
  hindiName: z.string().max(80).optional(),
});
export type CreateShopItemRequest = z.infer<typeof CreateShopItemRequestSchema>;

export const UpdateShopItemRequestSchema = CreateShopItemRequestSchema.partial().extend({
  /** Soft delete: archived items are hidden from the public store. */
  archived: z.boolean().optional(),
});
export type UpdateShopItemRequest = z.infer<typeof UpdateShopItemRequestSchema>;

/** Owner view — includes `floorCents` and `costCents`. Never sent to a buyer. */
export const ShopItemSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  name: z.string(),
  emoji: z.string().nullable(),
  sellCents: z.number().int(),
  floorCents: z.number().int(),
  costCents: z.number().int().nullable().nullish(),
  category: z.string().nullable().nullish(),
  quantity: z.number().nullable(),
  lowStockAt: z.number().nullable().nullish(),
  archived: z.boolean().nullish(),
  unit: z.string().nullable(),
  customUnit: z.string().nullable().nullish(),
  packSize: z.number().nullable().nullish(),
  hindiName: z.string().nullable(),
});
export type ShopItem = z.infer<typeof ShopItemSchema>;

/** Buyer-facing view — `floorCents`/`costCents` stripped (AGENTS.md: a side's private number never reaches the other side). */
export const PublicShopItemSchema = ShopItemSchema.omit({
  floorCents: true,
  costCents: true,
});
export type PublicShopItem = z.infer<typeof PublicShopItemSchema>;

export function toPublicShopItem(item: ShopItem): PublicShopItem {
  const { floorCents: _floorCents, costCents: _costCents, ...rest } = item;
  return rest;
}

/** One closed (or lost) basket line, as the seller's ledger sees it. */
export const ShopDealSchema = z.object({
  id: z.string().uuid(),
  ts: z.string(),
  itemId: z.string().uuid().nullable(),
  name: z.string(),
  emoji: z.string().nullable(),
  unit: z.string().nullable(),
  qty: z.number(),
  won: z.boolean(),
  /** Agreed per-unit price; null when the line did not close. */
  unitCents: z.number().int().nullable(),
  lineCents: z.number().int().nullable(),
  /** The list price per unit the haggle started from. */
  listCents: z.number().int(),
  currency: z.string(),
});
export type ShopDeal = z.infer<typeof ShopDealSchema>;
