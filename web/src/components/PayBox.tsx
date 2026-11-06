import { MessageCircle, QrCode } from 'lucide-react';
import { rupees, whatsappLink } from '../offer';

/** A payment (`stuck`: a WhatsApp help message, only for customers who have already paid for the pack): the UPI QR code (a placeholder until real payments are set up), the amount, and what happens next.
 *  Payments are confirmed by an admin for now. */
export function PayBox({ amount, label, steps, stuck }: { amount: number; label: string; steps: string[]; stuck?: string }) {
  const wa = stuck ? whatsappLink(stuck) : null;
  return (
    <div className="space-y-5">
      <div className="mx-auto w-full max-w-[240px] rounded-3xl bg-white p-4 text-center text-black">
        <div className="grid aspect-square place-items-center rounded-2xl border-2 border-dashed border-black/15 bg-black/[0.03]">
          <div>
            <QrCode className="mx-auto h-16 w-16 text-black/30" strokeWidth={1.25} />
            <p className="mt-2 text-[12px] text-black/45">UPI QR code</p>
          </div>
        </div>
        <p className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">{rupees(amount)}</p>
        <p className="text-[12px] text-black/55">{label} · Digiteq Solutions</p>
      </div>
      <div className="rounded-2xl bg-white/[0.04] p-4 text-left ring-1 ring-white/[0.06]">
        <p className="text-[13.5px] font-medium">What happens next</p>
        <ol className="mt-2.5 space-y-2 text-[13.5px] leading-relaxed text-[color:var(--text-2)]">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-2.5">
              <span className="mono-num text-[color:var(--text)]">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 text-[13px] text-[color:var(--text-2)] hover:text-[color:var(--text)]">
          <MessageCircle className="h-4 w-4" /> Paid but stuck? Message us on WhatsApp
        </a>
      )}
    </div>
  );
}
