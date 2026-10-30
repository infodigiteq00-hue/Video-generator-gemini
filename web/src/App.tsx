import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, LayoutTemplate, Menu, Pencil, SquarePen, Stamp, Sun, Type } from 'lucide-react';
import { api } from './api';
import { APP_NAME } from './config';
import { formatCost } from './format';
import { useJobs } from './hooks/useJobs';
import { detectKind } from './intent';
import type { AppConfig, Brand, Job, Kind, LogoPlace, PageId, Provider } from './types';
import { BrandSetup } from './components/BrandSetup';
import { Composer, type Settings } from './components/Composer';
import { FilmWall } from './components/FilmWall';
import { Logo } from './components/Logo';
import { Sidebar, type ChatSummary } from './components/Sidebar';
import { Soon } from './components/Soon';
import { Actions, Thread, type Item, type Note } from './components/Thread';

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

const FESTIVALS = [
  'Diwali', 'Dhanteras', 'Bhai Dooj', 'Chhath Puja', 'Guru Nanak Jayanti', 'Christmas', 'New Year',
  'Lohri', 'Makar Sankranti', 'Pongal', 'Republic Day', 'Vasant Panchami', 'Maha Shivratri', 'Holi',
  'Gudi Padwa', 'Ugadi', 'Ram Navami', 'Eid al-Fitr', 'Baisakhi', 'Akshaya Tritiya', 'Buddha Purnima',
  'Eid al-Adha', 'Raksha Bandhan', 'Independence Day', 'Janmashtami', 'Ganesh Chaturthi', 'Onam',
  'Navratri', 'Durga Puja', 'Dussehra', 'Karva Chauth',
];

