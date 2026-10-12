import { AnimatePresence, motion } from 'motion/react';
import { useUi } from '@/stores/ui';
import { formatMoney } from '@/lib/money';

/**
 * A brief, unmissable "money credited" celebration — purely visual, so it
 * shows instantly even before any click has unlocked audio playback. Mounted
 * once in Shell.tsx; useUi.showMoneySplash() (see lib/moneyEvents.ts) drives it.
 */
export default function MoneySplash() {
  const splash = useUi((s) => s.moneySplash);
  const clear = useUi((s) => s.clearMoneySplash);

  return (
    <AnimatePresence>
      {splash && (
        <motion.div
          key={splash.amountCents}
          role="status"
          aria-live="assertive"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={clear}
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/40 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.7, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="surface-accent grid justify-items-center gap-2 p-9 text-center shadow-2xl"
          >
            <motion.span
              className="text-6xl"
              aria-hidden="true"
              initial={{ rotate: -12, scale: 0.6 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.1 }}
            >
              💰
            </motion.span>
            <p className="t-label !text-[#5b3200]">Money credited</p>
            <p className="t-num text-4xl font-bold !text-[#23180a] sm:text-5xl">{formatMoney(splash.amountCents)}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
