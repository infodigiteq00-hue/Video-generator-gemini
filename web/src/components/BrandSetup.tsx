import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, X } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, api } from '../api';
import type { Brand } from '../types';
import { APP_NAME } from '../config';
import { Logo } from './Logo';

interface Props {
  brand: Brand | null;
  onSaved: (b: Brand) => void;
  onClose: () => void;
  /** First visit: a full-screen welcome instead of a dialog. */
  asPage?: boolean;
}

export function BrandSetup({ brand, onSaved, onClose, asPage }: Props) {
  const [name, setName] = useState(brand?.name ?? '');
  const [industry, setIndustry] = useState(brand?.industry ?? '');
  const [website, setWebsite] = useState(brand?.website ?? '');
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(brand?.logoUrl ?? null);
  const [saved, setSaved] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!logo) return;
    const url = URL.createObjectURL(logo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !asPage && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, asPage]);

  function pick(f?: File | null) {
    if (!f) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) return setError('Use a PNG, JPEG or WebP logo. PNG with a transparent background looks best.');
    if (f.size > MAX_IMAGE_BYTES) return setError('Logo must be under 10 MB.');
    setError(null);
    setLogo(f);
  }

  async function save() {
    if (!name.trim()) return setError('Tell us your business name.');
    if (!industry.trim()) return setError('Tell us what your business does. Every post is designed around it.');
    if (!logo && !brand) return setError('Upload your logo.');
    setBusy(true);
    setError(null);
    try {
      const b = await api.saveBrand({ id: brand?.id, name: name.trim(), industry: industry.trim(), website: website.trim(), logo });
      setSaved(b);
      onSaved(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={asPage ? 'relative isolate grid h-full place-items-center overflow-y-auto overscroll-contain p-4' : 'fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm'}
      onClick={asPage ? undefined : onClose}
    >
      {asPage && <div className="aurora -z-10" />}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-title"
        onClick={(e) => e.stopPropagation()}
        className="glass appear w-full max-w-lg rounded-[28px] p-6 sm:p-7"
      >
        {asPage && !saved && (
          <div className="mb-5 flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="brand-title" className="text-[22px] font-semibold tracking-[-0.02em]">
              {saved ? 'Your brand is ready' : brand ? 'Edit your brand' : 'Festival posts for your business'}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--text-2)]">
              {saved
                ? 'Every post now uses these colours and your logo.'
                : brand
                  ? 'Update your name, logo or business details.'
                  : 'Tell us about your business and upload your logo. Then just type a festival, like “Diwali”.'}
            </p>
          </div>
          {!asPage && (
            <button className="btn-ghost-icon -mr-1 -mt-1" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {saved ? (
          <div className="mt-6">
            <div className="flex items-center gap-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
              <img src={saved.logoUrl} alt="Logo" className="h-14 w-20 rounded-lg bg-white/90 object-contain p-1.5" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{saved.name || 'Your business'}</div>
                <div className="truncate text-[12.5px] text-[color:var(--text-2)]">{saved.style}</div>
              </div>
            </div>
            {saved.colors.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[12px] text-[color:var(--text-3)]">Colours we found in your logo</div>
                <div className="flex flex-wrap gap-2">
                  {saved.colors.map((c) => (
                    <span key={c} className="chip mono-num">
                      <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20" style={{ background: c }} />
                      {c.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {saved.websiteProfile && (
              <div className="mt-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
                <div className="mb-1.5 text-[12px] text-[color:var(--text-3)]">What we learned from your website</div>
                <p className="text-[13.5px] leading-relaxed">{saved.websiteProfile.summary}</p>
                {saved.websiteProfile.products.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {saved.websiteProfile.products.slice(0, 6).map((p) => (
                      <span key={p} className="chip text-[11.5px]">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-[color:var(--text-2)]">
                  <span className="text-[color:var(--text)]">Style:</span> {saved.websiteProfile.visualStyle}
                </p>
              </div>
            )}
            {saved.websiteError && (
              <p className="mt-4 rounded-2xl bg-[color:var(--amber)]/10 px-4 py-3 text-[12.5px] leading-relaxed text-[color:var(--amber)]">
                {saved.websiteError}. Your posts will use your description and logo instead. Some sites block automatic readers; you
                can try again later under Edit.
              </p>
            )}
            <button className="btn-light mt-6 w-full" onClick={onClose}>
              <Check className="h-4 w-4" /> Start making posts
            </button>
          </div>
        ) : (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">
                Business name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                placeholder="Acme Prints"
                className="w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium">Your logo</span>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pick(e.dataTransfer.files[0]);
                }}
                className="press flex w-full items-center gap-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"
              >
                {preview ? (
                  <img src={preview} alt="Logo preview" className="h-14 w-20 rounded-lg bg-white/90 object-contain p-1.5" />
                ) : (
                  <span className="grid h-14 w-14 place-items-center rounded-xl bg-white/[0.06]">
                    <ImagePlus className="h-5 w-5 text-[color:var(--text-2)]" />
                  </span>
                )}
                <span className="text-[13px] leading-snug text-[color:var(--text-2)]">
                  {preview ? 'Click to change' : 'Drop your logo here or click to upload'}
                  <br />
                  <span className="text-[12px] text-[color:var(--text-3)]">PNG with a transparent background works best</span>
                </span>
              </button>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">
                What does your business do?
              </span>
              <textarea
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="We manufacture commercial printing machines"
                className="w-full resize-none rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">
                Website <span className="font-normal text-[color:var(--text-3)]">(optional, our AI reads it to learn your products and style)</span>
              </span>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                inputMode="url"
                maxLength={300}
                placeholder="www.yourcompany.com"
                className="w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]"
              />
            </label>

            {error && (
              <p role="alert" className="text-[13px] text-[color:var(--red)]">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-light w-full">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {website.trim() ? 'Reading your logo and website…' : 'Reading your logo…'}
                </>
              ) : (
                brand ? 'Save changes' : 'Continue'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
