import { z } from "zod";

export const CreateShopRequestSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().min(1).max(8).default("🏪"),
});
export type CreateShopRequest = z.infer<typeof CreateShopRequestSchema>;

export const ShopSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  emoji: z.string(),
});
export type Shop = z.infer<typeof ShopSchema>;

export const CreateShopItemRequestSchema = z.object({
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).optional(),
  sellCents: z.number().int().positive(),
  floorCents: z.number().int().positive(),
  quantity: z.number().int().min(0).optional(),
  unit: z.string().max(20).optional(),
  hindiName: z.string().max(80).optional(),
});
export type CreateShopItemRequest = z.infer<typeof CreateShopItemRequestSchema>;

export const UpdateShopItemRequestSchema = CreateShopItemRequestSchema.partial();
export type UpdateShopItemRequest = z.infer<typeof UpdateShopItemRequestSchema>;

/** Owner view — includes `floorCents`. Never sent to a buyer. */
export const ShopItemSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  name: z.string(),
  emoji: z.string().nullable(),
  sellCents: z.number().int(),
  floorCents: z.number().int(),
  quantity: z.number().int().nullable(),
  unit: z.string().nullable(),
  hindiName: z.string().nullable(),
});
export type ShopItem = z.infer<typeof ShopItemSchema>;

/** Buyer-facing view — `floorCents` stripped (AGENTS.md: a side's private number never reaches the other side). */
export const PublicShopItemSchema = ShopItemSchema.omit({ floorCents: true });
export type PublicShopItem = z.infer<typeof PublicShopItemSchema>;

export function toPublicShopItem(item: ShopItem): PublicShopItem {
  const { floorCents: _floorCents, ...rest } = item;
  return rest;
}
