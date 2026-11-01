// Uploaded logos become clean PNGs. If the logo sits on a solid background, the client chooses what happens to it:
//   keep  – leave it as uploaded
//   outer – remove the background around the logo, and in the small holes inside it (letters like e, a, o and the
//           gaps between shapes); large areas of that colour inside the logo, like a white circle, stay
//   all   – remove that colour everywhere, inside the logo too
// Edge pixels are "un-mixed" from the background colour, so edges stay crisp with no halo, and anything clearly
// different from the background stays fully solid, so thin text survives. Logos with a see-through background
// (uploaded that way or cleaned here) also get a white and a grey version, for posts where those read better.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UPLOADS_DIR } from './paths.js';

const run = promisify(execFile);
const MAX = 1200; // px, longest side: plenty for stamping, small enough to process quickly
const MIN = 1000; // smaller logos are enlarged first, so their edges come out smooth
const HARD = 24; // colour distance from the background that is still background
const EDGE = 160; // pixels next to the cleared background closer than this to it are treated as blended edge
const HOLE = 0.015; // enclosed background areas smaller than this share of the image are holes, and go too
export const BG_MODES = ['keep', 'outer', 'all'];

async function decode(file) {
  const { stdout: info } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  let [w, h] = info.trim().split(',').map(Number);
  const k = Math.min(MAX, Math.max(MIN, Math.max(w, h))) / Math.max(w, h);
  [w, h] = [Math.max(2, Math.round(w * k)), Math.max(2, Math.round(h * k))];
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
    encoding: 'buffer',
    maxBuffer: w * h * 4 + 1024,
  });
  return { w, h, px: stdout };
}

async function encode({ w, h, px }, out) {
  const raw = path.join(os.tmpdir(), `logo-${crypto.randomUUID()}.rgba`);
  fs.writeFileSync(raw, px);
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw, '-frames:v', '1', out]);
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

const dist = (px, i, [r, g, b]) => Math.max(Math.abs(px[i] - r), Math.abs(px[i + 1] - g), Math.abs(px[i + 2] - b));

