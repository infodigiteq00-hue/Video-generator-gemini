import { useRef, useState } from 'react';
import type { LogoPlace } from '../types';

interface Props {
  logoUrl: string;
  initial: LogoPlace | null;
  /** Renders over the media; the parent frame has the media's exact aspect ratio. */
  onChange: (p: LogoPlace) => void;
}

const DEFAULT: LogoPlace = { x: 0.72, y: 0.04, w: 0.24 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Drag the logo to move it, drag the corner handle to resize. Positions are fractions of the frame. */
export function LogoEditor({ logoUrl, initial, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<LogoPlace>(initial ?? DEFAULT);
  const [ratio, setRatio] = useState(0.4); // logo height / width, set when the image loads
  const drag = useRef<{ mode: 'move' | 'resize'; dx: number; dy: number } | null>(null);

  const frame = () => box.current!.getBoundingClientRect();
  const heightFrac = (p: LogoPlace) => {
    const r = box.current ? frame() : { width: 1, height: 1 };
    return (p.w * r.width * ratio) / r.height;
  };

  function update(p: LogoPlace) {
    setPlace(p);
    onChange(p);
  }

  function down(e: React.PointerEvent, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const r = frame();
    // Remember where inside the logo it was grabbed, so it doesn't jump to the pointer.
    drag.current = { mode, dx: e.clientX - (r.left + place.x * r.width), dy: e.clientY - (r.top + place.y * r.height) };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const r = frame();
    if (d.mode === 'move') {
      const x = clamp((e.clientX - r.left - d.dx) / r.width, 0, 1 - place.w);
      const y = clamp((e.clientY - r.top - d.dy) / r.height, 0, 1 - heightFrac(place));
      update({ ...place, x, y });
    } else {
      const maxW = Math.min(1 - place.x, ((1 - place.y) * r.height) / (r.width * ratio));
      update({ ...place, w: clamp((e.clientX - r.left) / r.width - place.x, 0.06, maxW) });
    }
  }

  return (
    <div ref={box} className="absolute inset-0 z-10 touch-none select-none bg-black/10" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
      <div
        role="slider"
        aria-label="Logo position. Drag to move."
        aria-valuetext={`${Math.round(place.x * 100)}% from left, ${Math.round(place.y * 100)}% from top`}
        tabIndex={0}
        onPointerDown={(e) => down(e, 'move')}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.05 : 0.01;
          const k: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (!k[e.key]) return;
          e.preventDefault();
          update({ ...place, x: clamp(place.x + k[e.key][0], 0, 1 - place.w), y: clamp(place.y + k[e.key][1], 0, 1 - heightFrac(place)) });
        }}
        className="absolute cursor-grab outline outline-2 outline-offset-2 outline-white/80 active:cursor-grabbing focus-visible:outline-[color:var(--violet)]"
        style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%`, width: `${place.w * 100}%` }}
      >
        <img
          src={logoUrl}
          alt="Your logo"
          draggable={false}
          onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth || 0.4)}
          className="pointer-events-none block w-full"
        />
        <span
          aria-label="Resize logo"
          onPointerDown={(e) => down(e, 'resize')}
          className="absolute -bottom-2.5 -right-2.5 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-black/40 bg-white shadow"
        />
      </div>
    </div>
  );
}
