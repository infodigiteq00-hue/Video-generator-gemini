import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Image as ImageIcon, RotateCcw, Stamp, Trash2, Wand2 } from 'lucide-react';
import { formatCost, formatElapsed } from '../format';
import type { Job, LogoPlace } from '../types';
import { LogoEditor } from './LogoEditor';
import { Logo } from './Logo';

export interface Note {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  /** Buttons under an assistant message ("Image" / "Video", "Brighter colours"…). */
  actions?: NoteAction[];
}

export interface NoteAction {
  label: string;
  icon?: typeof Copy;
  primary?: boolean;
  run: () => void;
}

/** A row of chips under an assistant message. */
export function Actions({ actions, compact }: { actions: NoteAction[]; compact?: boolean }) {
  const size = compact ? ' h-7 gap-1.5 px-2.5 text-[12px]' : '';
  return (
    <div className={compact ? 'flex flex-wrap gap-1.5' : 'mt-3 flex flex-wrap gap-2'}>
      {actions.map((a) => (
        <button key={a.label} className={(a.primary ? 'btn-light' : 'btn-quiet') + size} onClick={a.run}>
          {a.icon && <a.icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />} {a.label}
        </button>
      ))}
    </div>
  );
}

export type Item = { type: 'job'; job: Job; createdAt: string } | { type: 'note'; note: Note; createdAt: string };

interface Handlers {
  onAnimate: (job: Job) => void;
  onRetry: (job: Job) => void;
  onDelete: (job: Job) => void;
  onMediaLoad: () => void;
  logoUrl: string | null;
  /** Job whose logo editor is open */
  logoJobId: string | null;
  onLogoEdit: (job: Job | null) => void;
  onPlaceLogo: (job: Job, place: LogoPlace | null) => Promise<void>;
}

function useElapsed(job: Job) {
  const active = job.status === 'queued' || job.status === 'running';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return active ? (now - new Date(job.createdAt).getTime()) / 1000 : job.elapsedSeconds;
}

function UserBubble({ text, imageUrl, fromAbove }: { text: string; imageUrl?: string | null; fromAbove?: boolean }) {
  return (
    <div className="appear flex flex-col items-end gap-2">
      {imageUrl && !fromAbove && <img src={imageUrl} alt="Attached" className="max-h-44 rounded-2xl object-cover ring-1 ring-white/10" />}
      <div className="max-w-[85%] rounded-[22px] rounded-br-md bg-white/[0.08] px-4 py-2.5 text-[15px] leading-relaxed text-[color:var(--text)] ring-1 ring-white/[0.06]">
        {fromAbove && (
          <span className="mb-1 flex items-center gap-1.5 text-[12px] text-[color:var(--text-2)]">
            <ImageIcon className="h-3 w-3" /> Using the image above
          </span>
        )}
        {text}
      </div>
    </div>
  );
}

