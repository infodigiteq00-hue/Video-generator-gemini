// Gemini Omni Flash video (Interactions API). Replaced Veo 3.1 Lite preview, which Google shut down on 22 Oct 2026.
// Docs: https://ai.google.dev/gemini-api/docs/omni
// The call is synchronous: one long request returns the finished video, so start() does the work
// and poll()/download() just hand over the result.
import fs from 'node:fs/promises';
import { fetchRetry } from './http.js';

const MODEL = process.env.VIDEO_MODEL || 'gemini-omni-1.1-flash';
const results = new Map(); // operation id → video bytes, until download()

export const omni = {
  id: 'omni-flash',
  label: 'Gemini Omni Flash',
  // $17.50 per 1M output tokens at 5,792 tokens per second of 720p ≈ $0.10/s (same rate at 1080p).
  pricePerSecond: { '720p': 0.1, '1080p': 0.1 },
  get available() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async start(job, imagePath) {
    // Omni has no duration parameter; the length is asked for in the prompt.
    const text = `${job.prompt}\n\nMake the video exactly ${job.durationSeconds} seconds long.` +
      (job.negativePrompt ? ` Avoid: ${job.negativePrompt}.` : '');
    const input = imagePath
      ? [
          { type: 'image', mime_type: job.imageMimeType, data: (await fs.readFile(imagePath)).toString('base64') },
          { type: 'text', text },
        ]
      : text;
    const res = await fetchRetry(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input,
          response_format: { type: 'video', aspect_ratio: job.aspectRatio, resolution: job.resolution },
          background: false,
          store: false,
          stream: false,
        }),
      },
      { idempotent: false },
    );
    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {}
    if (!res.ok) throw new Error(`Video API ${res.status}: ${data?.error?.message || raw.slice(0, 300)}`);

    const video = findVideo(data);
    if (!video) throw new Error('The video model finished without returning a video. Try again.');
    const bytes = video.data ? Buffer.from(video.data, 'base64') : await downloadUri(video.uri);
    const id = `omni/${job.id}`;
    results.set(id, bytes);
    return id;
  },

  async poll(operationName) {
    if (!results.has(operationName)) throw new Error('The server restarted while this video was rendering. Please try again.');
    return { done: true, videoUri: operationName };
  },

  async download(operationName, destPath) {
    await fs.writeFile(destPath, results.get(operationName));
    results.delete(operationName);
  },
};

// steps[] → { type: 'model_output', content: [{ type: 'video', data | uri }] }; search so shape changes don't break us.
function findVideo(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'video' && (node.data || node.uri)) return node;
  for (const value of Object.values(node)) {
    const found = findVideo(value);
    if (found) return found;
  }
  return null;
}

async function downloadUri(uri) {
  const res = await fetchRetry(uri, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
