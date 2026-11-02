import { useState } from 'react';
import { ArrowRight, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { OFFER, rupees } from '../offer';
import type { Pack } from '../types';
import { Logo } from './Logo';
import { PayBox } from './PayBox';

interface Props {
  pack: Pack;
  /** Through PhonePe, or the placeholder QR an admin confirms. */
  online: boolean;
  price: number;
  /** 'wait' while PhonePe confirms after the customer comes back; 'failed' if it didn't go through. */
  state: 'wait' | 'failed' | null;
  error: string | null;
  onPay: () => Promise<void>;
}

/** Right after creating the account, before the business details: paying for the pack. */
export function PayScreen({ pack, online, price, state, error, onPay }: Props) {
  const [opening, setOpening] = useState(false);
  return (
    <div className="relative isolate grid h-full place-items-center overflow-y-auto overflow-x-hidden overscroll-contain p-4">
      <div className="aurora -z-10" />
      <div className="glass appear w-full max-w-md rounded-[28px] p-6 sm:p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
          <button
            className="btn-ghost-icon ml-auto"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void api.logout().finally(() => window.dispatchEvent(new Event('auth:expired')))}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {state === 'wait' ? (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[color:var(--green)]" />
            <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em]">Confirming your payment</h1>
            <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--text-2)]">PhonePe is confirming it. This page moves on by itself in a moment.</p>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-[color:var(--green)]">Account created · last step</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">Complete your payment</h1>
            <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--text-2)]">
              Your {pack.name}: {pack.festivals.length} personalised festival posts, {pack.video.length} of them videos. After paying, tell us about your business and create your posts.
            </p>
            {online ? (
              <>
                <div className="mt-5 flex items-baseline gap-2.5">
                  <span className="text-[38px] font-semibold tracking-[-0.04em]">{rupees(price)}</span>
                  {price < OFFER.regularPrice && <span className="text-[16px] text-[color:var(--text-3)] line-through">{rupees(OFFER.regularPrice)}</span>}
                </div>
                {state === 'failed' && <p className="mt-2 text-[13px] text-[color:var(--red)]">Your payment didn’t go through. You can try again.</p>}
                {error && <p className="mt-2 text-[13px] text-[color:var(--red)]">{error}</p>}
                <button
                  className="press mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[color:var(--green)] text-[15.5px] font-semibold text-black hover:brightness-105 disabled:opacity-60"
                  disabled={opening}
                  onClick={async () => {
                    setOpening(true);
                    await onPay();
                    setOpening(false);
                  }}
                >
                  {opening && <Loader2 className="h-4 w-4 animate-spin" />} {opening ? 'Opening secure payment…' : `Pay ${rupees(price)} now`} {!opening && <ArrowRight className="h-4 w-4" />}
                </button>
                <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-[color:var(--text-2)]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--green)]" />
                  UPI, Google Pay, PhonePe, cards or netbanking, processed securely by PhonePe for Digiteq Solutions.
                </p>
              </>
            ) : (
              <div className="mt-5">
                <PayBox
                  amount={price}
                  label={pack.name}
                  stuck={`Hi, I paid for the ${pack.name}. Can you confirm my payment?`}
                  steps={[`Scan the code with any UPI app and pay ${rupees(price)}.`, 'We confirm your payment.', 'This page moves on by itself: then tell us about your business.']}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
