/**
 * Generates every voice clip once, at build time, with Cartesia.
 *   node scripts/gen-voice.ts              generate changed clips
 *   node scripts/gen-voice.ts --dry        show what would be generated
 *   node scripts/gen-voice.ts --list-voices
 * The API key is read from .env.local (git-ignored) and is never written to public/ or dist/.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_CONFIG } from './voice.config.ts';
import { allClipKeys, type VoiceLocale } from '../src/lib/copy/voice.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'voice');
const API = 'https://api.cartesia.ai';

function loadKey(): string {
  const env = join(ROOT, '.env.local');
  if (!existsSync(env)) throw new Error('CARTESIA_API_KEY missing: create .env.local (git-ignored)');
  const line = readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('CARTESIA_API_KEY='));
  const key = line?.split('=')[1]?.trim();
  if (!key) throw new Error('CARTESIA_API_KEY is empty in .env.local');
  return key;
}

const KEY = process.env.CARTESIA_API_KEY ?? (process.argv.includes('--list-voices') || !process.argv.includes('--dry') ? loadKey() : '');
const headers = { Authorization: `Bearer ${KEY}`, 'Cartesia-Version': VOICE_CONFIG.cartesia_version, 'Content-Type': 'application/json' };

async function listVoices(language: string) {
  const res = await fetch(`${API}/voices?language=${language}&limit=100`, { headers });
  if (!res.ok) throw new Error(`voices ${res.status}`);
  return (await res.json()).data as Array<{ id: string; name: string; accents: Array<{ accent: string }> }>;
}

async function speak(text: string, locale: VoiceLocale): Promise<Buffer> {
  const voice = VOICE_CONFIG.voices[locale];
  const body = {
    model_id: VOICE_CONFIG.model_id,
    transcript: text,
    language: voice.language,
    voice: { mode: 'id', id: voice.id },
    output_format: VOICE_CONFIG.output,
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/tts/bytes`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('tts: retries exhausted');
}

async function main() {
  if (process.argv.includes('--list-voices')) {
    for (const language of ['hi', 'en']) {
      const voices = await listVoices(language);
      for (const v of voices) {
        const accents = v.accents.map((a) => a.accent);
        if (language === 'hi' || accents.includes('indian-english')) console.log(language, v.id, v.name, accents.slice(0, 3).join(','));
      }
    }
    return;
  }

  const manifestPath = join(OUT, 'manifest.json');
  const manifest: Record<string, { hash: string }> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const jobs: Array<{ locale: VoiceLocale; key: string; text: string; hash: string }> = [];
  const wanted = new Set<string>();

  for (const locale of ['en', 'hi'] as const) {
    for (const [key, text] of Object.entries(allClipKeys(locale))) {
      const hash = createHash('sha256').update([VOICE_CONFIG.model_id, VOICE_CONFIG.voices[locale].id, locale, text].join('|')).digest('hex').slice(0, 16);
      const id = `${locale}/${key}`;
      wanted.add(id);
      const file = join(OUT, locale, `${key}.mp3`);
      if (manifest[id]?.hash !== hash || !existsSync(file)) jobs.push({ locale, key, text, hash });
    }
  }

  // remove clips whose text was dropped from the copy
  for (const locale of ['en', 'hi'] as const) {
    const dir = join(OUT, locale);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const id = `${locale}/${f.replace(/\.mp3$/, '')}`;
      if (!wanted.has(id)) {
        unlinkSync(join(dir, f));
        delete manifest[id];
        console.log('removed', id);
      }
    }
  }

  console.log(`${jobs.length} clip(s) to generate, ${wanted.size - jobs.length} up to date`);
  if (process.argv.includes('--dry')) {
    for (const j of jobs) console.log(' ', j.locale, j.key, '→', j.text);
    return;
  }

  const queue = [...jobs];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const j = queue.shift()!;
      mkdirSync(join(OUT, j.locale), { recursive: true });
      const audio = await speak(j.text, j.locale);
      writeFileSync(join(OUT, j.locale, `${j.key}.mp3`), audio);
      manifest[`${j.locale}/${j.key}`] = { hash: j.hash };
      console.log('ok', j.locale, j.key, `${audio.length} bytes`);
    }
  });
  await Promise.all(workers);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('done');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
