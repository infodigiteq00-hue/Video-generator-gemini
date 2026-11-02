import { ChevronRight, Film, Image as ImageIcon, Loader2, Lock, Sparkles } from 'lucide-react';
import { nextDate, when } from '../festivals';
import { isActiveStatus, type Brand, type Job, type Pack } from '../types';

interface Props {
  pack: Pack;
  brand: Brand;
  paid: boolean;
  /** This account's jobs */
  jobs: Job[];
  busy: boolean;
  error: string | null;
  onGenerate: (festival: string) => void;
  onOpen: (chatId: string) => void;
}

/** A customer's home: the festivals in their pack, each with its post (or a Generate button). */
export function PackHome({ pack, brand, paid, jobs, busy, error, onGenerate, onOpen }: Props) {
  const festivals = pack.festivals
    .map((name) => ({ name, date: nextDate(name), video: pack.video.includes(name) }))
    .sort((a, b) => (a.date?.date ?? '9').localeCompare(b.date?.date ?? '9'));

  return (
    <div className="appear mx-auto w-full max-w-xl">
      <div className="mb-6 text-center">
        {brand.logoUrl && <img src={brand.logoUrl} alt={`${brand.name} logo`} className="mx-auto mb-4 h-12 max-w-[160px] rounded-xl bg-white/90 object-contain p-2" />}
        <h1 className="text-[clamp(1.6rem,6vw,2.2rem)] font-semibold tracking-[-0.03em]">Your {pack.name}</h1>
        <p className="mt-1 text-[14px] text-[color:var(--text-2)]">
          {pack.festivals.length} personalised festival posts for {brand.name}, {pack.video.length} of them videos.
        </p>
      </div>

      <ol className="space-y-2.5">
        {festivals.map((f) => {
          // The latest design for this festival, if any.
          const made = jobs.filter((j) => j.kind === 'image' && j.request === f.name && j.status !== 'failed').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const latest = made[0];
          const open = latest?.chatId ? () => onOpen(latest.chatId!) : undefined;
          return (
            <li key={f.name}>
              <div className={`flex items-center gap-3 rounded-3xl p-3 ring-1 ${f.video ? 'bg-[#ffb347]/[0.07] ring-[#ffb347]/25' : 'bg-white/[0.03] ring-white/[0.06]'}`}>
                <button
                  className="press relative h-[84px] w-[48px] shrink-0 overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-white/10 disabled:cursor-default"
                  disabled={!open}
                  onClick={open}
                  aria-label={open ? `Open your ${f.name} post` : undefined}
                >
                  {latest?.status === 'succeeded' && latest.outputUrl ? (
                    <img src={latest.outputUrl} alt="" className="h-full w-full object-cover" />
                  ) : latest ? (
                    <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-[color:var(--text-2)]" />
                  ) : f.video ? (
                    <Film className="absolute inset-0 m-auto h-4 w-4 text-[#ffb347]" />
                  ) : (
                    <ImageIcon className="absolute inset-0 m-auto h-4 w-4 text-[color:var(--text-3)]" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold tracking-[-0.01em]">{f.name}</div>
                  <div className="mt-0.5 text-[12.5px] text-[color:var(--text-2)]">
                    {f.date ? when(f.date) : ''} · {f.video ? 'Video post' : 'Photo post'}
                  </div>
                </div>
                {!paid ? (
                  <Lock className="mr-2 h-4 w-4 shrink-0 text-[color:var(--text-3)]" aria-label="Locked until payment is confirmed" />
                ) : latest ? (
                  <button className="btn-quiet h-9 shrink-0" onClick={open}>
                    {isActiveStatus(latest.status) ? 'Creating…' : 'Open'} <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button className="btn-light h-9 shrink-0" disabled={busy} onClick={() => onGenerate(f.name)}>
                    <Sparkles className="h-4 w-4" /> Generate
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="mt-4 text-center text-[13px] text-[color:var(--red)]">
          {error}
        </p>
      )}
    </div>
  );
}
