import { useMemo, useRef, useState } from 'react';
import { useInventory } from '@/stores/inventory';
import {
  CSV_FIELDS,
  CSV_LABELS,
  SNAP_SUGGESTIONS,
  guessMapping,
  parseCsv,
  parseVoiceLine,
  rowsToDrafts,
  type CsvField,
} from '@/lib/inventory';
import { formatMoney } from '@/lib/money';
import { UNITS, type UnitId } from '@/lib/units';
import { cn } from '@/lib/cn';
import type { FormValues } from '@/components/vendor/ItemForm';
import { detectItems, searchItems, toThumb, type Detection, type Suggestion } from '@/lib/vision';

export type AddMode = 'manual' | 'csv' | 'voice' | 'snap';

const MODES: Array<{ id: AddMode; label: string; icon: string }> = [
  { id: 'manual', label: 'Manual', icon: '✍️' },
  { id: 'csv', label: 'CSV file', icon: '📄' },
  { id: 'voice', label: 'Say it', icon: '🎙️' },
  { id: 'snap', label: 'Snap', icon: '📷' },
];

const SAMPLE_CSV = `name,category,qty,unit,cost,min,list,lowStock
Tomatoes,vegetable,24,kg,25,28,40,5
Milk,dairy,20,litre,52,56,62,4`;

/**
 * Quick-add paths. Each one ends in the same confirm-or-edit form, except CSV,
 * which shows a validation preview and imports the valid rows.
 */
export default function AddItem({ onPrefill }: { onPrefill: (v: Partial<FormValues>) => void }) {
  const [mode, setMode] = useState<AddMode>('manual');
  return (
    <section aria-label="Add items" className="grid gap-4">
      <div role="tablist" aria-label="How to add" className="grid grid-cols-4 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold',
              mode === m.id ? 'bg-ink text-paper' : 'bg-paper-3 text-ink',
            )}
          >
            <span className="text-lg" aria-hidden="true">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'csv' && <CsvImport />}
      {mode === 'voice' && <VoiceAdd onPrefill={onPrefill} />}
      {mode === 'snap' && <SnapAdd onPrefill={onPrefill} />}
      {mode === 'manual' && (
        <p className="text-sm text-ink-faint">Fill in the form below. Your lowest price is only seen by you.</p>
      )}
    </section>
  );
}

/* --------------------------------- CSV --------------------------------- */

