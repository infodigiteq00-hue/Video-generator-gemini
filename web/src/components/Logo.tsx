import { useId } from 'react';

/** Viewfinder mark: four corner brackets framing a play triangle. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7bff" />
          <stop offset=".55" stopColor="#ff7ad9" />
          <stop offset="1" stopColor="#5ee7ff" />
        </linearGradient>
      </defs>
      <path
        d="M8 16v-5a3 3 0 0 1 3-3h5M32 8h5a3 3 0 0 1 3 3v5M40 32v5a3 3 0 0 1-3 3h-5M16 40h-5a3 3 0 0 1-3-3v-5"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M20 16.5v15l12-7.5z" fill={`url(#${id})`} />
    </svg>
  );
}
