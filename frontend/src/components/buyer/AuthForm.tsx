import { useEffect, useRef, useState } from 'react';
import { navigate } from 'astro:transitions/client';
import { useSession, type Role } from '@/stores/session';
import { useSimple } from '@/stores/simple';
import {
  BackendAuthError,
  createShop,
  forgotPassword,
  login as backendLogin,
  resendSignupOtp,
  resetPassword,
  signup as backendSignup,
  verifySignupOtp,
} from '@/lib/backend';
import { cn } from '@/lib/cn';
import { useI18n } from '@/stores/prefs';

const ROLE_CARDS: Array<{ role: Role; icon: string; titleKey: 'auth.buyer.title' | 'auth.seller.title'; subKey: 'auth.buyer.sub' | 'auth.seller.sub' }> = [
  { role: 'buyer', icon: '🛒', titleKey: 'auth.buyer.title', subKey: 'auth.buyer.sub' },
  { role: 'seller', icon: '🏪', titleKey: 'auth.seller.title', subKey: 'auth.seller.sub' },
];

const OTP_LEN = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Stage = 'role' | 'credentials' | 'otp' | 'forgot-email' | 'forgot-reset';

/** Landing's two-doors cards link here with ?role=buyer|seller — honor it by
 *  skipping the redundant role step instead of asking the visitor twice. */
