import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { omni } from './providers/omni.js';
import {
  ASPECT_RATIOS, DATA_DIR, DURATIONS, IMAGE_PROVIDERS, IMAGE_TYPES, PROVIDERS, RESOLUTIONS, UPLOADS_DIR, ValidationError,
  createJob, defaultProviderId, deleteJob, downloadFile, getJob, listJobs, placeLogo, toPublic,
} from './jobs.js';
import { mountMcp } from './mcp.js';
import { authEnabled, mountAuth, requireAuth } from './auth.js';
import { BrandError, brandToPublic, currentBrand, getBrand, imagePrompt, saveBrand, writeVideoPrompt } from './brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIST = path.resolve(ROOT, '..', 'web', 'dist');
const PORT = Number(process.env.API_PORT || process.env.PORT) || 8787;

const app = express();
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || '.png'}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    IMAGE_TYPES.includes(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('Image must be PNG, JPEG or WebP'), { status: 400 })),
});

// Correct client IPs and https detection behind a proxy. Railway sits one proxy hop in front (TRUST_PROXY=1).
const trust = process.env.TRUST_PROXY;
app.set('trust proxy', trust === undefined ? 'loopback' : /^\d+$/.test(trust) ? Number(trust) : trust);
app.get('/healthz', (_req, res) => res.send('ok')); // for the host's health check
mountAuth(app);
app.use('/api', requireAuth);

app.get('/api/config', (_req, res) => {
  res.json({
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      available: p.available,
      pricePerSecond: p.pricePerSecond,
    })),
    image: { available: IMAGE_PROVIDERS.live.available, label: IMAGE_PROVIDERS.live.label, pricePerImage: IMAGE_PROVIDERS.live.pricePerImage },
    imageSizes: Object.keys(IMAGE_PROVIDERS.live.pricePerImage),
    defaultProvider: defaultProviderId(),
    durations: DURATIONS,
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    rules: { '1080pRequiresDuration': 8 },
  });
});

app.get('/api/jobs', (_req, res) => res.json(listJobs().map(toPublic)));

app.get('/api/jobs/:id', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); // the ChatGPT player widget polls this
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(toPublic(job));
});

app.post('/api/jobs', upload.single('image'), (req, res) => {
  try {
    const job = createJob({ ...req.body, image: req.file ?? null });
    res.status(201).json(toPublic(job));
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).json({ error: err.message });
  }
});

// ---- Brand kits ----

async function brandRoute(req, res, id) {
  try {
    const { name, industry, website, featured, contact, endCard, colors } = req.body;
    const brand = await saveBrand({ id, name, industry, website, featured, contact, endCard, colors, logo: req.file ?? null });
    res.status(id ? 200 : 201).json(brandToPublic(brand));
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    res.status(err instanceof BrandError ? 400 : 502).json({ error: err.message });
  }
}
app.post('/api/brands', upload.single('logo'), (req, res) => brandRoute(req, res));
app.put('/api/brands/:id', upload.single('logo'), (req, res) => brandRoute(req, res, req.params.id));
app.get('/api/brands/current', (_req, res) => {
  const brand = currentBrand();
  if (!brand) return res.status(404).json({ error: 'No brand yet' });
  res.json(brandToPublic(brand));
});
app.get('/api/brands/:id', (req, res) => {
  const brand = getBrand(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  res.json(brandToPublic(brand));
});

// A festival ("Diwali") → image from the client's details; once it's ready the server asks the AI how to animate it
// and makes the video (jobs.js). With `changeOf`, makes the video for a finished image whose video didn't start.
app.post('/api/brand-posts', express.json(), async (req, res) => {
  const { brandId, chatId, request, changeOf, aspectRatio = '9:16', imageSize, resolution, durationSeconds, provider } = req.body ?? {};
  const brand = getBrand(brandId);
  if (!brand) return res.status(404).json({ error: 'Set up your brand first' });
  try {
    if (changeOf) {
      const base = getJob(changeOf);
      if (!base || base.kind !== 'image' || base.status !== 'succeeded') return res.status(400).json({ error: 'That post is no longer available' });
      const prompt = await writeVideoPrompt(brand, base.request, base.cleanPath, durationSeconds);
      const job = createJob({
        kind: 'video', chatId, prompt, request: base.request, title: base.title, aspectRatio: base.aspectRatio,
        resolution, durationSeconds, provider, brandId, sourceJobId: base.id, auto: true,
      });
      return res.status(201).json(toPublic(job));
    }
    if (!request?.trim()) return res.status(400).json({ error: 'Pick a festival' });
    const job = createJob({
      kind: 'image', chatId, prompt: imagePrompt(brand, request.trim()), request: request.trim(), title: request.trim(),
      aspectRatio, imageSize, provider, brandId, next: { resolution, durationSeconds, provider },
    });
    res.status(201).json(toPublic(job));
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 502).json({ error: err.message });
  }
});

// Body: { x, y, w } (fractions of the frame) to place the logo, or { remove: true }.
app.post('/api/jobs/:id/logo', express.json(), async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try {
    const b = req.body ?? {};
    res.json(toPublic(await placeLogo(job, b.remove ? null : { x: b.x, y: b.y, w: b.w })));
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 500).json({ error: err.message });
  }
});

// Saves the post; brand videos come with the contact card at the end.
app.get('/api/jobs/:id/download', async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try {
    const file = await downloadFile(job);
    res.download(file, `${(job.title || 'post').replace(/[^\w -]/g, '').trim() || 'post'}${path.extname(file)}`);
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  deleteJob(job);
  res.status(204).end();
});

// ?download=1 makes the browser (and the Android app) save the file instead of opening it.
app.use('/media', (req, res, next) => {
  if (req.query.download) res.attachment(path.basename(req.path));
  next();
});
app.use('/media', express.static(DATA_DIR));

mountMcp(app);

// Serve the built frontend so `npm start` is a single URL.
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api|media|mcp).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image must be under 10 MB' });
  res.status(err.status || (err instanceof multer.MulterError ? 400 : 500)).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(omni.available ? 'Video: Gemini Omni Flash' : 'No GEMINI_API_KEY: demo mode only');
  console.log(authEnabled() ? `Login required (${process.env.AUTH_EMAIL})` : 'WARNING: login is off (set AUTH_EMAIL, AUTH_PASSWORD_HASH, AUTH_SECRET)');
});
