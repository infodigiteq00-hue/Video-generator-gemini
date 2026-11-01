import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { go } from '../Gate';
import type { User } from '../types';
import { Logo } from './Logo';

/** An invite from our team: the customer sets a password; the brand setup opens once they're in. */
export function Invite({ token, onSignedIn }: { token: string; onSignedIn: (u: User) => void }) {
  const [invite, setInvite] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [form, setForm] = useState({ email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getInvite(token).then(
      (i) => {
        setInvite(i);
        setForm((f) => ({ ...f, email: i.email ?? '', phone: i.phone ?? '' }));
      },
      (e: Error) => setError(e.message),
    );
  }, [token]);

  async function submit() {
    if (form.password.length < 6) return setError('Use a password of at least 6 characters.');
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.acceptInvite(token, form));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]';

  return (
    <div className="relative isolate grid h-full place-items-center overflow-y-auto overscroll-contain p-4">
      <div className="aurora -z-10" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="glass appear w-full max-w-sm rounded-[28px] p-6 sm:p-7"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Welcome! Set your password</h1>
        <p className="mt-1 text-[14px] text-[color:var(--text-2)]">Your payment is confirmed. Set a password, then tell us about your business.</p>

        {invite && (
          <>
            <label className="mt-6 block">
              <span className="mb-1.5 block text-[13px] font-medium">Mobile number</span>
              <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[13px] font-medium">Email</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[13px] font-medium">Password</span>
              <input type="password" autoComplete="new-password" autoFocus value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" className={field} />
            </label>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-[color:var(--red)]">
            {error}
          </p>
        )}

        {invite ? (
          <button type="submit" disabled={busy} className="btn-light mt-6 w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {busy ? 'Setting up…' : 'Continue'}
          </button>
        ) : (
          error && (
            <button type="button" className="btn-quiet mt-6 w-full" onClick={() => go('/login')}>
              Go to log in
            </button>
          )
        )}
      </form>
    </div>
  );
}
