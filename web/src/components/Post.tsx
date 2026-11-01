import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Download, Film, Image as ImageIcon, RotateCcw, Stamp, Trash2 } from 'lucide-react';
import { formatElapsed } from '../format';
import { isActiveStatus, type Job, type LogoPlace } from '../types';
import { LogoEditor } from './LogoEditor';

interface Props {
  /** The brand post (image) and the video made from it, if started. */
  image: Job;
  video: Job | null;
  logoUrl: string | null;
  onPlaceLogo: (job: Job, place: LogoPlace | null) => Promise<void>;
  onRetry: () => void;
  /** Customers' remaining new designs for this festival; null = no limit (admins) */
  redosLeft: number | null;
  onRedo: () => void;
  onMakeVideo: () => void;
  onDelete: () => void;
  /** Back to the customer's pack (absent for admins) */
  back?: { label: string; run: () => void };
}

function useElapsed(since: string, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return (now - new Date(since).getTime()) / 1000;
}

/** Full-screen wait while the post is designed: no chat, just what is happening and how long it takes.
 *  Shown from the click, before the image job exists (the idea is written first). */
export function Waiting({ request, since, image, video }: { request: string; since: string; image?: Job | null; video?: Job | null }) {
  const elapsed = useElapsed(since, true);
  const steps = [
    { label: 'Writing the idea for your business', done: Boolean(image) },
    { label: 'Designing your post', done: image?.status === 'succeeded' },
    { label: 'Turning it into a video', done: video?.status === 'succeeded' },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="appear mx-auto w-full max-w-md text-center">
      <div className="mono-num text-[clamp(2.4rem,8vw,3.5rem)] font-semibold tracking-[-0.04em]">{formatElapsed(elapsed)}</div>
      <div className="mx-auto mt-4 h-[2px] w-40 overflow-hidden rounded-full bg-white/10">
        <div className="scan h-full w-1/2" />
      </div>
      <h1 className="mt-8 text-[22px] font-semibold tracking-[-0.02em]">Creating your {request} post</h1>
      <ol className="mx-auto mt-6 max-w-xs space-y-3 text-left">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex items-center gap-3 text-[14px] ${i > current ? 'text-[color:var(--text-3)]' : ''}`}>
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.done ? 'bg-[color:var(--green)] text-black' : i === current ? 'ring-2 ring-[color:var(--violet)]' : 'ring-1 ring-white/20'}`}
            >
              {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mx-auto mt-8 max-w-sm rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-2)] ring-1 ring-white/[0.06]">
        This takes a few minutes. Please keep the app open; your post appears here as soon as it’s ready.
      </p>
    </div>
  );
}

