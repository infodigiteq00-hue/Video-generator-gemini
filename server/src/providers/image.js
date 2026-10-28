// Image providers. Each has generate(job, inputImagePath | null) → { buffer, mimeType }.
// Docs: https://ai.google.dev/gemini-api/docs/image-generation
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchRetry } from './http.js';

const MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';
// Approximate 1K-output prices from https://ai.google.dev/gemini-api/docs/pricing
const MODELS = {
  'gemini-3.1-flash-image': { id: 'nano-banana-2', label: 'Nano Banana 2', pricePerImage: { '1K': 0.067, '2K': 0.101, '4K': 0.151 } },
  'gemini-3.1-flash-lite-image': { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite', pricePerImage: { '1K': 0.034 } },
};
const info = MODELS[MODEL] ?? { id: MODEL, label: MODEL, pricePerImage: { '1K': 0.067 } };

export const nanoBanana = {
  ...info,
  get available() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async generate(job, inputImagePath) {
    const parts = [{ text: job.prompt }];
    if (inputImagePath) {
      parts.push({ inlineData: { mimeType: job.imageMimeType, data: (await fs.readFile(inputImagePath)).toString('base64') } });
    }
    const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: job.aspectRatio, imageSize: job.imageSize } },
      }),
    }, { idempotent: false });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) throw new Error(`Image API ${res.status}: ${data?.error?.message || text.slice(0, 300)}`);

    const image = findImage(data);
    if (!image) throw new Error('The model replied without an image. Try rephrasing the prompt.');
    return { buffer: Buffer.from(image.data, 'base64'), mimeType: image.mimeType };
  },
};

// The image sits in candidates[].content.parts[].inlineData; search so shape changes don't break us.
function findImage(node) {
  if (!node || typeof node !== 'object') return null;
  const mimeType = node.mime_type || node.mimeType;
  if (typeof node.data === 'string' && mimeType?.startsWith('image/')) return { data: node.data, mimeType };
  for (const value of Object.values(node)) {
    const found = findImage(value);
    if (found) return found;
  }
  return null;
}

const run = promisify(execFile);
const SIZES = { '16:9': '1376x768', '9:16': '768x1376' };

export const mockImage = {
  id: 'mock',
  label: 'Demo mode',
  pricePerImage: { '1K': 0, '2K': 0, '4K': 0 },
  available: true,

  async generate(job) {
    await new Promise((r) => setTimeout(r, 2500));
    const out = path.join(os.tmpdir(), `mock-${job.id}.png`);
    const base = ['-y', '-f', 'lavfi', '-i', `gradients=s=${SIZES[job.aspectRatio]}:speed=0.02:n=4:seed=${job.prompt.length}`, '-frames:v', '1'];
    const caption = job.prompt.slice(0, job.aspectRatio === '9:16' ? 32 : 60).replace(/[\\:'%]/g, ' ');
    const text = `drawtext=text='${caption}':fontcolor=white:fontsize=min(w\\,h)/24:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=black@0.35:boxborderw=20`;
    try {
      await run('ffmpeg', [...base, '-vf', text, out]);
    } catch {
      await run('ffmpeg', [...base, out]);
    }
    const buffer = await fs.readFile(out);
    await fs.rm(out, { force: true });
    return { buffer, mimeType: 'image/png' };
  },
};
