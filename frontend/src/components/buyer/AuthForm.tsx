import { useRef, useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useSession, type Role } from '@/stores/session';
import { useSimple } from '@/stores/simple';
import { verifyOtp, requestOtp } from '@/lib/mock/auth';
import { cn } from '@/lib/cn';
import { useI18n } from '@/stores/prefs';

const ROLE_CARDS: Array<{ role: Role; icon: string; titleKey: 'auth.buyer.title' | 'auth.seller.title'; subKey: 'auth.buyer.sub' | 'auth.seller.sub' }> = [
  { role: 'buyer', icon: '🛒', titleKey: 'auth.buyer.title', subKey: 'auth.buyer.sub' },
  { role: 'seller', icon: '🏪', titleKey: 'auth.seller.title', subKey: 'auth.seller.sub' },
];

const OTP_LEN = 4;

/**
 * Login and signup in two steps: (role, signup only) → phone → code.
 * One account can hold both roles; the role picked here is just the start.
 */
export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const session = useSession();
  const simple = useSimple();
  const { t } = useI18n();
  const [role, setRole] = useState<Role | null>(mode === 'signup' ? null : 'buyer');
  const [identifier, setIdentifier] = useState('');
  const [stage, setStage] = useState<'role' | 'phone' | 'code'>(mode === 'signup' ? 'role' : 'phone');
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(''));
  const [err, setErr] = useState<string | null>(null);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const otp = digits.join('');

  const enter = (name: string, phone: string, r: Role) => {
    session.login(name, phone);
    session.markProfile('buyer');
    session.markProfile('seller');
    // Soft nav (not location.href): a hard reload can outrun the async IndexedDB
    // write of the login/profile state just set, landing back on an apparently
    // logged-out page.
    if (r === 'seller') {
      session.setRole('seller', '/app/seller/simple');
      simple.setStall('My stall', '🏪');
      simple.finishOnboarding();
      void navigate('/app/seller/simple');
    } else {
      session.setRole('buyer', '/app/buy');
      void navigate('/app/buy');
    }
  };

  const sendCode = () => {
    if (identifier.replace(/\D/g, '').length < 10) {
      setErr('Enter a 10-digit mobile number.');
      return;
    }
    requestOtp(identifier);
    setErr(null);
    setDigits(Array(OTP_LEN).fill(''));
    setStage('code');
    setTimeout(() => boxes.current[0]?.focus(), 50);
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setErr(null);
    if (d && i < OTP_LEN - 1) boxes.current[i + 1]?.focus();
  };

  const verify = () => {
    const res = verifyOtp({ identifier, otp });
    if (!res.ok) {
      setErr("That code didn't match. On the demo it is 1234.");
      return;
    }
    enter(res.name ?? 'You', identifier, role ?? 'buyer');
  };

  return (
    <div className="grid w-full gap-6">
      {stage === 'role' && (
        <fieldset className="grid gap-3">
          <legend className="t-label mb-1">{t('auth.step1')}</legend>
          {ROLE_CARDS.map((c) => (
            <button
              key={c.role}
              type="button"
              aria-pressed={role === c.role}
              onClick={() => {
                setRole(c.role);
                setStage('phone');
              }}
              className={cn(
                'surface flex min-h-20 items-center gap-4 p-4 text-left transition active:scale-[0.99]',
                role === c.role && 'ring-2 ring-marigold',
              )}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-paper-3 text-3xl" aria-hidden="true">{c.icon}</span>
              <span className="min-w-0">
                <span className="block text-lg font-semibold text-ink">{t(c.titleKey)}</span>
                <span className="block text-sm text-ink-muted">{t(c.subKey)}</span>
              </span>
            </button>
          ))}
        </fieldset>
      )}

      {stage === 'phone' && (
        <form
          className="surface grid gap-4 p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
          noValidate
        >
          <div>
            <p className="t-label">{mode === 'signup' ? 'Step 2 · your number' : 'Log in'}</p>
            <h2 className="t-h2 mt-1">{t('auth.phone.title')}</h2>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t('auth.phone.label')}</span>
            <span className="flex overflow-hidden rounded-2xl border border-chalk-strong bg-paper focus-within:ring-4 focus-within:ring-indigo/20">
              <span className="flex items-center border-r border-chalk px-4 font-mono text-base text-ink-muted">+91</span>
              <input
                inputMode="tel"
                autoComplete="tel-national"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setErr(null);
                }}
                placeholder="98765 43210"
                aria-invalid={!!err}
                className="min-h-12 w-full bg-transparent px-4 text-base text-ink outline-none placeholder:text-ink-faint"
              />
            </span>
          </label>
          {err && <p role="alert" className="text-sm font-medium text-chili">{err}</p>}
          <button type="submit" className="btn btn-primary w-full">{t('auth.sendCode')}</button>
          <p className="text-center text-xs text-ink-faint">{t('auth.demoHint')}</p>
        </form>
      )}

      {stage === 'code' && (
        <div className="surface grid gap-5 p-5 sm:p-6">
          <div>
            <p className="t-label">{t('auth.code.title')}</p>
            <h2 className="t-h2 mt-1">{t('auth.code.sent')} {identifier}</h2>
          </div>
          <div className="flex justify-between gap-2" role="group" aria-label="Four digit code">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                value={d}
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                  if (e.key === 'Enter') verify();
                }}
                onPaste={(e) => {
                  const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LEN);
                  if (!txt) return;
                  e.preventDefault();
                  setDigits(Array.from({ length: OTP_LEN }, (_, k) => txt[k] ?? ''));
                  boxes.current[Math.min(txt.length, OTP_LEN - 1)]?.focus();
                }}
                className={cn(
                  'h-16 w-full min-w-0 rounded-2xl border bg-paper text-center font-mono text-2xl font-semibold text-ink outline-none transition focus:ring-4 focus:ring-indigo/20',
                  err ? 'border-chili' : d ? 'border-marigold' : 'border-chalk-strong',
                )}
              />
            ))}
          </div>
          {err && <p role="alert" className="text-sm font-medium text-chili">{err}</p>}
          <button type="button" onClick={verify} disabled={otp.length < OTP_LEN} className="btn btn-primary w-full">{t('auth.verify')}</button>
          <button type="button" onClick={() => setStage('phone')} className="btn btn-link w-full">{t('auth.changeNumber')}</button>
        </div>
      )}
    </div>
  );
}
