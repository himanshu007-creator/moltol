/**
 * Simple Mode strings — UI copy + per-screen voice lines (English only).
 * Voice lines are what the stall-owner hears; every screen also shows the same
 * line as a caption so nothing is ever audio-only (see lib/voice.ts).
 */

export type Locale = 'en';

export type ItemId =
  | 'tomato'
  | 'onion'
  | 'potato'
  | 'coriander'
  | 'lemon'
  | 'chilli'
  | 'spinach'
  | 'carrot'
  | 'cauliflower'
  | 'cabbage'
  | 'brinjal'
  | 'cucumber'
  | 'capsicum'
  | 'okra'
  | 'garlic'
  | 'ginger'
  | 'peas'
  | 'banana'
  | 'apple'
  | 'orange'
  | 'mango'
  | 'cust';

export interface SimpleItem {
  id: ItemId;
  emoji: string;
  en: string;
}

export const SIMPLE_ITEMS: SimpleItem[] = [
  { id: 'tomato', emoji: '🍅', en: 'Tomatoes' },
  { id: 'onion', emoji: '🧅', en: 'Onions' },
  { id: 'potato', emoji: '🥔', en: 'Potatoes' },
  { id: 'coriander', emoji: '🌿', en: 'Coriander' },
  { id: 'lemon', emoji: '🍋', en: 'Lemons' },
  { id: 'chilli', emoji: '🌶️', en: 'Green chillies' },
  { id: 'spinach', emoji: '🥬', en: 'Spinach' },
  { id: 'carrot', emoji: '🥕', en: 'Carrots' },
  { id: 'cauliflower', emoji: '🥦', en: 'Cauliflower' },
  { id: 'cabbage', emoji: '🥬', en: 'Cabbage' },
  { id: 'brinjal', emoji: '🍆', en: 'Brinjal' },
  { id: 'cucumber', emoji: '🥒', en: 'Cucumber' },
  { id: 'capsicum', emoji: '🫑', en: 'Capsicum' },
  { id: 'okra', emoji: '🫛', en: 'Okra (bhindi)' },
  { id: 'garlic', emoji: '🧄', en: 'Garlic' },
  { id: 'ginger', emoji: '🫚', en: 'Ginger' },
  { id: 'peas', emoji: '🫛', en: 'Green peas' },
  { id: 'banana', emoji: '🍌', en: 'Bananas' },
  { id: 'apple', emoji: '🍎', en: 'Apples' },
  { id: 'orange', emoji: '🍊', en: 'Oranges' },
  { id: 'mango', emoji: '🥭', en: 'Mangoes' },
  { id: 'cust', emoji: '📷', en: 'My own item' },
];

export interface SimpleStrings {
  u: Record<string, string>;
  v: Record<string, string>;
}

