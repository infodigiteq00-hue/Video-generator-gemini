import { MessageCircle, Phone } from 'lucide-react';
import { OFFER, supportLabel, whatsappLink } from '../offer';

/** Our team's number for questions or help, as Call and WhatsApp buttons. */
export function Support({ text = 'Questions or need help?', message = `Hi, I have a question about the ${OFFER.pack}`, className = '' }: { text?: string; message?: string; className?: string }) {
  const wa = whatsappLink(message);
  return (
    <div className={`text-center text-[13px] text-[color:var(--text-2)] ${className}`}>
      <p>
        {text} Talk to our team: <b className="mono-num whitespace-nowrap font-medium text-[color:var(--text)]">{supportLabel()}</b>
      </p>
      <div className="mt-2 flex justify-center gap-2">
        <a href={`tel:+91${OFFER.support}`} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-[13px] font-medium text-[color:var(--text)] ring-1 ring-white/[0.08] hover:bg-white/[0.1]">
          <Phone className="h-3.5 w-3.5" /> Call
        </a>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#25d366]/15 px-3.5 text-[13px] font-medium text-[#5ee08f] ring-1 ring-[#25d366]/30 hover:bg-[#25d366]/25">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
