import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Menu, Sparkles, SquarePen } from 'lucide-react';
import { api } from './api';
import { APP_NAME } from './config';
import { upcoming, when } from './festivals';
import { useJobs } from './hooks/useJobs';
import type { AppConfig, Brand, Job, LogoPlace, PageId, Provider } from './types';
import { BrandSetup } from './components/BrandSetup';
import { FilmWall } from './components/FilmWall';
import { Logo } from './components/Logo';
import { Post, Waiting } from './components/Post';
import { Sidebar, type ChatSummary } from './components/Sidebar';
import { Soon } from './components/Soon';

const LEGACY = 'earlier';
const BRAND_KEY = 'digiteq.brandId';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: brand just won't be remembered */
    }
  },
};
const newId = () => crypto.randomUUID();

// Every post is a 9:16 reel: the image first, then an 8 second video made from it.
const FORMAT = { aspectRatio: '9:16', imageSize: '2K', resolution: '720p', durationSeconds: 8 } as const;

export default function App() {
  const [page, setPage] = useState<PageId>('chat');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('mock');
  const [chatId, setChatId] = useState<string>(newId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [busy, setBusy] = useState<{ request: string; since: string } | null>(null);
  const { jobs, upsert, remove } = useJobs();
  const festivals = useMemo(upcoming, []);
  const [festival, setFestival] = useState(festivals.suggested?.name ?? 'Diwali');

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        setConfig(c);
        setProvider(c.defaultProvider);
      })
      .catch((e: Error) => setOffline(e.message));
    // This browser's brand, else the company already saved on the server: never ask twice.
    const id = store.get(BRAND_KEY);
    (id ? api.getBrand(id) : Promise.reject())
      .catch(() => api.getBrand('current'))
      .then((b) => {
        setBrand(b);
        store.set(BRAND_KEY, b.id);
      })
      .catch(() => {})
      .finally(() => setBrandLoaded(true));
  }, []);

  // One post per chat id: the brand image plus the video made from it.
  const posts: ChatSummary[] = useMemo(
    () =>
      jobs
        .filter((j) => !j.auto)
        .map((j) => ({ id: j.chatId ?? LEGACY, title: j.title ?? j.request ?? j.prompt, updatedAt: j.updatedAt }))
        .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i),
    [jobs],
  );
  const mine = jobs.filter((j) => (j.chatId ?? LEGACY) === chatId);
  // The latest image in this post (a retry replaces it) and the video made from it.
  const image = mine.filter((j) => j.kind === 'image').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const video = (image && mine.filter((j) => j.kind === 'video' && j.sourceJobId === image.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]) || null;

  async function generate(input: { request?: string; changeOf?: string; change?: string; animate?: boolean }) {
    if (!brand) return;
    setBusy({ request: input.request ?? image?.request ?? 'festival', since: new Date().toISOString() });
    setOffline(null);
    try {
      const job = await api.createBrandPost({
        brandId: brand.id,
        chatId: chatId === LEGACY ? newId() : chatId,
        request: input.request ?? '',
        kind: 'video',
        changeOf: input.changeOf,
        change: input.change,
        animate: input.animate,
        ...FORMAT,
        provider,
      });
      upsert(job);
      if (job.chatId) setChatId(job.chatId);
    } catch (e) {
      setOffline(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  async function placeLogo(job: Job, place: LogoPlace | null) {
    try {
      upsert(await api.placeLogo(job.id, place));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Couldn’t place the logo.');
    }
  }

  if (!brandLoaded) return null;
  if (!brand) {
    return (
      <BrandSetup
        asPage
        brand={null}
        onClose={() => {}}
        onSaved={(b) => {
          setBrand(b);
          store.set(BRAND_KEY, b.id);
        }}
      />
    );
  }

  const open = (id: string) => {
    setChatId(id);
    setPage('chat');
    setMenuOpen(false);
  };
  const next = festivals.list.find((f) => f.name === festival);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        chats={posts}
        chatId={chatId}
        page={page}
        onNewChat={() => open(newId())}
        onOpenChat={open}
        onPage={(p) => {
          setPage(p);
          setMenuOpen(false);
        }}
        brand={brand}
        onEditBrand={() => {
          setBrandOpen(true);
          setMenuOpen(false);
        }}
      />
      {brandOpen && <BrandSetup brand={brand} onClose={() => setBrandOpen(false)} onSaved={setBrand} />}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 md:hidden">
          <button className="btn-ghost-icon" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu className="h-[18px] w-[18px]" />
          </button>
          <Logo size={22} />
          <span className="text-[14px] font-semibold">{APP_NAME}</span>
          <button className="btn-ghost-icon ml-auto" aria-label="New post" onClick={() => open(newId())}>
            <SquarePen className="h-[17px] w-[17px]" />
          </button>
        </header>

        {page !== 'chat' ? (
          <div className="flex-1 overflow-y-auto">
            <Soon page={page} onBack={() => setPage('chat')} />
          </div>
        ) : busy && !image ? (
          <div className="relative isolate grid flex-1 place-items-center overflow-y-auto px-4 py-10">
            <div className="aurora -z-10" />
            <Waiting request={busy.request} since={busy.since} />
          </div>
        ) : image ? (
          <div className="scrollbar-thin relative isolate grid flex-1 place-items-center overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-10">
            <div className="aurora -z-10" />
            <Post
              image={image}
              video={video}
              logoUrl={brand.logoUrl}
              onPlaceLogo={placeLogo}
              onRetry={() => void generate({ request: image.request ?? image.prompt })}
              onMakeVideo={() => void generate({ changeOf: image.id, change: 'Make it a video', animate: true })}
              onDelete={async () => {
                if (!confirm('Delete this post and its video? This can’t be undone.')) return;
                for (const j of mine) await remove(j.id).catch(() => {});
                open(newId());
              }}
            />
          </div>
        ) : (
          <div className="relative isolate flex flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-10">
            <div className="aurora -z-10" />
            <div className="absolute inset-0 -z-10">
              <FilmWall jobs={jobs} />
            </div>
            <div className="appear w-full max-w-2xl text-center">
              <img src={brand.logoUrl} alt={`${brand.name} logo`} className="mx-auto mb-6 h-14 max-w-[180px] rounded-xl bg-white/90 object-contain p-2" />
              <p className="text-[15px] text-[color:var(--text-2)]">What are we celebrating?</p>
              <label className="relative mx-auto mt-2 inline-flex max-w-full cursor-pointer items-center gap-2">
                <span className="sr-only">Festival</span>
                <span className="display serif truncate pr-[0.06em] text-[clamp(2.8rem,9vw,5.5rem)]">{festival}</span>
                <ChevronDown className="h-7 w-7 shrink-0 text-[color:var(--text-2)]" />
                <select
                  value={festival}
                  onChange={(e) => setFestival(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Choose a festival"
                >
                  {festivals.list.map((f) => (
                    <option key={`${f.name}-${f.date}`} value={f.name} className="bg-neutral-900">
                      {f.name} · {when(f)}
                    </option>
                  ))}
                </select>
              </label>
              {next && <p className="mono-num mt-3 text-[14px] text-[color:var(--text-2)]">{when(next)}</p>}
              <button className="btn-light mx-auto mt-9 h-12 px-7 text-[15px]" disabled={Boolean(busy) || !config} onClick={() => void generate({ request: festival })}>
                <Sparkles className="h-4 w-4" /> Generate my {festival} post
              </button>
              <p className="mx-auto mt-4 max-w-md text-[13.5px] leading-relaxed text-[color:var(--text-3)]">
                A custom post and video for {brand.name}, in your colours.
              </p>
              {offline && (
                <p role="alert" className="mt-3 text-[13px] text-[color:var(--red)]">
                  {offline}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
