import { z } from "zod";

/**
 * Snap-to-add: the vendor photographs a product and gets back a short list of
 * suggested items to add. The image travels inline as a data URL (no hosting),
 * so this works without a public bucket or signed upload URL.
 */

const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB decoded (base64 is ~4/3 of bytes)

export const SnapRequestSchema = z.object({
  /** `data:image/jpeg;base64,...` — the vendor's photo, inline. */
  image: z
    .string()
    .min(32)
    .max(MAX_IMAGE_CHARS)
    .refine((s) => /^data:image\/(png|jpe?g|webp);base64,/.test(s), {
      message: "image must be a PNG/JPEG/WebP data URL",
    }),
  /** An optional plain-text hint ("tomatoes") the vendor typed alongside the photo. */
  hint: z.string().max(80).optional(),
});
export type SnapRequest = z.infer<typeof SnapRequestSchema>;

export const SnapSuggestionSchema = z.object({
  name: z.string(),
  emoji: z.string(),
  unit: z.string().nullable(),
  /** The vendor edits this; it is only a starting point. */
  sellCents: z.number().int().nonnegative().nullable(),
  floorCents: z.number().int().nonnegative().nullable(),
  /** 0–100. A catalogue match is 100 (exact), a vision guess is the model's own. */
  confidence: z.number().int().min(0).max(100),
});
export type SnapSuggestion = z.infer<typeof SnapSuggestionSchema>;

export const SnapResponseSchema = z.object({
  /** Which path produced the suggestions — always honest about it. */
  source: z.enum(["vision", "catalogue"]),
  suggestions: z.array(SnapSuggestionSchema),
});
export type SnapResponse = z.infer<typeof SnapResponseSchema>;
