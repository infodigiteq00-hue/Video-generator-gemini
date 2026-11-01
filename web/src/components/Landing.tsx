import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, CalendarClock, Check, Clock, Download, Film, Image as ImageIcon, MessageCircle, Palette, Phone, RefreshCcw,
  ShieldCheck, Sparkles, Star, Stamp, Store, Timer, Wand2,
} from 'lucide-react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { nextDate } from '../festivals';
import { go } from '../Gate';
import { OFFER, launchOn, priceNow, rupees, whatsappLink } from '../offer';
import { Logo } from './Logo';

// Keep in step with PACK in server/src/index.js.
const PACK = [
  { name: 'Dhanteras', video: false },
  { name: 'Diwali', video: true },
  { name: 'Hindu New Year', video: false },
  { name: 'Bhai Dooj', video: false },
  { name: 'Labh Pancham', video: false },
];

const BUSINESSES = ['Jewellers', 'Sweet shops', 'Manufacturers', 'Clinics', 'Boutiques', 'Restaurants', 'Builders', 'Electronics', 'Coaching classes', 'CA firms', 'Salons', 'Traders'];

// Posts and videos made for our clients. `video` plays while it's on screen.
const SAMPLES = [
  { video: '/samples/diwali-tinita.mp4', poster: '/samples/diwali-tinita.webp', label: 'Diwali · Heat exchangers' },
  { video: '/samples/diwali-steelcon.mp4', poster: '/samples/diwali-steelcon.webp', label: 'Diwali · Steel components' },
  { video: '/samples/diwali-subhasri.mp4', poster: '/samples/diwali-subhasri.webp', label: 'Diwali · Pigments' },
  { video: null, poster: '/samples/bhai-dooj-subhasri.webp', label: 'Bhai Dooj · Pigments' },
  { video: '/samples/dussehra-subhasri.mp4', poster: '/samples/dussehra-subhasri.webp', label: 'Dussehra · Pigments' },
  { video: '/samples/navratri-subhasri.mp4', poster: '/samples/navratri-subhasri.webp', label: 'Navratri · Pigments' },
];

// Each sample's position in the hero fan, by its distance from the centre (others wait hidden behind).
const FAN: Record<number, string> = {
  [-1]: 'z-20 opacity-100 [transform:translate(-112%,8%)_rotate(-9deg)_scale(0.88)]',
  0: 'z-30 opacity-100 [transform:translate(-50%,0)]',
  1: 'z-20 opacity-100 [transform:translate(12%,8%)_rotate(9deg)_scale(0.88)]',
};
const HIDDEN = 'z-10 opacity-0 [transform:translate(-50%,10%)_scale(0.7)]';
const FAN_VIDEOS = SAMPLES.filter((s) => s.video);

/** The hero's fanned posts: the centre video plays, and when it ends the next one swings into the middle. */
function HeroFan() {
  const [i, setI] = useState(0);
  const n = FAN_VIDEOS.length;
  const next = () => setI((x) => (x + 1) % n);
  // If a phone blocks autoplay, still move on now and then.
  useEffect(() => {
    const t = setTimeout(next, 16000);
    return () => clearTimeout(t);
  }, [i]);
  return (
    <>
      {FAN_VIDEOS.map((s, k) => {
        const d = ((k - i + n + 1) % n) - 1; // -1 left, 0 centre, 1 right
        const centre = d === 0;
        return (
          <button
            key={s.poster}
            type="button"
            tabIndex={centre ? -1 : 0}
            aria-label={centre ? s.label : `Show ${s.label}`}
            onClick={() => !centre && setI(k)}
            className={`absolute left-1/2 top-0 w-[50%] overflow-hidden rounded-2xl transition-[transform,opacity] duration-700 [transition-timing-function:var(--spring)] ${FAN[d] ?? HIDDEN} ${
              centre ? 'cursor-default shadow-[0_30px_80px_-20px_rgba(255,140,60,0.55)] ring-1 ring-[#ffb347]/40' : 'shadow-2xl ring-1 ring-white/10'
            }`}
          >
            <img src={s.poster} alt={s.label} className="block aspect-[9/16] w-full object-cover" />
            {centre && (
              <>
                <video key={i} src={s.video!} poster={s.poster} autoPlay muted playsInline onEnded={next} className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider backdrop-blur">
                  <Film className="h-3 w-3" /> Video
                </span>
              </>
            )}
          </button>
        );
      })}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5" aria-hidden>
        {FAN_VIDEOS.map((s, k) => (
          <span key={s.poster} className={`h-1.5 rounded-full transition-all duration-500 ${k === i ? 'w-5 bg-[#ffb347]' : 'w-1.5 bg-white/25'}`} />
        ))}
      </div>
    </>
  );
}

