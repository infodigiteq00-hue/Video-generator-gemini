// Generation jobs (videos and images): validation, persistence and the background worker.
// Shared by the web API (index.js) and the ChatGPT MCP app (mcp.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { omni } from './providers/omni.js';
import { mock } from './providers/mock.js';
import { mockImage, nanoBanana } from './providers/image.js';
import { LOGO_VARIANTS, addEndCard, defaultPlace, getBrand, hasContact, stampBrand, writeVideoPrompt } from './brand.js';
import { DATA_DIR, OUTPUTS_DIR, UPLOADS_DIR } from './paths.js';
import { adminId } from './auth.js';
import { collection } from './db.js';

export { DATA_DIR, UPLOADS_DIR };

const POLL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000;
export const PROVIDERS = { [omni.id]: omni, [mock.id]: mock };
export const IMAGE_PROVIDERS = { live: nanoBanana, mock: mockImage };
export const ASPECT_RATIOS = ['16:9', '9:16'];
export const RESOLUTIONS = ['720p', '1080p'];
export const DURATIONS = [4, 6, 8];
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export class ValidationError extends Error {}

export const defaultProviderId = () => (omni.available ? omni.id : mock.id);

// ---- Store (in memory, persisted to the database) ----

const store = collection('jobs', adminId);
const jobs = new Map();
for (const job of store.all()) {
  job.kind ??= 'video';
  job.chatId ??= null;
  job.outputUrl ??= job.videoUrl;
  jobs.set(job.id, job);
}

function update(job, fields) {
  Object.assign(job, fields, { updatedAt: new Date().toISOString() });
  store.put(job);
}

export function getJob(id) {
  return jobs.get(id);
}

