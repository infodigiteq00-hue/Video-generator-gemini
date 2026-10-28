import type { Job } from '../types';

// Stand-in "stills" until the library has real clips to show.
const STILLS = [
  'radial-gradient(120% 90% at 20% 100%, #ff8a3d 0%, #b8336a 45%, #2b1055 100%)',
  'linear-gradient(160deg, #0f2027 0%, #2c5364 60%, #6dd5ed 130%)',
  'radial-gradient(90% 120% at 80% 20%, #ff7ad9 0%, #6b2bd9 50%, #0b0b2b 100%)',
  'linear-gradient(200deg, #f6d365 -20%, #fda085 40%, #3a1c71 110%)',
  'radial-gradient(100% 100% at 50% 110%, #5ee7ff 0%, #1e3c72 55%, #050816 100%)',
  'linear-gradient(140deg, #134e5e 0%, #71b280 120%)',
  'radial-gradient(80% 100% at 30% 0%, #c471f5 0%, #fa71cd 40%, #1b1035 100%)',
  'linear-gradient(180deg, #1a2a6c 0%, #b21f1f 70%, #fdbb2d 140%)',
  'radial-gradient(120% 80% at 70% 90%, #43e97b 0%, #0f5132 50%, #04130c 100%)',
  'linear-gradient(170deg, #232526 0%, #414345 50%, #8b7bff 140%)',
];
const TILES = 48; // 8 columns x 6 rows, rendered twice for a seamless loop

export function FilmWall({ jobs }: { jobs: Job[] }) {
  const clips = jobs.filter((j) => j.status === 'succeeded' && j.videoUrl && j.aspectRatio === '16:9').slice(0, 4);
  const tiles = Array.from({ length: TILES }, (_, i) => i);

  const tile = (i: number, copy: number) => {
    // Sprinkle real clips into a few fixed slots (first copy only, to keep decoding cheap).
    const clip = copy === 0 && i % 12 === 3 ? clips[Math.floor(i / 12)] : undefined;
    return (
      <div key={`${copy}-${i}`} className="wall-tile grain" style={{ background: STILLS[(i * 7) % STILLS.length] }}>
        {clip && <video src={clip.videoUrl!} autoPlay muted loop playsInline />}
      </div>
    );
  };

  return (
    <>
      <div className="wall" aria-hidden>
        <div className="wall-plane">
          <div className="wall-track">
            {tiles.map((i) => tile(i, 0))}
            {tiles.map((i) => tile(i, 1))}
          </div>
        </div>
      </div>
      <div className="scrim" />
    </>
  );
}
