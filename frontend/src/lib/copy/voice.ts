/**
 * Everything that is spoken. Each line is built from clips, and every clip is a
 * Cartesia file generated at build time (scripts/gen-voice.ts), so no key ever
 * reaches the browser. Numbers are spoken as separate clips and joined.
 */
export type VoiceLocale = 'en' | 'hi';

/** Full lines. `{amount}` expands to number clips; other words are plain clips. */
export const VOICE_LINES = {
  'money.credited': { en: ['{amount}', 'word.rupees', 'word.credited'], hi: ['{amount}', 'word.rupees', 'word.credited'] },
  'offer.new': { en: ['line.offer.new'], hi: ['line.offer.new'] },
  'deal.closed': { en: ['line.deal.closed'], hi: ['line.deal.closed'] },
  'stall.open': { en: ['line.stall.open'], hi: ['line.stall.open'] },
  'stall.closed': { en: ['line.stall.closed'], hi: ['line.stall.closed'] },
  'setup.name': { en: ['line.setup.name'], hi: ['line.setup.name'] },
  'setup.price': { en: ['line.setup.price'], hi: ['line.setup.price'] },
  'setup.done': { en: ['line.setup.done'], hi: ['line.setup.done'] },
} as const;

/** The spoken text for each clip key that is not a number. */
export const CLIP_TEXT: Record<VoiceLocale, Record<string, string>> = {
  en: {
    'word.rupees': 'rupees',
    'word.credited': 'credited to your account',
    'scale.hundred': 'hundred',
    'scale.thousand': 'thousand',
    'scale.lakh': 'lakh',
    'scale.crore': 'crore',
    'line.offer.new': 'New offer',
    'line.deal.closed': 'Deal done',
    'line.stall.open': 'Your stall is open',
    'line.stall.closed': 'Your stall is closed',
    'line.setup.name': 'Tell us your stall name.',
    'line.setup.price': 'Now tell us the price.',
    'line.setup.done': 'Your stall is ready.',
  },
  hi: {
    'word.rupees': 'रुपये',
    'word.credited': 'आपके खाते में जमा हुए',
    'scale.hundred': 'सौ',
    'scale.thousand': 'हज़ार',
    'scale.lakh': 'लाख',
    'scale.crore': 'करोड़',
    'line.offer.new': 'नया ऑफ़र आया है',
    'line.deal.closed': 'सौदा पक्का',
    'line.stall.open': 'आपकी दुकान खुली है',
    'line.stall.closed': 'आपकी दुकान बंद है',
    'line.setup.name': 'अपनी दुकान का नाम बताइए।',
    'line.setup.price': 'अब दाम बताइए।',
    'line.setup.done': 'आपकी दुकान तैयार है।',
  },
};

/** Hindi 0 to 99 are irregular, so each has its own clip. */
const HI_NUMBERS = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
  'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function enWords(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  const t = Math.floor(n / 10), o = n % 10;
  return EN_TENS[t]! + (o ? '-' + EN_ONES[o] : '');
}

/** Every number clip: n.0 to n.99, in both languages. */
export function numberClipText(locale: VoiceLocale): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i <= 99; i++) out[`n.${i}`] = locale === 'hi' ? HI_NUMBERS[i]! : enWords(i);
  return out;
}

/** Split a rupee amount into Indian-grouping clips: crore, lakh, thousand, hundred, rest. */
export function amountClipKeys(rupees: number): string[] {
  let n = Math.max(0, Math.round(rupees));
  const parts: Array<[number, string]> = [];
  const take = (unit: number, scale?: string) => {
    const q = Math.floor(n / unit);
    n -= q * unit;
    if (q > 0) {
      parts.push([q, '']);
      if (scale) parts.push([0, scale]);
    }
  };
  take(10_000_000, 'scale.crore');
  take(100_000, 'scale.lakh');
  take(1_000, 'scale.thousand');
  take(100, 'scale.hundred');
  if (n > 0) parts.push([n, '']);
  const keys: string[] = [];
  for (const [count, scale] of parts) keys.push(scale ? scale : `n.${count}`);
  return keys;
}

/** The ordered clip keys for a whole line, with `{amount}` expanded. */
export function clipPlan(lineKey: keyof typeof VOICE_LINES, locale: VoiceLocale, vars: Record<string, number> = {}): string[] {
  const out: string[] = [];
  for (const item of VOICE_LINES[lineKey][locale]) {
    if (item === '{amount}') out.push(...amountClipKeys(vars.amount ?? 0));
    else out.push(item);
  }
  return out;
}

/** Every clip key that must exist as a file, per locale. */
export function allClipKeys(locale: VoiceLocale): Record<string, string> {
  return { ...numberClipText(locale), ...CLIP_TEXT[locale] };
}
