import { useEffect } from 'react';
import { motion } from 'motion/react';

/** The deal-closed moment: coins drop past the screen and the phone buzzes once. Skipped for reduced motion. */
export default function CoinDrop({ count = 14 }: { count?: number }) {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!reduced && 'vibrate' in navigator) navigator.vibrate([30, 50, 30]);
  }, [reduced]);

  if (reduced) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const x = 8 + ((i * 37) % 84);
        const delay = (i % 7) * 0.09;
        return (
          <motion.span
            key={i}
            initial={{ y: -80, x: 0, rotate: 0, opacity: 0 }}
            animate={{ y: '110vh', x: [0, i % 2 ? 14 : -14, 0], rotate: 360, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.8, delay, ease: [0.3, 0.1, 0.7, 1] }}
            className="absolute top-0 grid h-9 w-9 place-items-center rounded-full bg-marigold text-base font-bold text-warn shadow-md"
            style={{ left: `${x}%` }}
          >
            ₹
          </motion.span>
        );
      })}
    </div>
  );
}