/** A muted looping video that only loads and plays while it's on screen. */
function InView({ src, poster, className }: { src: string; poster: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.4 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" className={className} />;
}

const FAQ = [
  ['Do I need a designer or any design skills?', 'No. Answer three questions about your business, upload your logo, and tap Generate on each festival. That’s it.'],
  ['Will it look like a template everyone else is using?', 'No. Every post is designed fresh for your business, around the products and services you tell us about, in your brand colours.'],
  ['What exactly do I get for ' + rupees(OFFER.price) + '?', `${PACK.length} festival posts: ${PACK.map((f) => f.name).join(', ')}. Diwali also comes as a video that ends with your contact details. All in 9:16, ready for WhatsApp status, Instagram and Facebook.`],
  ['What if I don’t like a design?', 'Every festival comes with one free redo, so you can get a completely new design.'],
  ['I don’t have a logo. Can I still use it?', 'Yes. Pick your brand colours instead and we design around them.'],
  ['How do I pay?', 'By UPI, with any app: Google Pay, PhonePe, Paytm or your bank app. Once your payment is confirmed, your pack unlocks.'],
  ['How fast will I get my posts?', 'A post takes a few minutes and the video a couple more. You can make each festival’s post as soon as your pack unlocks.'],
] as const;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function left(to: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Countdown({ to, now, className = 'justify-center' }: { to: string; now: number; className?: string }) {
  const t = left(to, now);
  return (
    <div className={`flex items-center gap-1.5 ${className}`} aria-label={`${t.d} days ${t.h} hours ${t.m} minutes left`}>
      {(
        [
          [t.d, 'days'],
          [t.h, 'hrs'],
          [t.m, 'min'],
          [t.s, 'sec'],
        ] as const
      ).map(([v, u]) => (
        <div key={u} className="min-w-[58px] rounded-2xl bg-white/[0.06] px-2 py-2 text-center ring-1 ring-white/[0.08]">
          <div className="mono-num text-[22px] font-semibold leading-none tracking-[-0.03em]">{pad(v)}</div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--text-3)]">{u}</div>
        </div>
      ))}
    </div>
  );
}

function Cta({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={() => go('/start')}
      className={`press inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#ffb347,#ff7a3d)] px-7 text-[16.5px] font-semibold text-[#1a0d00] shadow-[0_12px_40px_-8px_rgba(255,140,60,0.65)] hover:brightness-105 ${className}`}
    >
      {children}
    </button>
  );
}

