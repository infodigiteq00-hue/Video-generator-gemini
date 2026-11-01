import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Loader2, MessageCircle, Plus, QrCode, X } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, api } from '../api';
import type { Brand, Contact, User } from '../types';
import { APP_NAME } from '../config';
import { OFFER, priceNow, rupees, whatsappLink } from '../offer';
import { Logo } from './Logo';

interface Props {
  brand: Brand | null;
  onSaved: (b: Brand) => void;
  onClose: () => void;
  /** First visit: a full-screen welcome instead of a dialog. */
  asPage?: boolean;
  /** The signup funnel: the same questions, then payment, then a login instead of saving to an account. */
  signup?: boolean;
  onSignedUp?: (u: User) => void;
}

type StepKey = 'business' | 'products' | 'brand' | 'contact' | 'pay' | 'account';
const BUSINESS = { key: 'business', title: 'What does your business do?', hint: 'Every post is designed around your business, so tell us in a sentence or two.' } as const;
const PRODUCTS = { key: 'products', title: 'What should we feature?', hint: 'Add the products or services you want in your posts.' } as const;
const BRAND = { key: 'brand', title: 'Your name and logo', hint: 'Your name goes in the greeting. Upload your logo, or pick your brand colours if you don’t have one.' } as const;
const STEPS: { key: StepKey; title: string; hint: string }[] = [
  BUSINESS, PRODUCTS, BRAND,
  { key: 'contact', title: 'Contact details', hint: 'Optional. We add them in a bar at the bottom of your posts and on a closing card at the end of your videos.' },
];
const SIGNUP_STEPS: { key: StepKey; title: string; hint: string }[] = [
  BUSINESS, PRODUCTS, BRAND,
  { key: 'pay', title: `Pay ${rupees(priceNow())} by UPI`, hint: 'Scan the code with Google Pay, PhonePe, Paytm or any bank app.' },
  { key: 'account', title: 'Create your login', hint: 'Log in later with your email or mobile number.' },
];

// Tapping one fills the description with a starting sentence the client can edit.
const BUSINESSES: [string, string][] = [
  ['Jewellery', 'We design and sell jewellery'],
  ['Restaurant', 'We run a restaurant'],
  ['Sweets & bakery', 'We make sweets and baked goods'],
  ['Clothing', 'We design and sell clothing'],
  ['Clinic', 'We run a healthcare clinic'],
  ['Salon & spa', 'We run a salon and spa'],
  ['Real estate', 'We build and sell homes'],
  ['Manufacturing', 'We manufacture'],
  ['Electronics', 'We sell electronics and appliances'],
  ['Education', 'We run coaching classes'],
  ['Travel', 'We plan holidays and tours'],
  ['Finance', 'We offer financial services'],
];

const input =
  'w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-[16px] outline-none ring-1 ring-white/[0.08] placeholder:text-[color:var(--text-3)] focus:ring-[color:var(--violet)]';

