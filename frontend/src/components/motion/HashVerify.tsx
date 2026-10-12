import { useEffect, useState } from 'react';

const HEX = '0123456789abcdef';

/**
 * Proof of fair deal: a real SHA-256 of the settled order, scrambled and then locked
 * one character at a time, then marked verified. Reduced motion shows the final hash.
 */
export default function HashVerify({ input }: { input: string }) {
  const [hex, setHex] = useState<string | null>(null);
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      const digest = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (!alive) return;
      setHex(digest);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setShown(digest);
        setDone(true);
        return;
      }
      let frame = 0;
      const total = 40;
      timer = setInterval(() => {
        frame++;
        const locked = Math.min(digest.length, Math.floor((frame / total) * digest.length));
        const scramble = Array.from({ length: digest.length - locked }, () => HEX[Math.floor(Math.random() * 16)]).join('');
        setShown(digest.slice(0, locked) + scramble);
        if (frame >= total) {
          clearInterval(timer);
          setShown(digest);
          setDone(true);
        }
      }, 35);
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [input]);

  return (
    <div className="grid gap-2" aria-live="polite">
      <code className="t-num break-all text-xs leading-relaxed text-ink">{shown || (hex ? '' : 'computing…')}</code>
      {done && <span className="pill pill-teal w-fit">✓ Verified SHA-256</span>}
    </div>
  );
}
