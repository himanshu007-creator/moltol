import { useBuyer } from '@/stores/buyer';
import PersonalityPicker from '@/components/buyer/PersonalityPicker';

/** The saved haggle style. Changing it here sets the default for new baskets. */
export default function HaggleStyleCard() {
  const personality = useBuyer((s) => s.personality);
  const setPersonality = useBuyer((s) => s.setPersonality);
  return (
    <section aria-labelledby="style-h" className="grid gap-3 surface p-4">
      <div>
        <h2 id="style-h" className="text-sm font-semibold text-ink">Your haggle style</h2>
        <p className="text-xs text-ink-faint">Default for new baskets. You can change it for any one basket in the cart.</p>
      </div>
      <PersonalityPicker value={personality} onChange={setPersonality} />
    </section>
  );
}