function Section({ kicker, title, children, id }: { kicker?: string; title: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-14 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      {kicker && <p className="mb-3 text-center text-[12.5px] font-semibold uppercase tracking-[0.16em] text-[#ffb347]">{kicker}</p>}
      <h2 className="mx-auto max-w-2xl text-balance text-center text-[clamp(1.75rem,6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em]">{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

export function Landing() {
  const now = useNow();
  const price = priceNow();
  const launch = launchOn();
  const diwali = nextDate('Diwali');
  const [taken, setTaken] = useState<number | null>(null);
  const [sticky, setSticky] = useState(false);
  const hero = useRef<HTMLDivElement>(null);
  const wa = whatsappLink(`Hi, I have a question about the ${OFFER.pack}`);
  const reviews = OFFER.testimonials;
  const rating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  useEffect(() => {
    api.publicStats().then((s) => setTaken(s.paid), () => {});
  }, []);

  // The sticky price bar appears once the hero's button has scrolled out of view.
  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSticky(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const pack = PACK.map((f) => ({ ...f, date: nextDate(f.name)?.date ?? null }));
  const showTaken = taken !== null && taken >= OFFER.showTakenFrom;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain bg-[color:var(--bg)]">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[rgba(5,5,6,0.75)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2.5 px-4 sm:px-6 lg:h-16 lg:px-8">
          <Logo size={24} />
          <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
          <nav className="ml-8 hidden items-center gap-6 text-[14px] text-[color:var(--text-2)] lg:flex">
            {[
              ['#pack', 'The pack'],
              ['#how', 'How it works'],
              ['#price', 'Pricing'],
              ['#faq', 'FAQ'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="hover:text-[color:var(--text)]">
                {label}
              </a>
            ))}
          </nav>
          <button className="btn-quiet ml-auto h-9" onClick={() => go('/login')}>
            Log in
          </button>
          <Cta className="hidden h-10 px-5 text-[14px] shadow-none md:inline-flex">
            Get my {OFFER.pack} · {rupees(price)}
          </Cta>
        </div>
      </header>

      {/* ---- Hero ---- */}
      <section className="relative isolate overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-[-20%] -z-10 h-[680px] bg-[radial-gradient(60%_50%_at_50%_30%,rgba(255,150,60,0.28),transparent_70%)]" />
        {/* Phones: one column. Desktop: the pitch and the price on the left, the posts on the right. */}
        <div className="mx-auto grid max-w-6xl px-4 pb-14 pt-10 text-center sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-x-12 lg:px-8 lg:pb-24 lg:pt-20 lg:text-left">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffb347]/10 px-3 py-1.5 text-[12.5px] font-medium text-[#ffc56e] ring-1 ring-[#ffb347]/25">
            <Sparkles className="h-3.5 w-3.5" /> Diwali {diwali ? new Date(diwali.date).getFullYear() : ''} · {launch ? 'Launch offer' : OFFER.pack}
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-balance text-[clamp(2.4rem,10vw,4.6rem)] lg:mx-0 lg:text-[clamp(3.4rem,5.2vw,4.9rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
            Your Diwali posts, designed for <span className="serif bg-[linear-gradient(135deg,#ffd27a,#ff8a3d)] bg-clip-text pr-[0.08em] font-normal text-transparent">your business.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[16.5px] leading-relaxed text-[color:var(--text-2)] lg:mx-0 lg:text-[18px]">
            Tell us what you sell. Our AI designs {PACK.length} festival posts and a Diwali video with <b className="font-medium text-[color:var(--text)]">your products</b>,{' '}
            <b className="font-medium text-[color:var(--text)]">your colours</b> and <b className="font-medium text-[color:var(--text)]">your logo</b>. Ready for WhatsApp and Instagram in minutes.
          </p>
          </div>

          <div className="relative mx-auto mt-10 h-[340px] w-full max-w-[420px] sm:h-[420px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:h-[600px] lg:max-w-[540px]">
            <HeroFan />
          </div>

          <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
          <div ref={hero} className="mt-10 flex flex-col items-center lg:mt-8 lg:items-start">
            <div className="flex items-baseline gap-3">
              <span className="text-[44px] font-semibold tracking-[-0.04em]">{rupees(price)}</span>
              {launch && <span className="text-[20px] text-[color:var(--text-3)] line-through">{rupees(OFFER.regularPrice)}</span>}
              <span className="text-[14px] text-[color:var(--text-2)]">for all {PACK.length} festivals</span>
            </div>
            <Cta className="mt-4 w-full max-w-sm">
              Get my {OFFER.pack} <ArrowRight className="h-5 w-5" />
            </Cta>
            <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 lg:justify-start gap-y-1 text-[12.5px] text-[color:var(--text-3)]">
              <span>Pay by UPI</span>·<span>Ready in minutes</span>·<span>No designer needed</span>
            </p>
          </div>

          {diwali && (
            <div className="mx-auto mt-10 max-w-sm rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07] lg:mx-0 lg:mt-8 lg:max-w-md">
              <p className="mb-3 flex items-center justify-center gap-1.5 text-[13px] text-[color:var(--text-2)] lg:justify-start">
                <Timer className="h-4 w-4 text-[#ffb347]" /> Diwali is on {dateLabel(diwali.date)}. Your customers are already scrolling.
              </p>
              <Countdown to={`${diwali.date}T00:00:00`} now={now} className="justify-center lg:justify-start" />
            </div>
          )}
          </div>
        </div>
      </section>

      {/* ---- Who it's for ---- */}
      <div className="border-y border-white/[0.06] bg-white/[0.02] py-4">
        <p className="mb-3 text-center text-[12px] uppercase tracking-[0.16em] text-[color:var(--text-3)]">Made for every business</p>
        <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:justify-center sm:flex-wrap">
          {BUSINESSES.map((b) => (
            <span key={b} className="chip shrink-0 py-1.5 text-[13px]">
              <Store className="h-3.5 w-3.5" /> {b}
            </span>
          ))}
        </div>
      </div>

      {/* ---- The problem ---- */}
      <Section kicker="Every festival, the same story" title={<>Your post goes out late, looks like everyone else’s, <span className="text-[color:var(--text-3)]">or doesn’t go out at all.</span></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [Clock, 'Your designer is fully booked', 'Everyone wants their Diwali post the same week. Yours waits in the queue.'],
            [ImageIcon, 'Templates look like everyone else’s', 'Your customers see the same diya and the same font from five other shops.'],
            [CalendarClock, 'It goes out after the festival', 'By the time it’s ready, the moment has passed and so has the attention.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Clock;
            return (
              <div key={title as string} className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
                <I className="h-5 w-5 text-[color:var(--red)]" />
                <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{title as string}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--text-2)]">{body as string}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-[20px] font-semibold tracking-[-0.02em]">
          Not this Diwali. <span className="text-[#ffb347]">Yours is ready before anyone else’s.</span>
        </p>
      </Section>

      {/* ---- Samples ---- */}
      <Section kicker="Made by Digiteq" title="Real posts, made for real businesses">
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
          {SAMPLES.map((s) => (
            <figure key={s.poster} className="w-[62%] shrink-0 snap-center sm:w-auto">
              {s.video ? (
                <InView src={s.video} poster={s.poster} className="aspect-[9/16] w-full rounded-2xl bg-black object-cover ring-1 ring-white/10" />
              ) : (
                <img src={s.poster} alt={s.label} loading="lazy" className="aspect-[9/16] w-full rounded-2xl object-cover ring-1 ring-white/10" />
              )}
              <figcaption className="mt-2 text-center text-[12.5px] text-[color:var(--text-2)]">{s.label}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* ---- The pack ---- */}
      <Section id="pack" kicker={`The ${OFFER.pack}`} title={<>{PACK.length} festivals. {PACK.length} posts. <span className="serif font-normal text-[#ffc56e]">One Diwali video.</span></>}>
        <ol className="mx-auto max-w-md space-y-2.5 lg:grid lg:max-w-none lg:grid-cols-5 lg:gap-3 lg:space-y-0">
          {pack.map((f) => (
            <li key={f.name} className={`relative flex items-center gap-3 rounded-2xl p-4 ring-1 lg:flex-col lg:items-start lg:gap-5 lg:rounded-3xl lg:p-5 ${f.video ? 'bg-[#ffb347]/[0.08] ring-[#ffb347]/30' : 'bg-white/[0.03] ring-white/[0.06]'}`}>
              <div className="w-14 shrink-0 text-center lg:w-auto lg:text-left">
                <div className="mono-num text-[20px] font-semibold leading-none lg:text-[34px]">{f.date ? new Date(`${f.date}T00:00:00`).getDate() : '–'}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-[color:var(--text-3)]">
                  {f.date ? new Date(`${f.date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }) : ''}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold tracking-[-0.01em]">{f.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[color:var(--text-2)]">
                  <ImageIcon className="h-3.5 w-3.5" /> Post
                  {f.video && (
                    <>
                      <span>+</span>
                      <Film className="h-3.5 w-3.5 text-[#ffb347]" /> <span className="text-[#ffc56e]">Video with your contact details</span>
                    </>
                  )}
                </div>
              </div>
              <Check className="h-5 w-5 shrink-0 text-[color:var(--green)] lg:absolute lg:right-5 lg:top-5" />
            </li>
          ))}
        </ol>
      </Section>

      {/* ---- How it works ---- */}
      <Section id="how" kicker="How it works" title="Ready in 3 steps. About 2 minutes of your time.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [Store, 'Tell us about your business', 'What you do, what you sell, your name and logo. Three quick questions.'],
            [Phone, `Pay ${rupees(price)} by UPI`, 'Google Pay, PhonePe, Paytm or any bank app.'],
            [Wand2, 'Tap Generate. Download. Post.', 'Each festival’s post is designed in minutes, with your logo where you want it.'],
          ].map(([Icon, title, body], i) => {
            const I = Icon as typeof Store;
            return (
              <div key={i} className="relative rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
                <span className="mono-num absolute right-5 top-4 text-[40px] font-semibold leading-none text-white/[0.06]">{i + 1}</span>
                <I className="h-5 w-5 text-[#ffb347]" />
                <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{title as string}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--text-2)]">{body as string}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Why it's different ---- */}
      <Section kicker="Why businesses choose it" title="Not a template. A post that could only be yours.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            [Store, 'Your real products', 'Designed around what you actually sell.'],
            [Palette, 'Your brand colours', 'Read straight from your logo.'],
            [Stamp, 'Your logo, your way', 'Drag it exactly where you want.'],
            [Phone, 'Your contact details on every post', 'Customers know how to reach you.'],
            [Download, 'WhatsApp & Instagram ready', '9:16, sharp, download in one tap.'],
            [RefreshCcw, 'A free redo', 'Don’t love it? Get a new design.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Store;
            return (
              <div key={title as string} className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
                <I className="h-5 w-5 text-[#ffb347]" />
                <h3 className="mt-2.5 text-[14.5px] font-semibold leading-snug tracking-[-0.01em]">{title as string}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--text-2)]">{body as string}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Reviews (only once there are real ones) ---- */}
      {reviews.length > 0 && (
        <Section kicker="What customers say" title={<>Rated {rating.toFixed(1)} out of 5</>}>
          <div className="mb-8 flex justify-center gap-1 text-[#ffb347]">
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} className="h-6 w-6" fill={i < Math.round(rating) ? 'currentColor' : 'none'} />
            ))}
          </div>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {reviews.map((r) => (
              <blockquote key={r.name} className="w-[80%] max-w-sm shrink-0 snap-center rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.06]">
                <div className="flex gap-0.5 text-[#ffb347]">
                  {Array.from({ length: r.rating }, (_, i) => (
                    <Star key={i} className="h-4 w-4" fill="currentColor" />
                  ))}
                </div>
                <p className="mt-3 text-[15px] leading-relaxed">“{r.quote}”</p>
                <footer className="mt-4 text-[13px] text-[color:var(--text-2)]">
                  <b className="font-medium text-[color:var(--text)]">{r.name}</b> · {r.business}
                </footer>
              </blockquote>
            ))}
          </div>
        </Section>
      )}

      {/* ---- Pricing ---- */}
      <Section id="price" kicker={launch ? 'Launch offer' : 'Pricing'} title="Everything for Diwali, one simple price">
        <div className="relative mx-auto max-w-md overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,rgba(255,179,71,0.14),rgba(255,255,255,0.03))] p-6 ring-1 ring-[#ffb347]/30 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{OFFER.pack}</h3>
              <p className="mt-1 text-[13.5px] text-[color:var(--text-2)]">{PACK.map((f) => f.name).join(' · ')}</p>
            </div>
            {launch && (
              <span className="shrink-0 rounded-full bg-[color:var(--green)]/15 px-2.5 py-1 text-[12px] font-semibold text-[color:var(--green)]">
                Save {rupees(OFFER.regularPrice - OFFER.price)}
              </span>
            )}
          </div>
          <div className="mt-6 flex items-baseline gap-3">
            <span className="text-[52px] font-semibold leading-none tracking-[-0.045em]">{rupees(price)}</span>
            {launch && <span className="text-[20px] text-[color:var(--text-3)] line-through">{rupees(OFFER.regularPrice)}</span>}
          </div>
          <p className="mt-1 text-[13px] text-[color:var(--text-3)]">One-time payment. No subscription.</p>
          <ul className="mt-6 space-y-2.5 text-[14.5px]">
            {[
              `${PACK.length} custom festival posts`,
              'A Diwali video with your contact details at the end',
              'Your products, colours and logo in every design',
              'One free redo for every festival',
              'Download in one tap, ready for WhatsApp & Instagram',
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--green)]" /> {t}
              </li>
            ))}
          </ul>
          <Cta className="mt-7 w-full">
            Get my {OFFER.pack} <ArrowRight className="h-5 w-5" />
          </Cta>
          {launch && (
            <div className="mt-5 space-y-3">
              <div>
                <p className="mb-2 text-center text-[12.5px] text-[color:var(--text-2)]">Launch price ends {dateLabel(OFFER.launchEnds)}</p>
                <Countdown to={`${OFFER.launchEnds}T23:59:59`} now={now} />
              </div>
              <div>
                <p className="mb-1.5 flex justify-between text-[12.5px] text-[color:var(--text-2)]">
                  <span>Only for the first {OFFER.seats} businesses</span>
                  {showTaken && (
                    <span className="mono-num">
                      {taken}/{OFFER.seats} taken
                    </span>
                  )}
                </p>
                {showTaken && (
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#ffb347,#ff7a3d)]" style={{ width: `${Math.min(100, (taken! / OFFER.seats) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-[color:var(--text-3)]">
            <ShieldCheck className="h-3.5 w-3.5" /> UPI payment · Made in India
          </p>
        </div>
      </Section>

      {/* ---- FAQ ---- */}
      <Section id="faq" kicker="Questions" title="Good to know">
        <div className="mx-auto max-w-2xl divide-y divide-white/[0.06] rounded-3xl bg-white/[0.03] ring-1 ring-white/[0.06] lg:grid lg:max-w-5xl lg:grid-cols-2 lg:items-start lg:gap-3 lg:divide-y-0 lg:bg-transparent lg:ring-0">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 lg:rounded-3xl lg:bg-white/[0.03] lg:ring-1 lg:ring-white/[0.06]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                {q}
                <span className="text-[20px] leading-none text-[color:var(--text-3)] transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2.5 text-[14px] leading-relaxed text-[color:var(--text-2)]">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ---- Final push ---- */}
      <section className="relative isolate overflow-hidden px-4 pb-32 pt-10 text-center md:pb-24">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_100%,rgba(255,150,60,0.22),transparent_70%)]" />
        <h2 className="mx-auto max-w-xl text-balance text-[clamp(1.75rem,6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em]">
          This Diwali, your customers will see a hundred greetings. <span className="text-[#ffb347]">Make yours the one they remember.</span>
        </h2>
        <Cta className="mt-8 w-full max-w-sm">
          Get my {OFFER.pack} for {rupees(price)} <ArrowRight className="h-5 w-5" />
        </Cta>
        <p className="mt-10 text-[12px] text-[color:var(--text-3)]">© {new Date().getFullYear()} Digiteq Solutions</p>
      </section>

      {/* ---- Sticky price bar (phones) and WhatsApp ---- */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t md:hidden border-white/[0.08] bg-[rgba(10,10,12,0.92)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:var(--spring)] ${sticky ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[20px] font-semibold tracking-[-0.03em]">{rupees(price)}</span>
              {launch && <span className="text-[13px] text-[color:var(--text-3)] line-through">{rupees(OFFER.regularPrice)}</span>}
            </div>
            <div className="truncate text-[12px] text-[color:var(--text-2)]">{OFFER.pack} · {PACK.length} posts + video</div>
          </div>
          <Cta className="h-12 shrink-0 px-5 text-[15px]">
            Get it now <ArrowRight className="h-4 w-4" />
          </Cta>
        </div>
      </div>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          aria-label="Chat with us on WhatsApp"
          className={`press fixed right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-[#25d366] text-white shadow-lg transition-[bottom] duration-500 ${sticky ? 'bottom-24 md:bottom-5' : 'bottom-5'}`}
        >
          <MessageCircle className="h-6 w-6" />
        </a>
      )}
    </div>
  );
}
