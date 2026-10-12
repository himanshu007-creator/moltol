import { z } from "zod";
import { OfferKindSchema, SideSchema, TacticSchema } from "./common";

/** A single negotiation turn. Append-only in the store. */
export const TurnSchema = z.object({
  seq: z.number().int().nonnegative(),
  actor: SideSchema,
  kind: OfferKindSchema,
  priceCents: z.number().int().nonnegative().optional(),
  message: z.string().max(600),
  tactic: TacticSchema.optional(),
});
export type Turn = z.infer<typeof TurnSchema>;