export default function App() {
  const [page, setPage] = useState<PageId>('chat');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('mock');
  const [chatId, setChatId] = useState<string>(newId);
  const [notes, setNotes] = useState<Note[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandLoaded, setBrandLoaded] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [logoJobId, setLogoJobId] = useState<string | null>(null);
  const [settledFor, setSettledFor] = useState<string | null>(null); // "Looks perfect" on this job
  const [settings, setSettings] = useState<Settings>({ aspectRatio: '9:16', resolution: '720p', durationSeconds: 8, imageSize: '2K' });
  const { jobs, upsert, remove } = useJobs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

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

  const chats: ChatSummary[] = useMemo(() => {
    const map = new Map<string, ChatSummary & { first: string }>();
    const add = (id: string, title: string, at: string) => {
      const c = map.get(id);
      if (!c) map.set(id, { id, title, updatedAt: at, first: at });
      else {
        if (at > c.updatedAt) c.updatedAt = at;
        if (at < c.first) Object.assign(c, { first: at, title });
      }
    };
    for (const j of jobs) if (!j.auto) add(j.chatId ?? LEGACY, j.chatId ? (j.title ?? j.request ?? j.prompt) : 'Earlier', j.createdAt);
    for (const n of notes) if (n.role === 'user') add(n.chatId, n.text, n.createdAt);
    return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [jobs, notes]);

  const items: Item[] = useMemo(() => {
    const list: Item[] = [
      ...jobs.filter((j) => (j.chatId ?? LEGACY) === chatId).map((job) => ({ type: 'job' as const, job, createdAt: job.createdAt })),
      ...notes.filter((n) => n.chatId === chatId).map((note) => ({ type: 'note' as const, note, createdAt: note.createdAt })),
    ];
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [jobs, notes, chatId]);

  // The newest result, once nothing is left rendering: that's the one we offer to change.
  const last = items[items.length - 1];
  const finished = last?.type === 'job' && last.job.status === 'succeeded' && !last.job.makesVideo ? last.job : null;

  const toBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  useLayoutEffect(() => toBottom(), [items.length, finished?.id, toBottom]);
  useLayoutEffect(() => {
    stick.current = true;
    toBottom(false);
  }, [chatId, toBottom]);

  const price = {
    image: provider === 'mock' ? 0 : (config?.image.pricePerImage[settings.imageSize] ?? 0),
    video: provider === 'mock' ? 0 : (config?.providers.find((p) => p.id === provider)?.pricePerSecond[settings.resolution] ?? 0) * settings.durationSeconds,
  };
  const costLabel = (usd: number) => (usd ? ` · ${formatCost(usd)}` : '');

  function addNotes(...list: Omit<Note, 'id' | 'chatId' | 'createdAt'>[]) {
    const now = Date.now();
    setNotes((n) => [...n, ...list.map((x, i) => ({ ...x, id: newId(), chatId, createdAt: new Date(now + i).toISOString() }))]);
  }
  const fail = (e: unknown) => addNotes({ role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong.' });

  async function post(input: { request?: string; kind?: Kind; changeOf?: string; change?: string; animate?: boolean }) {
    if (!brand) return false;
    stick.current = true;
    try {
      const job = await api.createBrandPost({
        brandId: brand.id,
        chatId: chatId === LEGACY ? newId() : chatId,
        request: input.request ?? '',
        kind: input.kind,
        changeOf: input.changeOf,
        change: input.change,
        animate: input.animate,
        ...settings,
        provider,
      });
      upsert(job);
      if (chatId === LEGACY && job.chatId) setChatId(job.chatId);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function send(text: string): Promise<boolean> {
    if (editing) {
      const target = editing;
      setEditing(null);
      return post({ changeOf: target.id, change: text });
    }
    // "Diwali video" already says what to make; otherwise ask.
    const kind = detectKind(text, false, null);
    if (kind) return post({ request: text, kind });
    const ids: string[] = [newId(), newId()];
    const now = Date.now();
    const choose = async (k: Kind) => {
      // Keep the conversation on screen while the brief is written (10–20 s), then hand over to the post.
      setNotes((n) =>
        n.map((x) => (x.id === ids[1] ? { ...x, text: `Designing your ${text} ${k === 'video' ? 'video' : 'post'}…`, actions: undefined } : x)),
      );
      await post({ request: text, kind: k });
      setNotes((n) => n.filter((x) => !ids.includes(x.id)));
    };
    setNotes((n) => [
      ...n,
      { id: ids[0], chatId, role: 'user', text, createdAt: new Date(now).toISOString() },
      {
        id: ids[1],
        chatId,
        role: 'assistant',
        text: `Lovely! Should we make your ${text} post as an image or a video?`,
        createdAt: new Date(now + 1).toISOString(),
        actions: [
          { label: `Image${costLabel(price.image)}`, icon: ImageIcon, run: () => void choose('image') },
          { label: `Video${costLabel(price.image + price.video)}`, icon: Film, primary: true, run: () => void choose('video') },
        ],
      },
    ]);
    stick.current = true;
    return true;
  }

  const handlers = {
    onAnimate: (job: Job) => void post({ changeOf: job.id, change: 'Make it a video', animate: true }),
    onRetry: (job: Job) => void (job.sourceJobId ? post({ changeOf: job.sourceJobId, change: job.request ?? '' }) : post({ request: job.request ?? job.prompt, kind: job.makesVideo ? 'video' : 'image' })),
    onDelete: async (job: Job) => {
      if (confirm(`Delete this ${job.kind}? This can't be undone.`)) await remove(job.id).catch(fail);
    },
    onMediaLoad: () => toBottom(),
    logoUrl: brand?.logoUrl ?? null,
    logoJobId,
    onLogoEdit: (job: Job | null) => setLogoJobId(job?.id ?? null),
    onPlaceLogo: async (job: Job, place: LogoPlace | null) => {
      try {
        upsert(await api.placeLogo(job.id, place));
        setLogoJobId(null);
      } catch (e) {
        fail(e);
      }
    },
  };

  const changeOffer = finished && settledFor !== finished.id && logoJobId !== finished.id && (
    <>
      <p className="mb-2 text-[13px] text-[color:var(--text-2)]">Want any changes?</p>
      <Actions
        compact
        actions={[
          ...(finished.brandId && !finished.logo
            ? [{ label: 'Place your logo', icon: Stamp, primary: true, run: () => setLogoJobId(finished.id) }]
            : []),
          { label: 'Brighter colours', icon: Sun, run: () => void post({ changeOf: finished.id, change: 'Make the colours brighter and more vibrant' }) },
          { label: 'A different design', icon: LayoutTemplate, run: () => void post({ changeOf: finished.id, change: 'Try a completely different concept and layout' }) },
          { label: 'Change the text', icon: Type, run: () => setEditing(finished) },
          ...(finished.kind === 'image'
            ? [{ label: `Make it a video${costLabel(price.video)}`, icon: Film, run: () => handlers.onAnimate(finished) }]
            : []),
          { label: 'Something else…', icon: Pencil, run: () => setEditing(finished) },
          { label: 'Looks perfect', icon: Check, primary: Boolean(finished.logo), run: () => setSettledFor(finished.id) },
        ]}
      />
    </>
  );

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

  const empty = items.length === 0;
  const composer = (
    <Composer
      config={config}
      placeholder={editing ? 'What should change? e.g. say “Happy Diwali from our family”' : 'Which festival? e.g. Diwali, Dussehra, Holi'}
      editing={editing ? { title: editing.title ?? editing.request ?? 'this post', onCancel: () => setEditing(null) } : null}
      autoFocus
      settings={settings}
      onSettings={setSettings}
      onSend={send}
      festivals={FESTIVALS}
    />
  );

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        chats={chats}
        chatId={chatId}
        page={page}
        onNewChat={() => {
          setChatId(newId());
          setEditing(null);
          setPage('chat');
          setMenuOpen(false);
        }}
        onOpenChat={(id) => {
          setChatId(id);
          setEditing(null);
          setPage('chat');
          setMenuOpen(false);
        }}
        onPage={(p) => {
          setPage(p);
          setMenuOpen(false);
        }}
        config={config}
        provider={provider}
        onProvider={setProvider}
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
          <button className="btn-ghost-icon ml-auto" aria-label="New post" onClick={() => setChatId(newId())}>
            <SquarePen className="h-[17px] w-[17px]" />
          </button>
        </header>

        {page !== 'chat' ? (
          <div className="flex-1 overflow-y-auto">
            <Soon page={page} onBack={() => setPage('chat')} />
          </div>
        ) : empty ? (
          <div className="relative isolate flex flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-10">
            <div className="aurora -z-10" />
            <div className="absolute inset-0 -z-10">
              <FilmWall jobs={jobs} />
            </div>
            <div className="appear w-full max-w-3xl text-center">
              <img src={brand.logoUrl} alt={`${brand.name} logo`} className="mx-auto mb-6 h-14 max-w-[180px] rounded-xl bg-white/90 object-contain p-2" />
              <h1 className="display text-[clamp(2.2rem,5.2vw,4.2rem)]">
                What are we <span className="serif pr-[0.06em]">celebrating?</span>
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-[16px] leading-relaxed text-[color:var(--text-2)]">
                Pick a festival and press Generate. We design it for {brand.name} in your colours.
              </p>
              <div className="mt-9 text-left">{composer}</div>
              {offline && (
                <p role="alert" className="mt-3 text-[13px] text-[color:var(--red)]">
                  {offline}
                </p>
              )}

            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
              }}
            >
              <Thread items={items} h={handlers} after={changeOffer || undefined} />
            </div>
            <div className="dock shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
              <div className="mx-auto max-w-3xl">
                {composer}
                <p className="mt-2 hidden text-center text-[11.5px] text-[color:var(--text-3)] sm:block">
                  {provider === 'mock' ? 'Demo mode: placeholder results, no API cost.' : `Designed for ${brand.name}`}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
