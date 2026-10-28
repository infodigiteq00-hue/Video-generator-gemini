import { ArrowLeft, Palette, PenTool, Scissors } from 'lucide-react';
import type { PageId } from '../types';

const PAGES = {
  figma: { icon: PenTool, name: 'Figma', detail: 'Send any image or frame to Figma to add layouts, type and brand assets.' },
  canva: { icon: Palette, name: 'Canva', detail: 'Open results in Canva for captions, templates and quick social cuts.' },
  editor: { icon: Scissors, name: 'The editor', detail: 'Trim, sequence and export your clips, all in the browser.' },
};

export function Soon({ page, onBack }: { page: Exclude<PageId, 'chat'>; onBack: () => void }) {
  const p = PAGES[page];
  return (
    <section className="appear mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 py-20 text-center">
      <div className="glass halo is-live grid h-20 w-20 place-items-center rounded-[26px]">
        <p.icon className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <div className="chip mt-8">Coming soon</div>
      <h1 className="display mt-5 text-[clamp(2.4rem,6vw,4.25rem)]">
        {p.name}, <span className="serif">next.</span>
      </h1>
      <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[color:var(--text-2)]">{p.detail}</p>
      <button className="btn-light mt-9" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to chat
      </button>
    </section>
  );
}