export function BrandSetup({ brand, onSaved, onClose, asPage, signup, onSignedUp }: Props) {
  const steps = signup ? SIGNUP_STEPS : STEPS;
  const [step, setStep] = useState(0);
  const key = steps[step].key;
  const [login, setLogin] = useState({ email: '', phone: '', password: '' });
  const [industry, setIndustry] = useState(brand?.industry ?? '');
  const [website, setWebsite] = useState(brand?.website ?? '');
  const [featured, setFeatured] = useState<string[]>(brand?.featured ?? []);
  const [draft, setDraft] = useState('');
  const [name, setName] = useState(brand?.name ?? '');
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(brand?.logoUrl ?? null);
  const [contact, setContact] = useState<Contact>(brand?.contact ?? {});
  const [endCard, setEndCard] = useState(brand?.endCard ?? true);
  const [tagline, setTagline] = useState(brand?.tagline ?? '');
  const [colors, setColors] = useState<string[]>(brand?.colors?.length ? brand.colors.slice(0, 3) : ['#d4a017', '#7a1f2b', '#ffffff']);
  const [saved, setSaved] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const last = step === steps.length - 1;

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

  // Typed items are added on Enter or comma; pasting "a, b, c" adds all three.
  function addFeatured(text: string) {
    const items = text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (!items.length) return;
    const next = [...new Set([...featured, ...items])];
    if (next.length > 10) return setError('Up to 10 products or services.');
    setError(null);
    setFeatured(next);
    setDraft('');
  }

  // The first step that is missing something, so Continue and Save can send the client there.
  function problem(upTo: number): [number, string] | null {
    if (upTo >= 0 && !industry.trim()) return [0, 'Tell us what your business does. Every post is designed around it.'];
    if (upTo >= 1 && !featured.length && !draft.trim()) return [1, 'Add at least one product or service to feature.'];
    if (upTo >= 2 && !name.trim()) return [2, 'Tell us your business name.'];
    if (signup && upTo >= 4 && !login.email.trim() && !login.phone.trim()) return [4, 'Enter your email or mobile number to log in with.'];
    if (signup && upTo >= 4 && login.password.length < 6) return [4, 'Use a password of at least 6 characters.'];
    return null;
  }

  function next() {
    if (step === 1 && draft.trim()) addFeatured(draft);
    const p = problem(step);
    if (p) return setError(p[1]);
    setError(null);
    if (['contact', 'account'].includes(steps[step + 1].key) && !contact.website && website.trim()) setContact({ ...contact, website: website.trim() });
    setStep(step + 1);
  }

  async function save(withContact = true) {
    const items = draft.trim() ? [...new Set([...featured, ...draft.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)])] : featured;
    if (draft.trim()) addFeatured(draft);
    const p = problem(steps.length);
    if (p) {
      setStep(p[0]);
      return setError(p[1]);
    }
    const details = withContact ? contact : {};
    setBusy(true);
    setError(null);
    const input = {
      id: brand?.id,
      name: name.trim(),
      industry: industry.trim(),
      website: website.trim(),
      featured: items,
      tagline: tagline.trim(),
      contact: details,
      endCard: withContact && endCard,
      colors: preview ? [] : colors,
      logo,
    };
    try {
      if (signup) return onSignedUp?.(await api.signup({ ...input, ...login }));
      const b = await api.saveBrand(input);
      setSaved(b);
      onSaved(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const suggestions = (brand?.websiteProfile?.products ?? []).filter((p) => !featured.includes(p)).slice(0, 6);
  const contactLines = saved?.endCard ? [saved.contact?.phone, saved.contact?.email, saved.contact?.website, saved.contact?.address].filter(Boolean) : [];
  const field = (key: keyof Contact, label: string, placeholder: string, mode?: 'tel' | 'email' | 'url') => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <input
        value={contact[key] ?? ''}
        onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
        type={mode === 'email' ? 'email' : 'text'}
        inputMode={mode}
        maxLength={120}
        placeholder={placeholder}
        className={input}
      />
    </label>
  );

  return (
    <div
      className={asPage ? 'relative isolate grid h-full place-items-center overflow-y-auto overflow-x-hidden overscroll-contain p-4' : 'fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm'}
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

        {!saved && (
          <div className="mb-5 flex gap-1.5" role="tablist" aria-label="Setup steps">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`Step ${i + 1}: ${s.title}`}
                // New brands go forward with Continue; an existing brand can jump to any step.
                disabled={!brand && i > step}
                onClick={() => {
                  setError(null);
                  setStep(i);
                }}
                className="press h-1.5 flex-1 rounded-full disabled:cursor-default"
                style={{ background: i <= step ? 'var(--violet)' : 'rgba(255,255,255,0.1)' }}
              />
            ))}
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            {!saved && (
              <div className="mono-num mb-1 text-[12px] text-[color:var(--text-3)]">
                Step {step + 1} of {steps.length}
              </div>
            )}
            <h2 id="brand-title" className="text-[22px] font-semibold tracking-[-0.02em]">
              {saved ? 'Your brand is ready' : steps[step].title}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[color:var(--text-2)]">
              {saved ? 'Every post now uses your products, colours and logo.' : steps[step].hint}
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
              {saved.logoUrl && <img src={saved.logoUrl} alt="Logo" className="h-14 w-20 rounded-lg bg-white/90 object-contain p-1.5" />}
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{saved.name || 'Your business'}</div>
                <div className="truncate text-[12.5px] text-[color:var(--text-2)]">{saved.style}</div>
              </div>
            </div>
            {saved.colors.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[12px] text-[color:var(--text-3)]">{saved.logoUrl ? 'Colours we found in your logo' : 'Your brand colours'}</div>
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
            {(saved.featured?.length ?? 0) > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[12px] text-[color:var(--text-3)]">We’ll feature</div>
                <div className="flex flex-wrap gap-1.5">
                  {saved.featured!.map((p) => (
                    <span key={p} className="chip text-[11.5px]">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {saved.websiteProfile && (
              <div className="mt-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
                <div className="mb-1.5 text-[12px] text-[color:var(--text-3)]">What we learned from your website</div>
                <p className="text-[13.5px] leading-relaxed">{saved.websiteProfile.summary}</p>
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-[color:var(--text-2)]">
                  <span className="text-[color:var(--text)]">Style:</span> {saved.websiteProfile.visualStyle}
                </p>
              </div>
            )}
            {contactLines.length > 0 && (
              <div className="mt-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
                <div className="mb-1.5 text-[12px] text-[color:var(--text-3)]">Your videos end with</div>
                {contactLines.map((l) => (
                  <p key={l} className="text-[13.5px] leading-relaxed">
                    {l}
                  </p>
                ))}
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
              if (last || (brand && !signup)) void save();
              else next();
            }}
          >
            {key === 'business' && (
              <>
                <label className="block">
                  <span className="sr-only">What does your business do?</span>
                  <textarea
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    rows={3}
                    maxLength={500}
                    autoFocus
                    placeholder="We manufacture commercial printing machines for packaging companies"
                    className={`${input} resize-none`}
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {BUSINESSES.map(([label, sentence]) => (
                    <button
                      key={label}
                      type="button"
                      className="chip press hover:text-[color:var(--text)]"
                      onClick={() => setIndustry(industry.trim() ? industry : `${sentence} `)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">
                    Website <span className="font-normal text-[color:var(--text-3)]">(optional, our AI reads it to learn your style)</span>
                  </span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    inputMode="url"
                    maxLength={300}
                    placeholder="www.yourcompany.com"
                    className={input}
                  />
                </label>
              </>
            )}

            {key === 'products' && (
              <>
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => (e.target.value.includes(',') ? addFeatured(e.target.value) : setDraft(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.trim()) {
                        e.preventDefault();
                        addFeatured(draft);
                      } else if (e.key === 'Backspace' && !draft && featured.length) setFeatured(featured.slice(0, -1));
                    }}
                    maxLength={80}
                    autoFocus
                    aria-label="Product or service"
                    placeholder={featured.length ? 'Add another' : 'e.g. Bridal gold necklaces'}
                    className={input}
                  />
                  <button type="button" className="btn-quiet h-auto shrink-0 rounded-2xl px-4" disabled={!draft.trim()} onClick={() => addFeatured(draft)}>
                    <Plus className="h-4 w-4" /> Add
                  </button>
                </div>
                {featured.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {featured.map((p) => (
                      <span key={p} className="chip py-1 pr-1 text-[13px] text-[color:var(--text)]">
                        {p}
                        <button
                          type="button"
                          aria-label={`Remove ${p}`}
                          className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/10"
                          onClick={() => setFeatured(featured.filter((x) => x !== p))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {suggestions.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] text-[color:var(--text-3)]">From your website</div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((p) => (
                        <button key={p} type="button" className="chip press hover:text-[color:var(--text)]" onClick={() => addFeatured(p)}>
                          <Plus className="h-3 w-3" /> {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[12.5px] leading-relaxed text-[color:var(--text-3)]">
                  Press Enter after each one. Name them the way your customers would, like “Diamond rings” or “Home loans”.
                </p>
              </>
            )}

            {key === 'brand' && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Business name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Acme Prints" className={input} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">
                    Your tagline <span className="font-normal text-[color:var(--text-3)]">(optional, goes under the greeting)</span>
                  </span>
                  <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={100} placeholder="Precision is what we create. Trust is what we deliver." className={input} />
                </label>
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium">
                    Your logo <span className="font-normal text-[color:var(--text-3)]">(optional)</span>
                  </span>
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
                {preview ? (
                  <p className="text-[12.5px] text-[color:var(--text-3)]">We read your brand colours from your logo.</p>
                ) : (
                  <div>
                    <span className="mb-1.5 block text-[13px] font-medium">No logo? Pick your brand colours</span>
                    <div className="flex gap-3">
                      {colors.map((c, i) => (
                        <label key={i} className="press relative h-12 w-12 cursor-pointer overflow-hidden rounded-full ring-2 ring-white/15" style={{ background: c }}>
                          <span className="sr-only">Brand colour {i + 1}</span>
                          <input
                            type="color"
                            value={c}
                            onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))}
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {key === 'pay' && <Pay />}

            {key === 'account' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium">Mobile number</span>
                    <input value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" className={input} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium">or Email</span>
                    <input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} type="email" autoComplete="email" placeholder="you@yourcompany.com" className={input} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Password</span>
                  <input value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} type="password" autoComplete="new-password" placeholder="At least 6 characters" className={input} />
                </label>
                <div className="border-t border-white/[0.08] pt-5">
                  <p className="text-[14px] font-medium">Contact details for your posts</p>
                  <p className="mt-0.5 text-[12.5px] text-[color:var(--text-3)]">Optional. Shown in a bar at the bottom of your posts and at the end of your video.</p>
                </div>
              </>
            )}

            {(key === 'contact' || key === 'account') && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field('phone', 'Phone or WhatsApp', '+91 98765 43210', 'tel')}
                  {field('email', 'Email', 'hello@yourcompany.com', 'email')}
                </div>
                {field('website', 'Website', website.trim() || 'www.yourcompany.com', 'url')}
                {field('address', 'Address', 'Shop 12, MG Road, Pune')}
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]">
                  <input type="checkbox" checked={endCard} onChange={(e) => setEndCard(e.target.checked)} className="h-4 w-4 accent-[color:var(--violet)]" />
                  <span className="text-[13.5px]">Show these on my posts and videos</span>
                </label>
              </>
            )}

            {error && (
              <p role="alert" className="text-[13px] text-[color:var(--red)]">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              {(step > 0 || signup) && (
                <button type="button" className="btn-quiet h-11 px-4" disabled={busy} onClick={() => (setError(null), step > 0 ? setStep(step - 1) : onClose())} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              {last && !brand && !signup && (
                <button type="button" className="btn-quiet h-11 flex-1" disabled={busy} onClick={() => void save(false)}>
                  Skip
                </button>
              )}
              {brand && !signup && !last && (
                <button type="button" className="btn-quiet h-11 flex-1" disabled={busy} onClick={next}>
                  Next <ArrowRight className="h-4 w-4" />
                </button>
              )}
              <button type="submit" disabled={busy} className="btn-light h-11 flex-1">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {signup ? 'Creating your account…' : website.trim() ? 'Reading your logo and website…' : 'Reading your logo…'}
                  </>
                ) : brand && !signup ? (
                  'Save changes'
                ) : last ? (
                  signup ? 'Create my account' : 'Finish'
                ) : key === 'pay' ? (
                  <>
                    I’ve paid, continue <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** The payment step. The QR code and the automatic payment check are not ready yet: this shows where they go
 *  and what happens next. Accounts are created as "payment pending" and an admin unlocks them. */
function Pay() {
  const wa = whatsappLink(`Hi, I paid for the ${OFFER.pack} but I'm stuck`);
  return (
    <div className="space-y-5">
      <div className="mx-auto w-full max-w-[240px] rounded-3xl bg-white p-4 text-center text-black">
        <div className="grid aspect-square place-items-center rounded-2xl border-2 border-dashed border-black/15 bg-black/[0.03]">
          <div>
            <QrCode className="mx-auto h-16 w-16 text-black/30" strokeWidth={1.25} />
            <p className="mt-2 text-[12px] text-black/45">UPI QR code</p>
          </div>
        </div>
        <p className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">{rupees(priceNow())}</p>
        <p className="text-[12px] text-black/55">{OFFER.pack} · Digiteq Solutions</p>
      </div>
      <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
        <p className="text-[13.5px] font-medium">What happens next</p>
        <ol className="mt-2.5 space-y-2 text-[13.5px] leading-relaxed text-[color:var(--text-2)]">
          <li className="flex gap-2.5"><span className="mono-num text-[color:var(--text)]">1</span>Scan the code with any UPI app and pay {rupees(priceNow())}.</li>
          <li className="flex gap-2.5"><span className="mono-num text-[color:var(--text)]">2</span>Tap “I’ve paid” and create your login.</li>
          <li className="flex gap-2.5"><span className="mono-num text-[color:var(--text)]">3</span>We confirm your payment and your {OFFER.pack} unlocks. You’ll see it in your account straight away.</li>
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