function CsvImport() {
  const importMany = useInventory((s) => s.importMany);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<CsvField, number> | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const headers = rows[0] ?? [];
  const current = map ?? guessMapping(headers);
  const checked = useMemo(() => rowsToDrafts(rows.slice(1), current), [rows, current]);
  const valid = checked.filter((r) => r.draft && r.errors.length === 0);

  const load = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileName(file.name);
    setMap(null);
    setDone(null);
  };

  return (
    <div className="grid gap-4 surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-h-11 cursor-pointer rounded-2xl bg-marigold px-4 py-2.5 text-sm font-semibold text-[#23180a]">
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </label>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`}
          download="moltol-sample.csv"
          className="min-h-11 rounded-2xl px-3 py-2.5 text-sm font-medium text-indigo underline"
        >
          Download sample
        </a>
        {fileName && <span className="text-xs text-ink-faint">{fileName} · {rows.length - 1} rows</span>}
      </div>

      {rows.length > 1 && (
        <>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="text-sm font-semibold text-ink">Match your columns</legend>
            {CSV_FIELDS.map((f) => (
              <label key={f} className="flex items-center justify-between gap-3 text-sm text-ink">
                {CSV_LABELS[f]}
                <select
                  className="min-h-11 rounded-xl border border-chalk bg-paper px-2 text-base"
                  value={current[f]}
                  onChange={(e) => setMap({ ...current, [f]: Number(e.target.value) })}
                >
                  <option value={-1}>— not in file —</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>

          <div className="overflow-x-auto rounded-2xl border border-chalk">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Import preview</caption>
              <thead className="bg-paper-3 text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">List</th>
                  <th className="px-3 py-2">Check</th>
                </tr>
              </thead>
              <tbody>
                {checked.slice(0, 50).map((r) => (
                  <tr key={r.line} className="border-t border-chalk/60">
                    <td className="px-3 py-2 text-ink-faint">{r.line}</td>
                    <td className="px-3 py-2 text-ink">{r.draft?.name ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.draft ? `${r.draft.qty} ${UNITS[r.draft.unit].label}` : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.draft ? formatMoney(r.draft.listCents) : '—'}</td>
                    <td className="px-3 py-2">
                      {r.errors.length === 0 ? (
                        <span className="font-medium text-teal">✓ ready</span>
                      ) : (
                        <span className="text-xs font-medium text-chili">{r.errors.join(' · ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={valid.length === 0}
              onClick={() => {
                setDone(importMany(valid.map((r) => r.draft!)));
                setRows([]);
                setFileName('');
              }}
              className="min-h-11 rounded-2xl bg-teal px-5 py-2.5 font-semibold text-white disabled:opacity-40"
            >
              Import {valid.length} valid {valid.length === 1 ? 'row' : 'rows'}
            </button>
            <span className="text-xs text-ink-faint">{checked.length - valid.length} rows with errors are skipped.</span>
          </div>
        </>
      )}
      {done != null && (
        <p role="status" className="text-sm font-medium text-teal">
          ✓ Imported {done} items. You can undo from the toast.
        </p>
      )}
    </div>
  );
}

/* -------------------------------- Voice -------------------------------- */

type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void };

function VoiceAdd({ onPrefill }: { onPrefill: (v: Partial<FormValues>) => void }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseVoiceLine(text) : null), [text]);
  const recRef = useRef<SpeechRec | null>(null);

  const listen = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setErr('Voice is not available in this browser. Type it instead.');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => setText(e.results[0]?.[0]?.transcript ?? '');
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setErr(null);
    setListening(true);
    rec.start();
  };

  return (
    <div className="grid gap-3 surface p-4">
      <p className="text-sm text-ink">
        Say or type it the way you speak: <span className="font-mono text-ink-faint">“20 kilo tamatar, 30 rupaye kilo”</span>
      </p>
      <div className="flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-2xl border border-chalk bg-paper px-3 text-base text-ink"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="20 kilo tamatar, 30 rupaye kilo"
          aria-label="Item sentence"
        />
        <button
          type="button"
          onClick={listen}
          aria-pressed={listening}
          className={cn('min-h-11 rounded-2xl px-4 text-sm font-semibold', listening ? 'bg-chili text-white' : 'bg-paper-3 text-ink')}
        >
          {listening ? 'Listening…' : '🎙️ Speak'}
        </button>
      </div>
      {err && <p role="alert" className="text-xs text-chili">{err}</p>}
      {text.trim() && !parsed && <p className="text-xs text-chili">Could not find an item name. Try “20 kilo tamatar”.</p>}
      {parsed && (
        <div className="grid gap-2 rounded-2xl bg-paper p-3" aria-live="polite">
          <p className="text-sm text-ink">
            Got it: <b>{parsed.qty} {UNITS[parsed.unit].label}</b> of <b>{parsed.name}</b>
            {parsed.listCents != null && <> at <b>{formatMoney(parsed.listCents)}</b> per {UNITS[parsed.unit].label}</>}.
          </p>
          <p className="text-xs text-ink-faint">Cost and lowest price are suggested. Check them before you save.</p>
          <button
            type="button"
            onClick={() => onPrefill(voiceToForm(parsed))}
            className="min-h-11 w-fit rounded-2xl bg-marigold px-5 py-2.5 text-sm font-semibold text-[#23180a]"
          >
            Confirm & edit
          </button>
        </div>
      )}
    </div>
  );
}

function voiceToForm(p: NonNullable<ReturnType<typeof parseVoiceLine>>): Partial<FormValues> {
  const list = p.listCents ?? 0;
  return {
    name: p.name,
    qty: String(p.qty),
    unit: p.unit as UnitId,
    list: list ? String(list / 100) : '',
    // suggested, not known: cost 70% of list, lowest price 90%. The user fixes these.
    cost: list ? String(Math.round(list * 0.7) / 100) : '',
    min: list ? String(Math.round(list * 0.9) / 100) : '',
  };
}

/* -------------------------------- Snap --------------------------------- */

const SOURCE_LABEL = {
  vision: 'Vision model',
  'serpapi-lens': 'Google Lens (SerpAPI)',
  catalogue: 'Offline catalogue',
  'serpapi-shopping': 'Shopping search (SerpAPI)',
} as const;

function SnapAdd({ onPrefill }: { onPrefill: (v: Partial<FormValues>) => void }) {
  const [phase, setPhase] = useState<'idle' | 'detecting' | 'ready' | 'error'>('idle');
  const [thumb, setThumb] = useState<string | null>(null);
  const [det, setDet] = useState<Detection | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Suggestion[] | null>(null);
  const [foundSource, setFoundSource] = useState<keyof typeof SOURCE_LABEL>('catalogue');
  const [searching, setSearching] = useState(false);

  const onFile = async (file: File) => {
    setPhase('detecting');
    setFound(null);
    try {
      const t = await toThumb(file);
      setThumb(t);
      setDet(await detectItems(t));
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  };

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    const r = await searchItems(q);
    setFound(r.results);
    setFoundSource(r.source);
    setSearching(false);
  };

  const confirm = (s: Suggestion) =>
    onPrefill({
      name: s.name,
      category: s.category,
      emoji: s.emoji,
      unit: s.unit,
      list: String(s.listCents / 100),
      compKey: s.compKey,
      photo: thumb ?? '',
    });

  const list = (items: Suggestion[]) => (
    <ul className="grid gap-2" aria-label="Suggestions">
      {items.map((s) => (
        <li key={s.name}>
          <button type="button" onClick={() => confirm(s)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-paper p-3 text-left transition active:scale-[0.99]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-paper-3 text-2xl" aria-hidden="true">{s.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
              <span className="t-num text-xs text-ink-muted">suggested {formatMoney(s.listCents)} / {s.unit}</span>
            </span>
            <span className="text-xs font-semibold text-indigo">Use this</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid gap-4 rounded-3xl bg-paper-2 p-4">
      <p className="text-sm text-ink">Take a photo of the goods. We suggest items, you confirm or edit, and the photo is saved with the item.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-2xl bg-ink px-5 text-sm font-semibold text-paper">
          Snap a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </label>
        {thumb && <img src={thumb} alt="Your photo" className="h-14 w-14 rounded-2xl object-cover" />}
      </div>

      {phase === 'detecting' && (
        <div role="status" className="grid gap-2" aria-label="Detecting">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-paper-3 motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {phase === 'error' && <p role="alert" className="text-sm text-chili">Could not read that photo. Try again, or search by name.</p>}
      {phase === 'ready' && det && (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="pill pill-teal">{SOURCE_LABEL[det.source]}</span>
            {det.note}
          </p>
          {list(det.suggestions)}
        </div>
      )}

      {/* the fallback for anything the photo did not match */}
      <form
        className="grid gap-2 border-t border-chalk pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="text-sm font-semibold text-ink-muted" htmlFor="snap-search">Not in the list? Search by name</label>
        <div className="flex gap-2">
          <input id="snap-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. mustard oil" className="field min-w-0 flex-1" />
          <button type="submit" disabled={!q.trim() || searching} className="btn btn-quiet shrink-0">
            {searching ? 'Searching' : 'Search'}
          </button>
        </div>
        {found && (
          <div className="grid gap-2">
            <p className="text-xs text-ink-muted"><span className="pill">{SOURCE_LABEL[foundSource]}</span> {found.length} match{found.length === 1 ? '' : 'es'}</p>
            {found.length ? list(found) : <p className="text-sm text-ink-muted">Nothing matched. Add it by hand below.</p>}
          </div>
        )}
      </form>
    </div>
  );
}
