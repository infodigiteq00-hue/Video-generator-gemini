import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, MessageCircle, RotateCcw, UserPlus } from 'lucide-react';
import { api } from '../api';
import type { AdminRedo, Customer } from '../types';

const field =
  'w-full rounded-2xl bg-white/[0.05] px-4 py-2.5 text-[15px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]';

/** Admin: customers, confirming their payments, and invite links for people who paid but couldn't sign up. */
export function Customers() {
  const [list, setList] = useState<Customer[] | null>(null);
  const [redos, setRedos] = useState<AdminRedo[]>([]);
  const [making, setMaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: '', phone: '' });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    void api.adminRedos().then(setRedos, () => {});
    return api.customers().then(setList, (e: Error) => setError(e.message));
  };

  async function approve(r: AdminRedo) {
    setMaking(r.id);
    await api.approveRedo(r.id).catch((e: Error) => setError(e.message));
    setMaking(null);
    await load();
  }
  useEffect(() => void load(), []);

  async function togglePaid(c: Customer) {
    await api.setPaid(c.id, !c.paid).catch((e: Error) => setError(e.message));
    await load();
  }

  async function makeInvite() {
    setBusy(true);
    setError(null);
    try {
      setLink((await api.invite(invite)).url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const phone = invite.phone.replace(/\D/g, '').slice(-10);
  const pending = list?.filter((c) => !c.paid).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Customers</h1>
      <p className="mt-1 text-[14px] text-[color:var(--text-2)]">
        {list ? `${list.length} accounts · ${pending} waiting for payment confirmation` : 'Loading…'}
      </p>

      {redos.length > 0 && (
        <section className="mt-6 rounded-3xl bg-[color:var(--amber)]/[0.07] p-5 ring-1 ring-[color:var(--amber)]/25">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <RotateCcw className="h-4 w-4" /> New design requests ({redos.length})
          </h2>
          <p className="mt-1 text-[13px] text-[color:var(--text-2)]">Check the payment came in, then make the new design. It appears in the customer’s post.</p>
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {redos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-medium">
                    {r.business ?? 'Customer'} · {r.festival}
                  </div>
                  <div className="truncate text-[12.5px] text-[color:var(--text-2)]">
                    {[r.phone, r.email].filter(Boolean).join(' · ')} · asked {new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <button className="btn-light h-9" disabled={making === r.id} onClick={() => void approve(r)}>
                  {making === r.id && <Loader2 className="h-4 w-4 animate-spin" />} Paid, make it
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <UserPlus className="h-4 w-4" /> Invite someone who paid
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-2)]">They get a link to set a password; their pack is unlocked and the setup opens on first login. Links work for 7 days.</p>
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void makeInvite();
          }}
        >
          <input className={field} type="tel" inputMode="tel" placeholder="Mobile number" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
          <input className={field} type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          <button className="btn-light h-11" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create link
          </button>
        </form>
        {link && (
          <div className="mt-4 rounded-2xl bg-black/30 p-3 ring-1 ring-white/[0.08]">
            <p className="break-all font-mono text-[12.5px] text-[color:var(--text-2)]">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn-quiet h-9"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(() => setCopied(true));
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
              </button>
              {phone.length === 10 && (
                <a
                  className="btn-quiet h-9"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://wa.me/91${phone}?text=${encodeURIComponent(`Your payment is confirmed! Set up your Diwali Pack here: ${link}`)}`}
                >
                  <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-[color:var(--red)]">
          {error}
        </p>
      )}

      <ul className="mt-6 divide-y divide-white/[0.06] rounded-3xl bg-white/[0.03] ring-1 ring-white/[0.06]">
        {list?.length === 0 && <li className="p-5 text-[14px] text-[color:var(--text-3)]">No customers yet.</li>}
        {list?.map((c) => (
          <CustomerRow key={c.id} c={c} onPaid={() => void togglePaid(c)} onChanged={() => void load()} />
        ))}
      </ul>
    </div>
  );
}

/** One customer: payment status, and login help (correct their mobile or email, or send a password reset link). */
function CustomerRow({ c, onPaid, onChanged }: { c: Customer; onPaid: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState({ phone: c.phone ?? '', email: c.email ?? '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const phone = (c.phone ?? '').replace(/\D/g, '').slice(-10);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api.updateLogin(c.id, login);
      setNote({ ok: true, text: 'Login updated. They can log in with the new details.' });
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function makeReset() {
    setBusy(true);
    setNote(null);
    try {
      setReset((await api.resetLink(c.id)).url);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{c.business ?? 'No business yet'}</div>
          <div className="truncate text-[12.5px] text-[color:var(--text-2)]">
            {[c.phone, c.email].filter(Boolean).join(' · ')} · {c.posts} posts · joined {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </div>
        </div>
        <button className="btn-quiet h-9" aria-expanded={open} onClick={() => setOpen(!open)}>
          <KeyRound className="h-4 w-4" /> Login help
        </button>
        <button className={c.paid ? 'btn-quiet h-9' : 'btn-light h-9'} onClick={onPaid}>
          {c.paid ? (
            <>
              <Check className="h-4 w-4 text-[color:var(--green)]" /> Paid
            </>
          ) : (
            'Mark paid'
          )}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-2xl bg-black/20 p-4 ring-1 ring-white/[0.06]">
          <p className="text-[13px] text-[color:var(--text-2)]">Typed their mobile or email wrong? Correct it here.</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className={field} type="tel" inputMode="tel" placeholder="Mobile number" value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} />
            <input className={field} type="email" placeholder="Email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} />
            <button className="btn-light h-11" disabled={busy} onClick={() => void save()}>
              Save login
            </button>
          </div>
          <div className="border-t border-white/[0.06] pt-3">
            <p className="text-[13px] text-[color:var(--text-2)]">Forgot or mistyped their password? Send them a link to set a new one (works once, for 3 days).</p>
            {!reset ? (
              <button className="btn-quiet mt-2 h-9" disabled={busy} onClick={() => void makeReset()}>
                <KeyRound className="h-4 w-4" /> Create password reset link
              </button>
            ) : (
              <div className="mt-2 rounded-xl bg-black/30 p-3 ring-1 ring-white/[0.08]">
                <p className="break-all font-mono text-[12px] text-[color:var(--text-2)]">{reset}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="btn-quiet h-9"
                    onClick={() => {
                      void navigator.clipboard.writeText(reset).then(() => setCopied(true));
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
                  </button>
                  {phone.length === 10 && (
                    <a
                      className="btn-quiet h-9"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://wa.me/91${phone}?text=${encodeURIComponent(`Here's your link to set a new password for Digiteq Studio: ${reset}`)}`}
                    >
                      <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
          {note && <p className={`text-[13px] ${note.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>{note.text}</p>}
        </div>
      )}
    </li>
  );
}
