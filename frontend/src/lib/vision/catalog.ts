/**
 * Vegetable catalogue for the on-device scanner.
 *
 * This is the ONE source of truth for (a) the model's allowed answers, (b) the
 * manual picker, (c) product names in en/hi/pa, and (d) the bundled static
 * images. Each entry's `key` is exactly the token the prompt asks the model to
 * return; each `id` is a Simple Mode `ItemId`, so a recognised vegetable drops
 * straight into the existing product store.
 *
 * Images are original flat SVG illustrations shipped with the app
 * (MIT, same licence as the repo) under /public/vegetables — no third-party or
 * model-generated imagery is used.
 */

import type { ItemId, Locale } from "@/lib/simple/strings";

export interface VegSpec {
  /** token the model is told to answer with, e.g. 'potato' */
  key: string;
  /** Simple Mode catalogue id — the existing product-creation mechanism */
  id: ItemId;
  en: string;
  emoji: string;
  /** bundled static asset (see /public/vegetables) */
  image: string;
}

const V = (key: string, id: ItemId, en: string, emoji: string): VegSpec => ({
  key,
  id,
  en,
  emoji,
  image: `/vegetables/${key}.svg`,
});

export const VEG_CATALOG: VegSpec[] = [
  V("potato", "potato", "Potato", "🥔"),
  V("onion", "onion", "Onion", "🧅"),
  V("tomato", "tomato", "Tomato", "🍅"),
  V("carrot", "carrot", "Carrot", "🥕"),
  V("cauliflower", "cauliflower", "Cauliflower", "🥦"),
  V("cabbage", "cabbage", "Cabbage", "🥬"),
  V("brinjal", "brinjal", "Brinjal", "🍆"),
  V("cucumber", "cucumber", "Cucumber", "🥒"),
  V("capsicum", "capsicum", "Capsicum", "🫑"),
  V("okra", "okra", "Okra (bhindi)", "🫛"),
  V("spinach", "spinach", "Spinach", "🥬"),
  V("garlic", "garlic", "Garlic", "🧄"),
  V("ginger", "ginger", "Ginger", "🫚"),
  V("peas", "peas", "Green peas", "🫛"),
  V("banana", "banana", "Banana", "🍌"),
  V("apple", "apple", "Apple", "🍎"),
  V("orange", "orange", "Orange", "🍊"),
  V("mango", "mango", "Mango", "🥭"),
];

const BY_KEY = new Map(VEG_CATALOG.map((v) => [v.key, v]));
const BY_ID = new Map(VEG_CATALOG.map((v) => [v.id, v]));

export function vegByKey(key: string): VegSpec | undefined {
  return BY_KEY.get(key);
}

export function vegById(id: ItemId): VegSpec | undefined {
  return BY_ID.get(id);
}

export function vegName(v: VegSpec, locale: Locale): string {
  return v.en;
}

/** The list injected into the prompt, kept in sync with the catalogue. */
export function allowedKeys(): string[] {
  return VEG_CATALOG.map((v) => v.key);
}

/**
 * Validate untrusted model output against the catalogue. The prompt asks for
 * `{"name":"potato"}`, but the model may add prose or invent
 * an object — so we pull the first JSON object and reject anything not in the
 * catalogue (including "unknown"). A match is a *suggestion*, never a guarantee.
 */
export function parseVegGuess(text: string): VegSpec | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const name = (parsed as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  const key = name.trim().toLowerCase();
  if (!key || key === "unknown") return null;
  return BY_KEY.get(key) ?? null;
}