const en: SimpleStrings = {
  u: {
    next: 'Next',
    skip: 'Skip',
    back: 'Back',
    undo: 'Undo',
    yes: 'Yes',
    no: 'No',
    again: 'Try again',
    done: 'Done',
    ok: 'Okay',
    listen: 'Speak',
    mic: 'Mic',
    home: 'Home',
    setup: 'Your stall, in 5 easy steps',
    langTitle: 'Apni bhasha chuno — which language?',
    phoneTitle: 'Your phone number',
    otpTitle: 'Code on your phone',
    otpHint: 'We just sent a 6-digit code (dev: it is 123456)',
    stallTitle: 'Name of your stall',
    stallPlaceholder: 'e.g. Meena ki kirana',
    photoHint: 'Take a photo or add a picture (optional)',
    productTitle: 'What do you sell?',
    productHint: 'Tap as many as you like',
    priceTitle: 'How much do you sell it for?',
    floorTitle: 'Lowest price you will ever take',
    floorHint: 'The red line below. Your agent can never go under it.',
    floorBlock: 'The lowest price must be below your selling price.',
    personaTitle: 'Your haggle style',
    personaHint: 'Tap to hear a sample',
    doneTitle: 'Dukaan taiyaar!',
    doneSub: 'Your shop is ready to haggle.',
    start: 'Start',
    homeToday: 'Aaj ka daam',
    homeDeals: 'Sauda chal raha hai',
    homeEarnings: 'Kamai',
    homeNew: 'NEW',
    priceUpdated: 'Prices updated',
    save: 'Save',
    priceDefault: 'Use today’s market price',
    haggleTitle: 'Live deal',
    haggleOffer: 'is offering',
    haggleAccept: 'Accept',
    haggleRefuse: 'Refuse',
    haggleCounter: 'Counter',
    dealAmount: 'Great! You got',
    dealNo: 'You said no. Waiting for the next customer…',
    haggleWaiting: 'Waiting for the next customer…',
    sim: 'Simulate customer offer (testing only)',
    earningsToday: 'Today’s earnings',
    earningsWeek: 'Last 7 days',
    settingsTitle: 'Settings',
    sound: 'Voice instructions',
    soundOn: 'On',
    soundOff: 'Off',
    modernMode: 'Switch to Modern dashboard',
    modernModeHint: 'Charts, ledger, stock screens. You can switch back any time from the account menu.',
    lang: 'Language',
    restartSetup: 'Start on-boarding again',
    phoneHelp: 'Or say your number',
    micTitle: 'One small thing',
    micBody: 'To understand your voice, the app needs the microphone. Only while you tap, never in the background.',
    micAllow: 'Allow mic',
    micDenied: 'Mic is off — tap the numbers instead.',
    confirmTitle: 'Is this right?',
    customName: 'Name your item (your voice)',
    voiceDone: 'Understood',
    resolver: 'Resolver',
    scanTitle: 'Add by scanning',
    scanHint: 'Point the camera at one vegetable and tap Scan.',
    scanStart: 'Scan',
    scanScanning: 'Looking…',
    scanLooks: 'Looks like',
    scanConfirm: 'Yes, correct',
    scanWrong: 'No, choose',
    scanManual: 'Choose manually',
    scanUnsupported: 'This device can’t scan with on-device AI. Add your item by hand below.',
    scanNoCam: 'Camera not available — you can still add by hand.',
    scanPerm: 'Camera permission is needed to scan. You can still add by hand.',
    scanModel: 'Getting the on-device AI ready…',
    scanError: 'The on-device AI had a problem. Add by hand instead.',
    formTitle: 'New product',
    formName: 'Product name',
    formHindi: 'Hindi name',
    formPrice: 'Price (₹)',
    formUnit: 'Unit',
    formQty: 'Stock',
    unitKg: 'kg',
    unit500g: '500 g',
    unitPiece: 'piece',
    unitBunch: 'bunch',
    publish: 'Publish',
    stallStatus: 'Stall status',
    stallOpen: 'Dukaan khuli — buyers can find you',
    stallOpenHint: 'Your stall is live on the bazaar map.',
    stallClosed: 'Dukaan band — hidden from buyers',
    stallClosedHint: 'Buyers won’t see your stall until you open.',
    stallOpenCta: 'Open dukaan',
    stallCloseCta: 'Close dukaan',
    sellerOrders: 'Paid orders',
    sellerOrdersHint: 'Buyers who checked out from your stall',
    sellerNoOrders: 'No paid orders yet — buyers will appear once they pay.',
    sellerOrderPaid: 'paid',
    sellerOrderPlaced: 'placed',
  },
  v: {
    welcome: 'Welcome to MolTol. Setting up your stall in five quick steps.',
    lang: 'Choose your language. Tap the language, and I will repeat it.',
    phone: 'Type your mobile number with the buttons.',
    otp: 'Check your phone for the code, and type it here.',
    stall: 'What should we call your stall? You can skip this.',
    stallAsk: 'Say your stall name, or type it.',
    products: 'Tap every item you sell. Tomato, onion, potato, coriander, lemon, chilli, spinach — or your own item.',
    price: 'How much do you sell this for? Type the amount and check it.',
    floor: 'Now the lowest price you will ever accept. Pull the red line, or type the amount.',
    floorBlock: 'The lowest price has to stay below your selling price. Try again.',
    persona: 'Pick your haggle style. Tap each to hear a sample voice.',
    personaCharmer: 'For a regular customer, I will happily knock something off the price.',
    personaStoic: 'That is the price. The market across the street is higher.',
    personaStoryteller: 'People have bought from me for twenty years. For you, a good price.',
    done: 'Your stall is ready! Your agent will never sell below your red line, and never above your price.',
    today: 'Prices. Tap the picture of an item to change its price.',
    saved: 'Prices saved.',
    haggle: 'A customer is at your stall! Listen to their offer, then accept, refuse, or give your counter.',
    offer: 'The customer is offering',
    acceptLead: 'Say yes, and take the money.',
    accept: 'Deal accepted. Well done.',
    decline: 'Offer refused. The next customer will come soon.',
    counterLead: 'Type your counter price, then send it.',
    dealAmount: 'Great! You got',
    earnings: 'Here is what you made today.',
    sim: 'Testing: a customer offer is being simulated.',
    scanLead: 'Point the camera at one vegetable, then tap scan.',
    scanFound: 'Is this correct? If not, choose the right one.',
    scanPublish: 'Product added. Well done.',
  },
};

export const SIMPLE: Record<Locale, SimpleStrings> = { en };

// English only. Any stored non-English locale from older builds falls back here.
export function s(_locale?: string): SimpleStrings {
  return SIMPLE.en;
}

export function itemName(item: SimpleItem, _locale?: Locale): string {
  return item.en;
}

/* ------------------------------- numbers ------------------------------- */

const EN_LOW = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enWords(n: number): string {
  if (n < 20) return EN_LOW[n] ?? '';
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return EN_TENS[t] + (o ? '-' + enWords(o) : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return enWords(h) + ' hundred' + (r ? ' ' + enWords(r) : '');
  }
  if (n < 1_000_000) {
    const t = Math.floor(n / 1000);
    const r = n % 1000;
    return enWords(t) + ' thousand' + (r ? ' ' + enWords(r) : '');
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  return enWords(m) + ' million' + (r ? ' ' + enWords(r) : '');
}

/** Hindi 0–99, literal and standard. */
export function numToWords(n: number, _locale?: Locale): string {
  return enWords(Math.max(0, Math.floor(n)));
}

/** "₹150" spoken as "150 rupees". */
export function rupayeWords(cents: number, _locale?: Locale): string {
  const rupees = Math.floor(cents / 100);
  const paise = cents % 100;
  return `${numToWords(rupees)} rupees` + (paise ? ` and ${numToWords(paise)} paise` : '');
}

/** Plain digits for the big number screens. */
export function nativeNum(n: number | string, _locale?: Locale): string {
  const num = typeof n === 'number' ? n : Number(n.replace(/\D/g, ''));
  return String(Math.max(0, Math.floor(num)));
}

export function nativeRupaye(cents: number, _locale?: Locale): string {
  return '₹' + nativeNum(Math.floor(cents / 100));
}