// One account's jobs, newest first.
export function listJobs(userId) {
  return [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Internal fields (operationName, file paths) stay on the server.
// Brand posts' prompts are our own work, so only admins get them; ChatGPT jobs keep the prompt the user typed.
export function toPublic(job, admin = false) {
  const { operationName, imagePath, imageMimeType, outputPath, cleanPath, next, ...rest } = job;
  if (job.brandId && !admin) delete rest.prompt;
  const end = job.status === 'succeeded' || job.status === 'failed' ? job.updatedAt : Date.now();
  const cleanUrl = cleanPath ? `/media/videos/${path.basename(cleanPath)}` : null; // the version without the logo
  return { ...rest, cleanUrl, makesVideo: Boolean(next), elapsedSeconds: Math.round((new Date(end) - new Date(job.createdAt)) / 1000) };
}

// The finished image of another job, copied so deleting either job never breaks the other.
function imageFromJob(sourceJobId) {
  const source = jobs.get(sourceJobId);
  if (!source || source.kind !== 'image' || source.status !== 'succeeded') throw new ValidationError('That image is no longer available');
  return copyImage(source);
}

// Brand images keep a logo-free copy. Only that copy is ever sent to the AI models:
// the logo is added outside the models, by the client, after generation.
function copyImage(source) {
  if (source.brandId && !source.cleanPath) throw new ValidationError('The logo-free original of this post is missing, so it cannot be animated');
  const from = source.cleanPath || source.outputPath;
  const ext = path.extname(from);
  const copy = path.join(UPLOADS_DIR, `${crypto.randomUUID()}${ext}`);
  fs.copyFileSync(from, copy);
  return { path: copy, mimetype: Object.keys(EXT).find((t) => EXT[t] === ext) };
}

// `image` is { path, mimetype } of a file already saved in UPLOADS_DIR, or null.
// Throws ValidationError for bad input; the caller owns cleaning up `image` then.
export function createJob({
  kind, chatId, prompt, negativePrompt, aspectRatio, resolution, durationSeconds, imageSize, provider: providerId, image, sourceJobId,
  request, title, brandId, next, auto, userId,
}) {
  kind ||= 'video';
  prompt = (prompt || '').trim();
  aspectRatio ||= '16:9';
  providerId ||= defaultProviderId();
  const isVideo = kind === 'video';
  const provider = isVideo ? PROVIDERS[providerId] : IMAGE_PROVIDERS[providerId === 'mock' ? 'mock' : 'live'];
  if (isVideo) {
    resolution ||= '720p';
    durationSeconds = Number(durationSeconds || 8);
    imageSize = null;
  } else {
    resolution = null;
    durationSeconds = null;
    imageSize ||= provider && '2K' in provider.pricePerImage ? '2K' : '1K';
  }

  const error =
    (!['video', 'image'].includes(kind) && 'Kind must be video or image') ||
    (!prompt && 'Prompt is required') ||
    (prompt.length > 4000 && 'Prompt is too long (max 4000 characters)') ||
    (!provider && `Unknown provider "${providerId}"`) ||
    (!provider.available && 'Gemini is not configured: set GEMINI_API_KEY in server/.env') ||
    (!ASPECT_RATIOS.includes(aspectRatio) && 'Invalid aspect ratio') ||
    (isVideo && !RESOLUTIONS.includes(resolution) && 'Invalid resolution') ||
    (isVideo && !DURATIONS.includes(durationSeconds) && 'Duration must be 4, 6 or 8 seconds') ||
    (isVideo && resolution === '1080p' && durationSeconds !== 8 && '1080p requires an 8 second duration') ||
    (!isVideo && !(imageSize in provider.pricePerImage) && `${provider.label} supports ${Object.keys(provider.pricePerImage).join(', ')} images`);
  if (error) throw new ValidationError(error);
  if (!image && sourceJobId) image = imageFromJob(sourceJobId);
  if (sourceJobId) brandId ||= jobs.get(sourceJobId)?.brandId; // animating a brand image keeps the logo

  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    kind,
    chatId: chatId || null,
    userId: userId ?? null, // the account it belongs to (ChatGPT jobs have none)
    provider: isVideo ? provider.id : providerId === 'mock' ? 'mock' : provider.id,
    status: 'queued',
    prompt,
    request: request || null, // the short text the user typed, when `prompt` was written for them
    title: title || null,
    brandId: brandId || null,
    next: next || null, // brand posts: the video to make once the image is ready
    auto: Boolean(auto), // created by the app (follow-up video), not typed by the user
    followUpError: null,
    negativePrompt: (negativePrompt || '').trim() || null,
    aspectRatio,
    resolution,
    durationSeconds,
    imageSize,
    imageUrl: image ? `/media/uploads/${path.basename(image.path)}` : null,
    imagePath: image?.path ?? null,
    imageMimeType: image?.mimetype ?? null,
    sourceJobId: sourceJobId || null,
    outputUrl: null,
    videoUrl: null,
    estimatedCost: +(isVideo ? provider.pricePerSecond[resolution] * durationSeconds : provider.pricePerImage[imageSize]).toFixed(2),
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  store.put(job);
  runJob(job);
  return job;
}

// The post as shown and downloaded: the logo-free original plus the brand frame (the logo at `place` and the
// contact bar). A new file name each time, so browsers never show a cached copy.
async function framed(job, brand, place) {
  let outputPath = job.cleanPath;
  if (place || hasContact(brand) || !brand.logoPath) {
    const ext = job.kind === 'video' ? '.mp4' : path.extname(job.cleanPath) === '.png' ? '.png' : '.jpg';
    outputPath = path.join(OUTPUTS_DIR, `${job.id}-logo-${Date.now()}${ext}`);
    await stampBrand(job.cleanPath, outputPath, brand, place);
  }
  const url = `/media/videos/${path.basename(outputPath)}`;
  return { outputPath, outputUrl: url, videoUrl: job.kind === 'video' ? url : job.videoUrl, logo: place };
}

// New brand posts arrive framed: the logo centred at the top and the contact bar. A frame that fails never fails the post.
async function autoFrame(job) {
  const brand = job.brandId && getBrand(job.brandId);
  if (!brand) return {};
  try {
    return await framed(job, brand, brand.logoPath ? await defaultPlace(brand, job.cleanPath) : null);
  } catch (err) {
    console.error(`[job ${job.id}] brand frame failed:`, err.message);
    return {};
  }
}

// The client moved (or removed) their logo: re-render from the logo-free original.
// `place` = { x, y, w } fractions of the frame, or null to remove the logo.
export async function placeLogo(job, place) {
  const brand = job.brandId && getBrand(job.brandId);
  if (!brand) throw new ValidationError('Set up your brand first');
  if (place && !brand.logoPath) throw new ValidationError('Upload your logo first');
  if (job.status !== 'succeeded' || !job.cleanPath) throw new ValidationError('This post is not ready yet');
  const ok = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
  if (place && !(ok(place.x, -0.5, 1) && ok(place.y, -0.5, 1) && ok(place.w, 0.02, 1))) throw new ValidationError('Invalid logo position');
  if (place) place = { x: place.x, y: place.y, w: place.w, variant: LOGO_VARIANTS.includes(place.variant) ? place.variant : 'color' };

  const old = job.outputPath !== job.cleanPath ? job.outputPath : null;
  const fields = await framed(job, brand, place);
  if (old && old !== fields.outputPath) fs.rmSync(old, { force: true });
  update(job, fields);
  return job;
}

// The file the Download button gives: brand videos get the client's contact card appended,
// made on first download and kept until the logo or the contact details change.
export async function downloadFile(job) {
  if (job.status !== 'succeeded') throw new ValidationError('This post is not ready yet');
  const brand = job.kind === 'video' && job.brandId && getBrand(job.brandId);
  if (!hasContact(brand)) return job.outputPath;
  const file = path.join(OUTPUTS_DIR, `${path.basename(job.outputPath, '.mp4')}-card-${Date.parse(brand.updatedAt)}.mp4`);
  if (!fs.existsSync(file)) await addEndCard(job.outputPath, file, brand);
  return file;
}

export function deleteJob(job) {
  jobs.delete(job.id);
  store.del(job.id);
  if (job.imagePath) fs.rmSync(job.imagePath, { force: true });
  // Every output of this job (with or without logo, with contact card) starts with its id.
  for (const f of fs.readdirSync(OUTPUTS_DIR)) if (f.startsWith(job.id)) fs.rmSync(path.join(OUTPUTS_DIR, f), { force: true });
}

// ---- Worker ----

async function runJob(job) {
  try {
    if (job.kind === 'image') return await runImageJob(job);
    const provider = PROVIDERS[job.provider];
    if (!job.operationName) {
      update(job, { status: 'running' });
      update(job, { operationName: await provider.start(job, job.imagePath) });
    }
    while (true) {
      if (!jobs.has(job.id)) return; // deleted mid-flight
      if (Date.now() - new Date(job.createdAt) > TIMEOUT_MS) throw new Error('Timed out after 10 minutes');
      const result = await provider.poll(job.operationName);
      if (result.done) {
        const file = `${job.id}.mp4`;
        const outputPath = path.join(OUTPUTS_DIR, file);
        await provider.download(result.videoUri, outputPath, job);
        const url = `/media/videos/${file}`;
        const done = { status: 'succeeded', outputPath, cleanPath: outputPath, outputUrl: url, videoUrl: url };
        update(job, { ...done, ...(await autoFrame({ ...job, ...done })) });
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } catch (err) {
    console.error(`[job ${job.id}]`, err.message);
    if (jobs.has(job.id)) update(job, { status: 'failed', error: err.message });
  }
}

async function runImageJob(job) {
  update(job, { status: 'running' });
  const provider = IMAGE_PROVIDERS[job.provider === 'mock' ? 'mock' : 'live'];
  const { buffer, mimeType } = await provider.generate(job, job.imagePath);
  if (!jobs.has(job.id)) return;
  const file = `${job.id}${EXT[mimeType] || '.png'}`;
  const outputPath = path.join(OUTPUTS_DIR, file);
  fs.writeFileSync(outputPath, buffer);
  const done = { status: 'succeeded', outputPath, cleanPath: outputPath, outputUrl: `/media/videos/${file}` };

  // Brand posts continue straight into the video: the AI looks at the image and writes how to animate it.
  // Start it before marking the image done, so anyone polling sees the video job appear in the same refresh.
  let followUpError = null;
  if (job.next) {
    try {
      const brand = getBrand(job.brandId);
      createJob({
        kind: 'video',
        chatId: job.chatId,
        prompt: brand ? await writeVideoPrompt(brand, job.request, outputPath, job.next.durationSeconds) : job.prompt,
        aspectRatio: job.aspectRatio,
        resolution: job.next.resolution,
        durationSeconds: job.next.durationSeconds,
        provider: job.next.provider,
        image: copyImage({ ...job, ...done }),
        sourceJobId: job.id,
        request: job.request,
        title: job.title,
        brandId: job.brandId,
        userId: job.userId,
        auto: true,
      });
    } catch (err) {
      followUpError = `Couldn't start the video: ${err.message}`;
    }
  }
  update(job, { ...done, ...(await autoFrame({ ...job, ...done })), followUpError });
}

// Resume jobs that were in flight when the server stopped.
for (const job of jobs.values()) {
  if (job.status === 'queued' || job.status === 'running') runJob(job);
}