function roleFromUrl(): Role | null {
  if (typeof window === 'undefined') return null;
  const r = new URLSearchParams(window.location.search).get('role');
  return r === 'buyer' || r === 'seller' ? r : null;
}

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const session = useSession();
  const simple = useSimple();
  const { t } = useI18n();

  // `?role=` only exists client-side (SSR has no window): start from the
  // SSR-safe 'role' stage and skip it in an effect once mounted, instead of
  // branching the initial state on `window` — that mismatch is what caused
  // a real React hydration-mismatch warning on every signup?role= visit.
  const [role, setRole] = useState<Role | null>(mode === 'signup' ? null : 'buyer');
  const [stage, setStage] = useState<Stage>(mode === 'signup' ? 'role' : 'credentials');

  useEffect(() => {
    if (mode !== 'signup') return;
    const urlRole = roleFromUrl();
    if (urlRole) {
      setRole(urlRole);
      setStage('credentials');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [normalizedEmail, setNormalizedEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(''));
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const otp = digits.join('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]);

  const focusFirstOtpBox = () => setTimeout(() => boxes.current[0]?.focus(), 50);

  const landingRoute = (hasShop: boolean): { role: Role; route: string } =>
    hasShop ? { role: 'seller', route: '/app/seller/simple' } : { role: 'buyer', route: '/app/buy' };

  const finishLogin = async (token: string, loggedInEmail: string, hasShop: boolean, chosenRole: Role | null) => {
    session.loginWithBackend(loggedInEmail, token);
    session.markProfile('buyer');
    session.markProfile('seller');

    const dest = chosenRole === 'seller' || (!chosenRole && hasShop) ? landingRoute(true) : landingRoute(hasShop);
    if (dest.role === 'seller' && !hasShop) {
      // Fresh seller signup: register the shop server-side, mirroring the
      // local IndexedDB stall that's always been created here.
      try {
        await createShop(token, simple.stallName || 'My stall', simple.stallEmoji || '🏪');
      } catch {
        // Local-first: don't block the seller from reaching their dashboard
        // just because the backend write failed.
      }
      simple.setStall(simple.stallName || 'My stall', simple.stallEmoji || '🏪');
      simple.finishOnboarding();
    }
    session.setRole(dest.role, dest.route);
    // Soft nav (not location.href): a hard reload can outrun the async IndexedDB
    // write of the login/profile state just set, landing back on an apparently
    // logged-out page.
    void navigate(dest.route);
  };

  function friendlyError(e: unknown): string {
    if (e instanceof BackendAuthError) {
      switch (e.title) {
        case 'account_exists':
          return t('auth.err.duplicate');
        case 'invalid_credentials':
          return t('auth.err.invalidCredentials');
        case 'not_verified':
          return t('auth.err.notVerified');
        case 'wrong_code':
          return e.detail ? `${t('auth.err.wrongCode')} ${e.detail}` : t('auth.err.wrongCode');
        case 'invalid_email':
          return t('auth.err.invalidEmail');
        default:
          return e.detail || t('auth.err.generic');
      }
    }
    return t('auth.err.generic');
  }

  const submitCredentials = async () => {
    setErr(null);
    if (!EMAIL_RE.test(email.trim())) return setErr(t('auth.err.invalidEmail'));
    if (password.length < 8) return setErr(t('auth.err.weakPassword'));
    if (mode === 'signup' && password !== confirmPassword) return setErr(t('auth.password.mismatch'));

    setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await backendSignup(email.trim(), password);
        setNormalizedEmail(res.normalizedEmail);
        setCooldown(res.resendCooldownSeconds);
        setDigits(Array(OTP_LEN).fill(''));
        setStage('otp');
        focusFirstOtpBox();
      } else {
        const res = await backendLogin(email.trim(), password);
        await finishLogin(res.token, res.user.email, res.user.hasShop, null);
      }
    } catch (e) {
      if (e instanceof BackendAuthError && e.title === 'not_verified') {
        setNormalizedEmail(email.trim());
        try {
          const r = await resendSignupOtp(email.trim());
          setCooldown(r.resendCooldownSeconds);
        } catch {
          /* still let them try the otp screen even if the resend failed */
        }
        setDigits(Array(OTP_LEN).fill(''));
        setStage('otp');
        focusFirstOtpBox();
        setErr(t('auth.err.notVerified'));
      } else if (e instanceof BackendAuthError && e.title === 'resend_cooldown') {
        // Signup on an email with an already-pending, unexpired code: it was
        // already resent server-side — just resume the OTP screen.
        setNormalizedEmail(email.trim());
        setCooldown(e.secondsRemaining ?? 45);
        setDigits(Array(OTP_LEN).fill(''));
        setStage('otp');
        focusFirstOtpBox();
      } else {
        setErr(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setErr(null);
    if (d && i < OTP_LEN - 1) boxes.current[i + 1]?.focus();
  };

  const verify = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await verifySignupOtp(normalizedEmail || email.trim(), otp);
      await finishLogin(res.token, res.user.email, res.user.hasShop, role);
    } catch (e) {
      setErr(friendlyError(e));
      setDigits(Array(OTP_LEN).fill(''));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await resendSignupOtp(normalizedEmail || email.trim());
      setCooldown(r.resendCooldownSeconds);
    } catch (e) {
      if (e instanceof BackendAuthError && e.title === 'resend_cooldown' && e.secondsRemaining) {
        setCooldown(e.secondsRemaining);
      } else {
        setErr(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const resendReset = async () => {
    if (cooldown > 0 || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setCooldown(45);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = async () => {
    setErr(null);
    if (!EMAIL_RE.test(email.trim())) return setErr(t('auth.err.invalidEmail'));
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setResetSent(true);
      setCooldown(45);
      setDigits(Array(OTP_LEN).fill(''));
      setStage('forgot-reset');
      focusFirstOtpBox();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setErr(null);
    if (newPassword.length < 8) return setErr(t('auth.err.weakPassword'));
    setBusy(true);
    try {
      const res = await resetPassword(email.trim(), otp, newPassword);
      await finishLogin(res.token, res.user.email, res.user.hasShop, null);
    } catch (e) {
      setErr(friendlyError(e));
      setDigits(Array(OTP_LEN).fill(''));
    } finally {
      setBusy(false);
    }
  };

  const otpRow = (onSubmit: () => void) => (
    <div className="flex justify-between gap-2" role="group" aria-label="6 digit code">
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
            if (e.key === 'Enter') onSubmit();
          }}
          onPaste={(e) => {
            const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LEN);
            if (!txt) return;
            e.preventDefault();
            setDigits(Array.from({ length: OTP_LEN }, (_, k) => txt[k] ?? ''));
            boxes.current[Math.min(txt.length, OTP_LEN - 1)]?.focus();
          }}
          className={cn(
            'h-14 w-full min-w-0 rounded-2xl border bg-paper text-center font-mono text-xl font-semibold text-ink outline-none transition focus:ring-4 focus:ring-indigo/20',
            err ? 'border-chili' : d ? 'border-marigold' : 'border-chalk-strong',
          )}
        />
      ))}
    </div>
  );

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
                setStage('credentials');
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

      {stage === 'credentials' && (
        <form
          className="surface grid gap-4 p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCredentials();
          }}
          noValidate
        >
          <div>
            <h2 className="t-h2 mt-1">{mode === 'signup' ? t('auth.signupCta') : t('auth.loginCta')}</h2>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t('auth.email.label')}</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr(null);
              }}
              placeholder="you@example.com"
              aria-invalid={!!err}
              className="min-h-12 w-full rounded-2xl border border-chalk-strong bg-paper px-4 text-base text-ink outline-none focus:ring-4 focus:ring-indigo/20"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t('auth.password.label')}</span>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr(null);
              }}
              placeholder="••••••••"
              aria-invalid={!!err}
              className="min-h-12 w-full rounded-2xl border border-chalk-strong bg-paper px-4 text-base text-ink outline-none focus:ring-4 focus:ring-indigo/20"
            />
          </label>
          {mode === 'signup' && (
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-ink-muted">{t('auth.password.confirm')}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setErr(null);
                }}
                placeholder="••••••••"
                aria-invalid={!!err}
                className="min-h-12 w-full rounded-2xl border border-chalk-strong bg-paper px-4 text-base text-ink outline-none focus:ring-4 focus:ring-indigo/20"
              />
            </label>
          )}
          {err && (
            <p role="alert" className="text-sm font-medium text-chili">
              {err}
              {err === t('auth.err.duplicate') && (
                <>
                  {' '}
                  <button type="button" className="font-semibold underline" onClick={() => void navigate('/login')}>
                    {t('auth.loginInstead')}
                  </button>
                </>
              )}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {mode === 'signup' ? t('auth.signupCta') : t('auth.loginCta')}
          </button>
          {mode === 'login' && (
            <button
              type="button"
              className="btn btn-link w-full"
              onClick={() => {
                setErr(null);
                setStage('forgot-email');
              }}
            >
              {t('auth.forgotPassword')}
            </button>
          )}
        </form>
      )}

      {stage === 'otp' && (
        <div className="surface grid gap-5 p-5 sm:p-6">
          <div>
            <p className="t-label">{t('auth.otp.title')}</p>
            <h2 className="t-h2 mt-1">{t('auth.otp.sentTo')} {normalizedEmail || email}</h2>
            {normalizedEmail && normalizedEmail !== email.trim() && (
              <p className="mt-2 text-sm text-ink-muted">
                {t('auth.normalizedPrefix')} <strong className="text-ink">{normalizedEmail}</strong> — {t('auth.normalizedHint')}
              </p>
            )}
          </div>
          {otpRow(verify)}
          {err && <p role="alert" className="text-sm font-medium text-chili">{err}</p>}
          <button type="button" onClick={() => void verify()} disabled={busy || otp.length < OTP_LEN} className="btn btn-primary w-full">
            {t('auth.verify')}
          </button>
          <button type="button" onClick={() => void resend()} disabled={busy || cooldown > 0} className="btn btn-link w-full">
            {cooldown > 0 ? `${t('auth.resendIn')} ${cooldown}s` : t('auth.resend')}
          </button>
        </div>
      )}

      {stage === 'forgot-email' && (
        <form
          className="surface grid gap-4 p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void sendResetCode();
          }}
          noValidate
        >
          <div>
            <p className="t-label">{t('auth.reset.title')}</p>
            <h2 className="t-h2 mt-1">{t('auth.reset.lede')}</h2>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t('auth.email.label')}</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr(null);
              }}
              placeholder="you@example.com"
              className="min-h-12 w-full rounded-2xl border border-chalk-strong bg-paper px-4 text-base text-ink outline-none focus:ring-4 focus:ring-indigo/20"
            />
          </label>
          {err && <p role="alert" className="text-sm font-medium text-chili">{err}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">{t('auth.reset.sendCode')}</button>
          <button type="button" onClick={() => setStage('credentials')} className="btn btn-link w-full">{t('auth.backToLogin')}</button>
        </form>
      )}

      {stage === 'forgot-reset' && (
        <div className="surface grid gap-5 p-5 sm:p-6">
          <div>
            <p className="t-label">{t('auth.otp.title')}</p>
            <h2 className="t-h2 mt-1">{t('auth.otp.sentTo')} {email}</h2>
            {resetSent && <p className="mt-2 text-sm text-ink-muted">{t('auth.reset.sent')}</p>}
          </div>
          {otpRow(submitReset)}
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t('auth.password.new')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setErr(null);
              }}
              placeholder="••••••••"
              className="min-h-12 w-full rounded-2xl border border-chalk-strong bg-paper px-4 text-base text-ink outline-none focus:ring-4 focus:ring-indigo/20"
            />
          </label>
          {err && <p role="alert" className="text-sm font-medium text-chili">{err}</p>}
          <button type="button" onClick={() => void submitReset()} disabled={busy || otp.length < OTP_LEN} className="btn btn-primary w-full">
            {t('auth.reset.submit')}
          </button>
          <button type="button" onClick={() => void resendReset()} disabled={busy || cooldown > 0} className="btn btn-link w-full">
            {cooldown > 0 ? `${t('auth.resendIn')} ${cooldown}s` : t('auth.resend')}
          </button>
        </div>
      )}
    </div>
  );
}