// What's behind the logo: see-through, one solid colour (returned), or neither (a photo or a busy edge).
function background({ w, h, px }) {
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  if (edge.filter((p) => px[p * 4 + 3] < 20).length > edge.length * 0.6) return { kind: 'transparent' };
  // The most common edge colour, then how much of the edge is close to it.
  const counts = new Map();
  for (const p of edge) {
    const key = [0, 1, 2].map((c) => px[p * 4 + c] >> 4).join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const near = edge.filter((p) => top.every((v, c) => Math.abs((px[p * 4 + c] >> 4) - v) <= 1));
  if (near.length < edge.length * 0.85) return { kind: 'none' };
  const color = [0, 1, 2].map((c) => Math.round(near.reduce((s, p) => s + px[p * 4 + c], 0) / near.length));
  return { kind: 'solid', color };
}

// Edge pixels are a blend of the logo and the background. Each takes the colour of its most solid neighbour (the
// logo's real colour there) with just as much opacity as the blend holds, so there's no pale rim on dark posts.
function matte(img, gone, bg) {
  const { w, h, px } = img;
  for (let ring = 0; ring < 3; ring++) {
    const next = new Uint8Array(gone);
    for (let p = 0; p < w * h; p++) {
      if (gone[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      const touches = (x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || (y > 0 && gone[p - w]) || (y < h - 1 && gone[p + w]);
      const i = p * 4;
      if (!touches || dist(px, i, bg) >= EDGE) continue;
      // The most solid neighbour within two pixels.
      let best = -1;
      let far = dist(px, i, bg);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (gone[q] || px[q * 4 + 3] < 250) continue;
          const d = dist(px, q * 4, bg);
          if (d > far + 8) [far, best] = [d, q * 4];
        }
      next[p] = 1;
      if (best < 0) {
        if (dist(px, i, bg) <= HARD) px[i + 3] = 0;
        continue;
      }
      // How much of the solid colour the blend holds, measured along the line from the background to it.
      let num = 0;
      let den = 0;
      for (let c = 0; c < 3; c++) {
        const f = px[best + c] - bg[c];
        num += (px[i + c] - bg[c]) * f;
        den += f * f;
      }
      const a = Math.min(1, Math.max(0, num / den));
      for (let c = 0; c < 3; c++) px[i + c] = px[best + c];
      px[i + 3] = Math.round(px[i + 3] * a);
    }
    gone.set(next);
  }
}

// Removes every pixel of the background colour, inside the logo too.
function removeAll(img, bg) {
  const { w, h, px } = img;
  const gone = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (dist(px, p * 4, bg) <= HARD) {
      gone[p] = 1;
      px[p * 4 + 3] = 0;
    }
  }
  matte(img, gone, bg);
}

// Removes the background around the logo and in its small holes.
function removeOuter(img, bg) {
  const { w, h, px } = img;
  // Group the background-coloured pixels into connected areas.
  const area = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const outside = [];
  for (let start = 0; start < w * h; start++) {
    if (area[start] !== -1 || dist(px, start * 4, bg) > HARD) continue;
    const id = sizes.length;
    let size = 0;
    let edge = false;
    const stack = [start];
    area[start] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      if (x === 0 || x === w - 1 || p < w || p >= w * (h - 1)) edge = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) {
        if (q >= 0 && area[q] === -1 && dist(px, q * 4, bg) <= HARD) {
          area[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
    outside.push(edge);
  }
  // Clear the outside and the small holes; keep big areas of that colour inside the logo.
  const gone = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const id = area[p];
    if (id >= 0 && (outside[id] || sizes[id] < w * h * HOLE)) {
      gone[p] = 1;
      px[p * 4 + 3] = 0;
    }
  }
  matte(img, gone, bg);
}

// Crops to the visible part, keeping a small margin.
function trim(img) {
  const { w, h, px } = img;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[(y * w + x) * 4 + 3] > 20) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (x1 < 0) return img;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
  [x0, y0, x1, y1] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(w - 1, x1 + m), Math.min(h - 1, y1 + m)];
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) px.copy(out, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { w: cw, h: ch, px: out };
}

// The same shape in one flat colour. Near-white parts inside the logo become see-through, so a white
// circle with coloured dots stays a ring of dots instead of turning into a solid blob.
function tint({ w, h, px }, [r, g, b]) {
  const out = Buffer.from(px);
  for (let i = 0; i < out.length; i += 4) {
    out[i + 3] = Math.round(out[i + 3] * Math.min(1, dist(px, i, [255, 255, 255]) / 60));
    [out[i], out[i + 1], out[i + 2]] = [r, g, b];
  }
  return { w, h, px: out };
}

async function clean(file, mode) {
  const img = await decode(file);
  const bg = background(img);
  if (bg.kind === 'solid' && mode === 'outer') removeOuter(img, bg.color);
  if (bg.kind === 'solid' && mode === 'all') removeAll(img, bg.color);
  const seeThrough = bg.kind === 'transparent' || (bg.kind === 'solid' && mode !== 'keep');
  return { img: seeThrough ? trim(img) : img, bg, seeThrough };
}

/** For the setup screen: what's behind the logo, and how each choice looks (PNG data URLs). */
export async function previewLogo(file) {
  const bg = background(await decode(file));
  const modes = bg.kind === 'solid' ? BG_MODES : ['keep'];
  const previews = {};
  for (const mode of modes) {
    const out = path.join(os.tmpdir(), `logo-preview-${crypto.randomUUID()}.png`);
    try {
      await encode((await clean(file, mode)).img, out);
      previews[mode] = `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
    } finally {
      fs.rmSync(out, { force: true });
    }
  }
  return { background: bg.kind, previews };
}

/**
 * Turns an uploaded logo into PNGs in UPLOADS_DIR with the client's background choice. Returns { color, light, grey }
 * file paths; light and grey are null when the logo keeps a solid background (a one-colour box would hide it).
 */
export async function processLogo(file, mode = 'keep') {
  const { img, seeThrough } = await clean(file, BG_MODES.includes(mode) ? mode : 'keep');
  const id = crypto.randomUUID();
  const out = (v) => path.join(UPLOADS_DIR, `${id}-logo-${v}.png`);
  await encode(img, out('color'));
  if (!seeThrough) return { color: out('color'), light: null, grey: null };
  await encode(tint(img, [255, 255, 255]), out('light'));
  await encode(tint(img, [74, 74, 79]), out('grey'));
  return { color: out('color'), light: out('light'), grey: out('grey') };
}
