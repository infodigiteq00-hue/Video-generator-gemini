// Demo provider: renders a placeholder clip locally with ffmpeg, at no API cost.
// Use it to rehearse the flow, or as a fallback if the real API is down.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FAKE_RENDER_MS = 6000;
const SIZES = {
  '16:9': { '720p': '1280x720', '1080p': '1920x1080' },
  '9:16': { '720p': '720x1280', '1080p': '1080x1920' },
};

export const mock = {
  id: 'mock',
  label: 'Demo mode (no API cost)',
  pricePerSecond: { '720p': 0, '1080p': 0 },
  available: true,

  async start(job) {
    return `mock/${job.id}/${Date.now()}`;
  },

  async poll(operationName) {
    const startedAt = Number(operationName.split('/').pop());
    return Date.now() - startedAt < FAKE_RENDER_MS
      ? { done: false }
      : { done: true, videoUri: operationName };
  },

  async download(_videoUri, destPath, job) {
    const size = SIZES[job.aspectRatio][job.resolution];
    const base = ['-y', '-f', 'lavfi', '-i', `gradients=s=${size}:d=${job.durationSeconds}:speed=0.02:n=3`];
    const out = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', String(job.durationSeconds), destPath];
    const caption = job.prompt.slice(0, job.aspectRatio === '9:16' ? 32 : 60).replace(/[\\:'%]/g, ' ');
    const text = `drawtext=text='${caption}':fontcolor=white:fontsize=min(w\\,h)/24:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.35:boxborderw=20`;
    try {
      await run('ffmpeg', [...base, '-vf', text, ...out]);
    } catch {
      // drawtext needs a font; fall back to a plain gradient.
      await run('ffmpeg', [...base, ...out]);
    }
  },
};