/** One finished (or rendering) result with its logo placement and download. */
function Media({ job, label, logoUrl, onPlaceLogo }: { job: Job; label: string; logoUrl: string | null; onPlaceLogo: Props['onPlaceLogo'] }) {
  const [editing, setEditing] = useState(false);
  const [place, setPlace] = useState<LogoPlace | null>(null);
  const [saving, setSaving] = useState(false);
  const active = isActiveStatus(job.status);
  const elapsed = useElapsed(job.createdAt, active);
  const isVideo = job.kind === 'video';
  const src = editing && job.cleanUrl ? job.cleanUrl : job.outputUrl;

  async function save(p: LogoPlace | null) {
    setSaving(true);
    await onPlaceLogo(job, p);
    setSaving(false);
    setEditing(false);
  }

  return (
    <figure className="appear w-full max-w-[340px]">
      <figcaption className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-[color:var(--text-2)]">
        {isVideo ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />} {label}
      </figcaption>
      <div className={`halo relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 ${active ? 'is-live' : ''}`} style={{ aspectRatio: job.aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}>
        {job.status === 'succeeded' && src ? (
          isVideo ? (
            <video src={src} controls={!editing} autoPlay muted loop playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={src} alt={job.title ?? 'Your post'} className="h-full w-full object-cover" />
          )
        ) : active ? (
          <div className="rendering-bg grain absolute inset-0 grid place-items-center">
            {job.imageUrl && <img src={job.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-[2px]" />}
            <div className="relative text-center">
              <div className="mono-num text-[2rem] font-semibold tracking-[-0.04em]">{formatElapsed(elapsed)}</div>
              <p className="mt-2 text-[13px] text-white/80">Making your video…</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[#0b0b0e] p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-2.5 h-5 w-5 text-[color:var(--red)]" />
              <p className="text-[13px] leading-relaxed text-[color:var(--text-2)]">{job.error ?? 'Something went wrong'}</p>
            </div>
          </div>
        )}
        {editing && logoUrl && <LogoEditor logoUrl={logoUrl} initial={job.logo ?? null} onChange={setPlace} />}
      </div>

      {job.status === 'succeeded' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {editing ? (
            <>
              <button className="btn-light h-9" disabled={saving} onClick={() => void save(place ?? job.logo ?? { x: 0.72, y: 0.04, w: 0.24 })}>
                <Check className="h-4 w-4" /> {saving ? 'Applying…' : 'Apply logo'}
              </button>
              <button className="btn-quiet h-9" disabled={saving} onClick={() => void save(null)}>
                No logo
              </button>
              <button className="btn-quiet h-9" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {logoUrl && (
                <button className={job.logo ? 'btn-quiet h-9' : 'btn-light h-9'} onClick={() => setEditing(true)}>
                  <Stamp className="h-4 w-4" /> {job.logo ? 'Move logo' : 'Place your logo'}
                </button>
              )}
              <a className={job.logo || !logoUrl ? 'btn-light h-9' : 'btn-quiet h-9'} href={`/api/jobs/${job.id}/download`} download>
                <Download className="h-4 w-4" /> Download
              </a>
            </>
          )}
        </div>
      )}
      {editing && <p className="mt-2 text-[12.5px] text-[color:var(--text-3)]">Drag your logo, pull the corner to resize.</p>}
    </figure>
  );
}

export function Post({ image, video, logoUrl, onPlaceLogo, onRetry, redosLeft, onRedo, onMakeVideo, onDelete, back }: Props) {
  // Until the image is in, there's nothing to look at: show the wait screen.
  if (isActiveStatus(image.status)) return <Waiting request={image.request ?? 'festival'} since={image.createdAt} image={image} video={video} />;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {back && (
        <button className="btn-quiet mb-5 h-9" onClick={back.run}>
          <ArrowLeft className="h-4 w-4" /> {back.label}
        </button>
      )}
      <div className="mb-6 text-center">
        <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-semibold tracking-[-0.03em]">{image.title ?? image.request}</h1>
      </div>

      {image.status === 'failed' ? (
        <div className="mx-auto max-w-sm text-center">
          <p className="text-[14px] text-[color:var(--text-2)]">{image.error ?? 'We couldn’t make this post.'}</p>
          <button className="btn-light mt-4" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:justify-center">
          <Media job={image} label="Your post" logoUrl={logoUrl} onPlaceLogo={onPlaceLogo} />
          {video ? (
            <Media job={video} label="Your video" logoUrl={logoUrl} onPlaceLogo={onPlaceLogo} />
          ) : image.followUpError ? (
            <div className="w-full max-w-[340px] text-center sm:pt-24">
              <p className="text-[13px] text-[color:var(--text-2)]">{image.followUpError}</p>
              <button className="btn-light mt-3" onClick={onMakeVideo}>
                <Film className="h-4 w-4" /> Make the video
              </button>
            </div>
          ) : null}
        </div>
      )}
      {video && isActiveStatus(video.status) && (
        <p className="mx-auto mt-6 max-w-sm text-center text-[13px] leading-relaxed text-[color:var(--text-3)]">
          Your video takes a minute or two. Please keep the app open.
        </p>
      )}
      <div className="mt-10 flex flex-col items-center gap-3">
        {image.status === 'succeeded' && !(video && isActiveStatus(video.status)) && redosLeft !== 0 && (
          <button className="btn-quiet h-10" onClick={onRedo}>
            <RotateCcw className="h-4 w-4" /> Try a different design{redosLeft !== null && ` (${redosLeft} left)`}
          </button>
        )}
        {redosLeft === null && (
          <button className="btn-quiet h-8 text-[12.5px] text-[color:var(--text-3)]" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete this post
          </button>
        )}
      </div>
    </div>
  );
}
