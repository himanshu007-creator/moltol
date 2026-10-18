import type { SnapResponse, SnapSuggestion } from "@moltol/contracts";
import type { LlmConfig } from "./provider";

/**
 * Snap-to-add vision: identify the products in a vendor's photo and return a
 * short, editable list. Uses an OpenAI-compatible vision model when configured;
 * otherwise it falls back to a small built-in catalogue matched on the vendor's
 * text hint. Either way the vendor confirms and prices the items themselves.
 */

interface CatalogueEntry {
  name: string;
  emoji: string;
  unit: string;
  sellCents: number;
  floorCents: number;
  /** Extra words that should match this entry. */
  aliases: string[];
}

/** A handful of everyday Indian-market staples, priced in paise (INR minor units). */
const CATALOGUE: CatalogueEntry[] = [
  {
    name: "Tomatoes",
    emoji: "🍅",
    unit: "kg",
    sellCents: 4000,
    floorCents: 3000,
    aliases: ["tomato", "tamatar"],
  },
  {
    name: "Onions",
    emoji: "🧅",
    unit: "kg",
    sellCents: 3500,
    floorCents: 2500,
    aliases: ["onion", "pyaz", "kanda"],
  },
  {
    name: "Potatoes",
    emoji: "🥔",
    unit: "kg",
    sellCents: 3000,
    floorCents: 2200,
    aliases: ["potato", "aloo", "batata"],
  },
  {
    name: "Green Chillies",
    emoji: "🌶️",
    unit: "250g",
    sellCents: 1500,
    floorCents: 1000,
    aliases: ["chilli", "chili", "mirchi", "chilli"],
  },
  {
    name: "Coriander",
    emoji: "🌿",
    unit: "bunch",
    sellCents: 1000,
    floorCents: 700,
    aliases: ["cilantro", "dhania", "kothmir"],
  },
  {
    name: "Spinach",
    emoji: "🥬",
    unit: "bunch",
    sellCents: 2000,
    floorCents: 1500,
    aliases: ["palak", "greens"],
  },
  {
    name: "Bananas",
    emoji: "🍌",
    unit: "dozen",
    sellCents: 6000,
    floorCents: 4500,
    aliases: ["banana", "kela"],
  },
  {
    name: "Lemons",
    emoji: "🍋",
    unit: "4 pcs",
    sellCents: 2000,
    floorCents: 1500,
    aliases: ["lemon", "nimbu", "lime"],
  },
  {
    name: "Ginger",
    emoji: "🫚",
    unit: "100g",
    sellCents: 2500,
    floorCents: 1800,
    aliases: ["adrak", "ginger"],
  },
  {
    name: "Garlic",
    emoji: "🧄",
    unit: "100g",
    sellCents: 2000,
    floorCents: 1500,
    aliases: ["lehsun", "garlic"],
  },
  {
    name: "Milk",
    emoji: "🥛",
    unit: "litre",
    sellCents: 6500,
    floorCents: 6000,
    aliases: ["doodh", "milk"],
  },
  {
    name: "Curd",
    emoji: "🥣",
    unit: "500g",
    sellCents: 4000,
    floorCents: 3200,
    aliases: ["yogurt", "dahi", "yoghurt"],
  },
  {
    name: "Rice",
    emoji: "🍚",
    unit: "kg",
    sellCents: 8000,
    floorCents: 6500,
    aliases: ["chawal", "basmati", "rice"],
  },
  {
    name: "Wheat Flour",
    emoji: "🌾",
    unit: "kg",
    sellCents: 5500,
    floorCents: 4500,
    aliases: ["atta", "flour", "maida"],
  },
  {
    name: "Eggs",
    emoji: "🥚",
    unit: "6 pcs",
    sellCents: 5000,
    floorCents: 4000,
    aliases: ["anda", "egg"],
  },
  {
    name: "Coconut",
    emoji: "🥥",
    unit: "1 pc",
    sellCents: 5000,
    floorCents: 4000,
    aliases: ["nariyal", "coconut"],
  },
  {
    name: "Carrots",
    emoji: "🥕",
    unit: "500g",
    sellCents: 3000,
    floorCents: 2200,
    aliases: ["gajar", "carrot"],
  },
  {
    name: "Brinjal",
    emoji: "🍆",
    unit: "500g",
    sellCents: 3500,
    floorCents: 2500,
    aliases: ["eggplant", "aubergine", "baingan"],
  },
  {
    name: "Cucumber",
    emoji: "🥒",
    unit: "500g",
    sellCents: 2500,
    floorCents: 1800,
    aliases: ["kheera", "cucumber"],
  },
  {
    name: "Cauliflower",
    emoji: "🥦",
    unit: "1 pc",
    sellCents: 4000,
    floorCents: 3000,
    aliases: ["gobi", "cauliflower"],
  },
];

