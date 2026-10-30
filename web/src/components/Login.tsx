import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { Logo } from './Logo';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      await api.login(email.trim(), password);
      onSignedIn();
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
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in</h1>
        <p className="mt-1 text-[14px] text-[color:var(--text-2)]">Festival posts and videos for your business.</p>

        <label className="mt-6 block">
          <span className="mb-1.5 block text-[13px] font-medium">Email</span>
          <input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-[color:var(--red)]">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-light mt-6 w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
