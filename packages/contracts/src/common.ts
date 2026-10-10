import { z } from "zod";

export const SideSchema = z.enum(["buyer", "shop"]);
export type Side = z.infer<typeof SideSchema>;

/** Who may see an event. "all" is safe for the wire; sealed limits never are. */
export const AudienceSchema = z.enum(["all", "buyer", "shop", "platform"]);
export type Audience = z.infer<typeof AudienceSchema>;

export const PersonaSchema = z.enum(["charmer", "stoic", "storyteller", "analyst"]);
export type Persona = z.infer<typeof PersonaSchema>;

export const OfferKindSchema = z.enum(["offer", "counter", "accept", "walkaway"]);
export type OfferKind = z.infer<typeof OfferKindSchema>;

export const TacticSchema = z.enum([
  "anchor",
  "bundle",
  "free-delivery",
  "walk-away-bluff",
  "loyalty",
  "market-cite",
  "final-offer",
  "plain",
]);
export type Tactic = z.infer<typeof TacticSchema>;