const MAX_SUGGESTIONS = 6;

function catalogueSuggestion(entry: CatalogueEntry, confidence: number): SnapSuggestion {
  return {
    name: entry.name,
    emoji: entry.emoji,
    unit: entry.unit,
    sellCents: entry.sellCents,
    floorCents: entry.floorCents,
    confidence,
  };
}

function entryFor(name: string): CatalogueEntry | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return CATALOGUE.find(
    (e) => e.name.toLowerCase() === needle || e.aliases.some((a) => a === needle),
  );
}

/** Match a text hint against the catalogue (exact, then substring). */
function catalogueFromHint(hint: string | undefined): SnapSuggestion[] {
  if (!hint?.trim()) return [];
  const needle = hint.trim().toLowerCase();
  const words = needle.split(/[\s,]+/).filter(Boolean);
  const scored = CATALOGUE.map((e) => {
    const names = [e.name.toLowerCase(), ...e.aliases];
    let score = 0;
    for (const w of words) {
      for (const n of names) {
        if (n === w) score = Math.max(score, 100);
        else if (n.includes(w) || w.includes(n)) score = Math.max(score, 70);
      }
    }
    return { e, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_SUGGESTIONS).map((s) => catalogueSuggestion(s.e, s.score));
}

const VisionReplySchema = {
  parse(value: unknown): { name: string; emoji?: string; unit?: string; confidence?: number }[] {
    if (typeof value !== "object" || value === null) return [];
    const items = (value as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const out: { name: string; emoji?: string; unit?: string; confidence?: number }[] = [];
    for (const raw of items) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.name !== "string" || !r.name.trim()) continue;
      const entry: { name: string; emoji?: string; unit?: string; confidence?: number } = {
        name: r.name.trim().slice(0, 80),
      };
      if (typeof r.emoji === "string") entry.emoji = r.emoji.slice(0, 8);
      if (typeof r.unit === "string") entry.unit = r.unit.slice(0, 20);
      if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
        entry.confidence = Math.max(0, Math.min(100, Math.round(r.confidence)));
      }
      out.push(entry);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  },
};

export interface SnapProvider {
  detect(imageDataUrl: string, hint?: string): Promise<SnapResponse>;
}

/**
 * Build a snap provider. With a configured LLM it asks a vision model to name the
 * products; without one (or when the model fails) it returns catalogue matches for
 * the hint. Pricing comes from the catalogue when the name matches, else the vendor
 * fills it in.
 */
export function createSnapProvider(config: Partial<LlmConfig> = {}): SnapProvider {
  const configured = Boolean(config.baseUrl && config.apiKey && config.model);

  return {
    async detect(imageDataUrl, hint) {
      const fallback = (): SnapResponse => ({
        source: "catalogue",
        suggestions: catalogueFromHint(hint),
      });
      if (!configured) return fallback();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
      try {
        const res = await fetch(`${config.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You identify grocery products in a photo for a market vendor. " +
                  'Reply with strict JSON: {"items":[{"name":string,"emoji":string,"unit":string,"confidence":0-100}]}. ' +
                  `At most ${MAX_SUGGESTIONS} items, common names only, no prices.`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: hint
                      ? `The vendor says this is: ${hint}. Identify the products.`
                      : "Identify the products in this photo.",
                  },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) return fallback();
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content;
        if (!content) return fallback();
        const items = VisionReplySchema.parse(JSON.parse(content));
        if (items.length === 0) return fallback();
        const suggestions: SnapSuggestion[] = items.map((it) => {
          const known = entryFor(it.name);
          return {
            name: known?.name ?? it.name,
            emoji: it.emoji || known?.emoji || "🛒",
            unit: it.unit || known?.unit || null,
            sellCents: known?.sellCents ?? null,
            floorCents: known?.floorCents ?? null,
            confidence: it.confidence ?? 70,
          };
        });
        return { source: "vision", suggestions };
      } catch {
        return fallback();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
