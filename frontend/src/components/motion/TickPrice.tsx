import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { formatMoney } from '@/lib/money';

/** A price that rolls to its new value with a spring instead of jumping. Reduced motion: no roll. */
export default function TickPrice({ cents, className }: { cents: number; className?: string }) {
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);

  useEffect(() => {
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(cents);
      from.current = cents;
      return;
    }
    const ctl = animate(from.current, cents, { duration: 0.7, ease: [0.2, 0.9, 0.2, 1], onUpdate: (v) => setShown(Math.round(v)) });
    from.current = cents;
    return () => ctl.stop();
  }, [cents]);

  return <span className={className}>{formatMoney(shown)}</span>;
}
