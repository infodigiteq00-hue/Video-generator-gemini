import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Loader2, Pencil, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { formatCost } from '../format';
import type { AppConfig, AspectRatio, DurationSeconds, ImageSize, Resolution } from '../types';

export interface Settings {
  aspectRatio: AspectRatio;
  resolution: Resolution;
  durationSeconds: DurationSeconds;
  imageSize: ImageSize;
}

interface Props {
  config: AppConfig | null;
  placeholder: string;
  /** Shown above the box while the next message is a change to an earlier post. */
  editing?: { title: string; onCancel: () => void } | null;
  draft?: { text: string; n: number };
  autoFocus?: boolean;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onSend: (text: string) => Promise<boolean>;
  /** Pick from these instead of typing; typing is only for describing a change. */
  festivals: string[];
}

function Seg<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="seg">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          disabled={o.disabled}
          title={o.title}
          className="seg-item mono-num"
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Composer({ config, placeholder, editing, draft, autoFocus, settings, onSettings, onSend, festivals }: Props) {
  const [festival, setFestival] = useState(festivals[0]);
  const [text, setText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    textRef.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);

  const sizes = config?.imageSizes ?? ['1K'];
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });

  const value = editing ? text.trim() : festival;
  async function submit() {
    if (!value || busy) return;
    setBusy(true);
    const ok = await onSend(value);
    setBusy(false);
    if (ok) setText('');
  }

  return (
    <div className="w-full">
      {showSettings && (
        <div className="glass appear mb-2 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[color:var(--text-3)]">Shape</span>
            <Seg
              label="Shape"
              value={settings.aspectRatio}
              onChange={(v) => set({ aspectRatio: v })}
              options={[
                { value: '9:16', label: '9:16 Reel' },
                { value: '16:9', label: '16:9 Wide' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[color:var(--text-3)]">Image</span>
            <Seg
              label="Image size"
              value={sizes.includes(settings.imageSize) ? settings.imageSize : sizes[sizes.length - 1]}
              onChange={(v) => set({ imageSize: v })}
              options={(['1K', '2K', '4K'] as ImageSize[]).map((z) => ({
                value: z,
                label: z,
                disabled: !sizes.includes(z),
                title: config?.image.pricePerImage[z] ? `about ${formatCost(config.image.pricePerImage[z]!)} per image` : 'Not supported',
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[color:var(--text-3)]">Video</span>
            <Seg
              label="Video length"
              value={settings.durationSeconds}
              onChange={(v) => set({ durationSeconds: v, resolution: v === 8 ? settings.resolution : '720p' })}
              options={([4, 6, 8] as DurationSeconds[]).map((d) => ({ value: d, label: `${d}s` }))}
            />
          </div>
        </div>
      )}

      {editing && (
        <div className="appear mb-2 flex items-center gap-2 rounded-2xl bg-white/[0.06] px-4 py-2.5 text-[13px] ring-1 ring-white/[0.08]">
          <Pencil className="h-3.5 w-3.5 text-[color:var(--violet)]" />
          <span className="min-w-0 flex-1 truncate">
            Changing <span className="font-medium">{editing.title}</span>
          </span>
          <button className="btn-ghost-icon h-6 w-6" aria-label="Cancel change" onClick={editing.onCancel}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className={`glass halo rounded-[26px] ${editing ? 'is-live' : ''}`}
      >
        {editing ? (
          <>
            <label htmlFor="prompt" className="sr-only">
              Describe the change
            </label>
            <textarea
              id="prompt"
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              maxLength={500}
              rows={1}
              placeholder={placeholder}
              className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-5 pt-4 text-[16px] leading-relaxed tracking-[-0.01em] text-[color:var(--text)] outline-none [field-sizing:content] placeholder:text-[color:var(--text-3)] focus-visible:outline-none"
            />
          </>
        ) : null}
        <div className="flex items-center gap-1.5 p-2">
          {!editing && (
            <div className="relative min-w-0 flex-1">
              <label htmlFor="festival" className="sr-only">
                Festival
              </label>
              <select
                id="festival"
                autoFocus={autoFocus}
                value={festival}
                onChange={(e) => setFestival(e.target.value)}
                className="block h-10 w-full cursor-pointer appearance-none truncate rounded-full bg-white/[0.05] pl-4 pr-9 text-[16px] font-medium tracking-[-0.01em] text-[color:var(--text)] outline-none ring-1 ring-white/[0.08] hover:bg-white/[0.08] focus-visible:ring-[color:var(--violet)]"
              >
                {festivals.map((f) => (
                  <option key={f} value={f} className="bg-neutral-900">
                    {f}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-3 h-4 w-4 text-[color:var(--text-2)]" />
            </div>
          )}
          <button
            type="button"
            aria-expanded={showSettings}
            className={`btn-ghost-icon h-10 w-10 shrink-0 ${showSettings ? 'bg-white/10 text-[color:var(--text)]' : ''}`}
            title="Shape, size and video length"
            aria-label="Settings"
            onClick={() => setShowSettings((v) => !v)}
          >
            <SlidersHorizontal className="h-[17px] w-[17px]" />
          </button>
          <span className="mono-num hidden whitespace-nowrap text-[12px] text-[color:var(--text-3)] sm:inline">
            {settings.aspectRatio === '9:16' ? '9:16 Reel' : '16:9 Wide'} · {settings.durationSeconds}s video
          </span>
          {editing ? (
            <button
              type="submit"
              disabled={!value || busy || !config}
              aria-label="Send change"
              title="Send (Enter)"
              className="press ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />}
            </button>
          ) : (
            <button type="submit" disabled={busy || !config} className="btn-light h-10 shrink-0 px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
