import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { go } from '../Gate';
import { OFFER, priceNow, rupees } from '../offer';
import type { Contact, User } from '../types';
import { Logo } from './Logo';
import { Support } from './Support';

const input =
  'w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]';

/** "Get it now" lands here: the login and the contact details for posts, then straight to payment.
 *  After paying the customer is signed in and answers the 3 questions about their business. */
export function Signup({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [login, setLogin] = useState({ phone: '', email: '', password: '' });
  const [contact, setContact] = useState<Contact>({});
  const [endCard, setEndCard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState({ online: false, price: priceNow() });
  useEffect(() => {
    void api.publicStats().then((s) => setPay({ online: s.online, price: s.price }), () => {});
    // Back from PhonePe without paying: the browser may show this form as it was. The account exists now, so reload
    // into the app, which shows the payment screen.
    const back = (e: PageTransitionEvent) => e.persisted && location.reload();
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  async function submit() {
    if (!login.phone.trim() && !login.email.trim()) return setError('Enter your email or mobile number to log in with.');
    if (login.password.length < 6) return setError('Use a password of at least 6 characters.');
    setBusy(true);
    setError(null);
    try {
      const user = await api.signup({ ...login, contact, endCard });
      // Online: on to PhonePe now (staying busy while it opens). If that can't open (or payments are manual), the
      // app shows the payment screen.
      if (pay.online) {
        const url = await api.payPack().then((r) => r.url, () => null);
        if (url) return void (location.href = url);
      }
      onSignedIn(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
    setBusy(false);
  }

  const field = (key: keyof Contact, label: string, placeholder: string, mode?: 'tel' | 'email' | 'url') => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <input
        value={contact[key] ?? ''}
        onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
        type={mode === 'email' ? 'email' : 'text'}
        inputMode={mode}
        maxLength={120}
        placeholder={placeholder}
        className={input}
      />
    </label>
  );

  return (
    <div className="relative isolate grid h-full place-items-center overflow-y-auto overflow-x-hidden overscroll-contain p-4">
      <div className="aurora -z-10" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="glass appear w-full max-w-lg rounded-[28px] p-6 sm:p-7"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Create your account</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--text-2)]">
          {OFFER.pack} · <b className="font-semibold text-[color:var(--text)]">{rupees(pay.price)}</b>. Pay next, then tell us about your business. Log in later with your email or mobile number.
        </p>

        <div className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Mobile number</span>
              <input value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" autoFocus placeholder="98765 43210" className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">or Email</span>
              <input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} type="email" autoComplete="email" placeholder="you@yourcompany.com" className={input} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Password</span>
            <input value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} type="password" autoComplete="new-password" placeholder="At least 6 characters" className={input} />
          </label>

          <div className="border-t border-white/[0.08] pt-5">
            <p className="text-[14px] font-medium">Contact details for your posts</p>
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-3)]">Optional. Shown in a bar at the bottom of your posts and at the end of your videos.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('phone', 'Phone or WhatsApp', '+91 98765 43210', 'tel')}
            {field('email', 'Email', 'hello@yourcompany.com', 'email')}
          </div>
          {field('website', 'Website', 'www.yourcompany.com', 'url')}
          {field('address', 'Address', 'Shop 12, MG Road, Pune')}
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]">
            <input type="checkbox" checked={endCard} onChange={(e) => setEndCard(e.target.checked)} className="h-4 w-4 accent-[color:var(--violet)]" />
            <span className="text-[13.5px]">Show these on my posts and videos</span>
          </label>

          {error && (
            <p role="alert" className="text-[13px] text-[color:var(--red)]">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" className="btn-quiet h-11 px-4" aria-label="Back" onClick={() => go('/')}>
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={busy}
              className="press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[color:var(--green)] text-[15px] font-semibold text-black hover:brightness-105 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? 'Creating your account…' : `Pay ${rupees(pay.price)} & create account`}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[color:var(--text-2)]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--green)]" />
            {pay.online
              ? 'You’ll pay securely with PhonePe: UPI, cards or netbanking. Then you’re signed in and ready to set up your posts.'
              : 'Next you’ll see how to pay by UPI. Once it’s confirmed you’re ready to set up your posts.'}
          </p>
          <p className="text-center text-[13px] text-[color:var(--text-2)]">
            Already have an account?{' '}
            <button type="button" className="font-medium text-[color:var(--text)] underline underline-offset-4" onClick={() => go('/login')}>
              Log in
            </button>
          </p>
          <Support className="border-t border-white/[0.06] pt-4" />
        </div>
      </form>
    </div>
  );
}