function Assistant({ children }: { children: React.ReactNode }) {
  return (
    <div className="appear flex gap-3 sm:gap-4">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] ring-1 ring-white/10">
        <Logo size={18} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Action({ icon: Icon, label, onClick, href, download, disabled, title }: {
  icon: typeof Copy;
  label: string;
  onClick?: () => void;
  href?: string;
  download?: string;
  disabled?: boolean;
  title?: string;
}) {
  const cls = 'press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-[color:var(--text-2)] hover:bg-white/[0.08] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent';
  return href ? (
    <a className={cls} href={href} download={download}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </a>
  ) : (
    <button className={cls} onClick={onClick} disabled={disabled} title={title}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function JobResult({ job, h }: { job: Job; h: Handlers }) {
  const elapsed = useElapsed(job);
  const editingLogo = h.logoJobId === job.id && Boolean(h.logoUrl);
  const [place, setPlace] = useState<LogoPlace | null>(null);
  const [saving, setSaving] = useState(false);
  const src = editingLogo && job.cleanUrl ? job.cleanUrl : job.outputUrl;
  async function saveLogo(p: LogoPlace | null) {
    setSaving(true);
    await h.onPlaceLogo(job, p);
    setSaving(false);
  }
  const active = job.status === 'queued' || job.status === 'running';
  const portrait = job.aspectRatio === '9:16';
  const isVideo = job.kind === 'video';
  const meta = [
    isVideo ? 'Video' : 'Image',
    isVideo && `${job.durationSeconds}s`,
    isVideo && job.resolution,
    !isVideo && job.imageSize,
    job.aspectRatio,
    job.provider === 'mock' && 'Demo',
    job.estimatedCost > 0 && formatCost(job.estimatedCost),
  ].filter(Boolean);

  return (
    <Assistant>
      {job.title && !job.auto && <p className="mb-1 text-[16px] font-semibold tracking-[-0.01em]">{job.title}</p>}
      <p className="mb-3 text-[15px] leading-relaxed text-[color:var(--text)]">
        {job.status === 'failed'
          ? `I couldn't make that ${isVideo ? 'video' : 'image'}.`
          : active
            ? isVideo
              ? job.auto
                ? 'Now turning it into a video. This takes a minute or two.'
                : job.imageUrl
                  ? 'Animating your image. Videos take a minute or two.'
                  : 'Rendering your video. This usually takes a minute or two.'
              : job.brandId
                ? 'Designing your post in your brand colours…'
                : 'Creating your image…'
            : isVideo
              ? job.auto
                ? 'And here’s the video.'
                : 'Here’s your video.'
              : job.brandId
                ? job.makesVideo && !job.followUpError
                  ? 'Here’s your post. The video comes next.'
                  : 'Here’s your post.'
                : 'Here’s your image. Want it moving? Hit Animate.'}
      </p>

      <div className="relative" style={{ maxWidth: portrait ? 300 : 640 }}>
        {job.status === 'succeeded' && isVideo && job.outputUrl && (
          <video src={job.outputUrl} autoPlay muted loop playsInline aria-hidden className="ambient h-full w-full rounded-[32px] object-cover" />
        )}
        {job.status === 'succeeded' && !isVideo && job.outputUrl && (
          <img src={job.outputUrl} alt="" aria-hidden className="ambient h-full w-full rounded-[32px] object-cover" />
        )}
        <div
          className={`halo relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 ${active ? 'is-live' : ''}`}
          style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9' }}
        >
          {job.status === 'succeeded' && job.outputUrl ? (
            isVideo ? (
              <video src={src!} controls={!editingLogo} autoPlay muted loop playsInline onLoadedData={h.onMediaLoad} className="h-full w-full object-cover" />
            ) : (
              <a href={src!} target="_blank" rel="noreferrer" aria-label="Open full size">
                <img src={src!} alt={job.prompt} onLoad={h.onMediaLoad} className="h-full w-full object-cover" />
              </a>
            )
          ) : active ? (
            <div className="rendering-bg grain absolute inset-0 grid place-items-center">
              {job.imageUrl && <img src={job.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-[2px]" />}
              <div className="relative text-center">
                {isVideo ? (
                  <div className="mono-num text-[clamp(2rem,6vw,3.25rem)] font-semibold tracking-[-0.04em]">{formatElapsed(elapsed)}</div>
                ) : (
                  <ImageIcon className="mx-auto h-8 w-8 text-white/80" strokeWidth={1.5} />
                )}
                <div className="mx-auto mt-4 h-[2px] w-32 overflow-hidden rounded-full bg-white/10">
                  <div className="scan h-full w-1/2" />
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#0b0b0e] p-6 text-center">
              <div className="max-w-sm">
                <AlertTriangle className="mx-auto mb-2.5 h-5 w-5 text-[color:var(--red)]" />
                <p className="text-[13px] leading-relaxed text-[color:var(--text-2)]">{job.error ?? 'Unknown error'}</p>
              </div>
            </div>
          )}
          {editingLogo && (
            <LogoEditor logoUrl={h.logoUrl!} initial={job.logo ?? null} onChange={setPlace} />
          )}
        </div>
      </div>

      {editingLogo ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[12.5px] text-[color:var(--text-2)]">Drag your logo, pull the corner to resize.</span>
          <button className="btn-light h-8 px-3.5 text-[12.5px]" disabled={saving} onClick={() => void saveLogo(place ?? job.logo ?? { x: 0.72, y: 0.04, w: 0.24 })}>
            <Check className="h-3.5 w-3.5" /> {saving ? 'Applying…' : 'Apply logo'}
          </button>
          <button className="btn-quiet h-8 text-[12.5px]" disabled={saving} onClick={() => void saveLogo(null)}>
            <Trash2 className="h-3.5 w-3.5" /> No logo
          </button>
          <button className="btn-quiet h-8 text-[12.5px]" disabled={saving} onClick={() => h.onLogoEdit(null)}>
            Cancel
          </button>
        </div>
      ) : (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-0.5 gap-y-1">
        <span className="mono-num mr-2 text-[12px] text-[color:var(--text-3)]">{meta.join(' · ')}</span>
        {job.status === 'failed' && (
          <button className="btn-light h-8 px-3.5 text-[12.5px]" onClick={() => h.onRetry(job)}>
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
        {job.followUpError && <span className="mr-2 text-[12px] text-[color:var(--red)]">{job.followUpError}</span>}
        {job.followUpError && (
          <button className="btn-light h-8 px-3.5 text-[12.5px]" onClick={() => h.onAnimate(job)}>
            <Wand2 className="h-3.5 w-3.5" /> Make the video
          </button>
        )}
        {job.status === 'succeeded' && job.brandId && h.logoUrl && (
          <Action icon={Stamp} label={job.logo ? 'Move logo' : 'Place logo'} onClick={() => h.onLogoEdit(job)} />
        )}
        {job.outputUrl && <Action icon={Download} label="Download" href={`${job.outputUrl}?download=1`} download={`digiteq-${job.id.slice(0, 8)}${isVideo ? '.mp4' : ''}`} />}
        <Action icon={Trash2} label="Delete" onClick={() => h.onDelete(job)} />
      </div>
      )}
    </Assistant>
  );
}

export function Thread({ items, h, after }: { items: Item[]; h: Handlers; after?: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-10 pt-8 sm:px-6">
      {items.map((item) =>
        item.type === 'job' ? (
          <div key={item.job.id} className="flex flex-col gap-6">
            {!item.job.auto && (
              <UserBubble text={item.job.request ?? item.job.prompt} imageUrl={item.job.imageUrl} fromAbove={Boolean(item.job.sourceJobId)} />
            )}
            <JobResult job={item.job} h={h} />
          </div>
        ) : item.note.role === 'user' ? (
          <UserBubble key={item.note.id} text={item.note.text} />
        ) : (
          <Assistant key={item.note.id}>
            <p className="text-[15px] leading-relaxed text-[color:var(--text)]">{item.note.text}</p>
            {item.note.actions && <Actions actions={item.note.actions} />}
          </Assistant>
        ),
      )}
      {after && <Assistant>{after}</Assistant>}
    </div>
  );
}
