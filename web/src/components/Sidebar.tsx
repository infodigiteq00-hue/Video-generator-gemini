import { Download, LogOut, MessageSquare, Plus, SquarePen, X } from 'lucide-react';
import { api } from '../api';
import { useState } from 'react';
import { useInstall } from '../hooks/useInstall';
import { APP_NAME } from '../config';
import type { AppConfig, Brand, PageId, Provider } from '../types';
import { Logo } from './Logo';

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  chats: ChatSummary[];
  chatId: string;
  page: PageId;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onPage: (p: PageId) => void;
  config: AppConfig | null;
  provider: Provider;
  onProvider: (p: Provider) => void;
  brand: Brand | null;
  onEditBrand: () => void;
}


export function Sidebar({ open, onClose, chats, chatId, page, onNewChat, onOpenChat, config, provider, onProvider, brand, onEditBrand }: Props) {
  const app = useInstall();
  const [iosHint, setIosHint] = useState(false);
  const live = provider !== 'mock';
  const row = 'press flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px]';

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/[0.06] bg-[rgba(10,10,12,0.92)] backdrop-blur-2xl transition-transform duration-500 [transition-timing-function:var(--spring)] md:static md:translate-x-0 md:bg-[rgba(10,10,12,0.6)] ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Logo size={26} />
          <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
          <button className="btn-ghost-icon ml-auto md:hidden" aria-label="Close menu" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3">
          <button className={`${row} bg-white/[0.06] font-medium ring-1 ring-white/[0.07] hover:bg-white/[0.1]`} onClick={onNewChat}>
            <SquarePen className="h-4 w-4" /> New post
          </button>
          {brand ? (
            <button className={`${row} mt-2 hover:bg-white/[0.05]`} onClick={onEditBrand} title="Edit your brand">
              <img src={brand.logoUrl} alt="" className="h-7 w-9 shrink-0 rounded-md bg-white/90 object-contain p-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[color:var(--text)]">{brand.name || 'Your brand'}</span>
                <span className="flex items-center gap-1 pt-0.5">
                  {brand.colors.slice(0, 5).map((c) => (
                    <span key={c} className="h-2.5 w-2.5 rounded-full ring-1 ring-white/15" style={{ background: c }} />
                  ))}
                </span>
              </span>
              <span className="text-[11.5px] text-[color:var(--text-3)]">Edit</span>
            </button>
          ) : (
            <button className={`${row} mt-2 text-[color:var(--text-2)] hover:bg-white/[0.05] hover:text-[color:var(--text)]`} onClick={onEditBrand}>
              <Plus className="h-4 w-4" /> Set up your brand
            </button>
          )}
        </div>

        <nav aria-label="Chats" className="scrollbar-thin mt-5 flex-1 overflow-y-auto px-3">
          <div className="px-3 pb-1.5 text-[11.5px] font-medium text-[color:var(--text-3)]">Your posts</div>
          {chats.length === 0 && <p className="px-3 py-2 text-[12.5px] text-[color:var(--text-3)]">Your festival posts show up here.</p>}
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenChat(c.id)}
              aria-current={page === 'chat' && c.id === chatId}
              className={`${row} ${page === 'chat' && c.id === chatId ? 'bg-white/[0.09] text-[color:var(--text)]' : 'text-[color:var(--text-2)] hover:bg-white/[0.05] hover:text-[color:var(--text)]'}`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{c.title}</span>
            </button>
          ))}

        </nav>

        <div className="border-t border-white/[0.06] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {app.canInstall && (
            <div className="mb-2">
              <button
                className="press flex w-full items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2 text-left text-[13px] font-medium ring-1 ring-white/[0.07] hover:bg-white/[0.1]"
                onClick={() => (app.ios ? setIosHint((v) => !v) : void app.install())}
              >
                <Download className="h-4 w-4" /> Install app
              </button>
              {iosHint && (
                <p className="px-3 pt-2 text-[12px] leading-snug text-[color:var(--text-2)]">
                  In Safari, tap <span className="text-[color:var(--text)]">Share</span>, then <span className="text-[color:var(--text)]">Add to Home Screen</span>.
                </p>
              )}
            </div>
          )}
          <label className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] text-[color:var(--text-2)]">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: live ? 'var(--green)' : 'var(--amber)', boxShadow: `0 0 8px ${live ? 'var(--green)' : 'var(--amber)'}` }}
            />
            <select
              aria-label="Engine"
              value={provider}
              onChange={(e) => onProvider(e.target.value as Provider)}
              className="w-full cursor-pointer appearance-none bg-transparent text-[12.5px] font-medium text-[color:var(--text)] outline-none"
            >
              {(config?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available} className="bg-neutral-900">
                  {p.id === 'mock' ? 'Demo mode (free)' : 'Live · Gemini'}
                  {!p.available ? ' (add API key)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="press mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] text-[color:var(--text-2)] hover:bg-white/[0.05] hover:text-[color:var(--text)]"
            onClick={() => void api.logout().finally(() => window.dispatchEvent(new Event('auth:expired')))}
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
          <p className="px-3 pb-1 text-[11px] leading-snug text-[color:var(--text-3)]">
            {live ? 'Real images and videos.' : 'Placeholder results, no API cost.'}
          </p>
        </div>
      </aside>
    </>
  );
}
