import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { omni } from './providers/omni.js';
import {
  ASPECT_RATIOS, DURATIONS, IMAGE_PROVIDERS, IMAGE_TYPES, PROVIDERS, RESOLUTIONS, UPLOADS_DIR, ValidationError,
  createJob, defaultProviderId, deleteJob, downloadFile, getJob, listJobs, placeLogo, toPublic,
} from './jobs.js';
import { mountMcp } from './mcp.js';
import {
  AuthError, adminId, createInvite, createReset, createUser, listUsers, updateLogin, mountAuth, paidCount, requireAdmin, requireAuth, setPaid,
  startSession, toPublicUser,
} from './auth.js';
import { BrandError, brandOf, brandToPublic, getBrand, imagePrompt, saveBrand, writeVideoPrompt } from './brand.js';
import { db } from './db.js';
import { previewLogo } from './logo.js';
import { checkPayment, createPayment, getPayment, onlinePayments, webhookOrder } from './payments.js';
import { BASE_PATH, OUTPUTS_DIR } from './paths.js';

// The Diwali Pack: what a paying customer can make. Admins can make anything.
const PACK = {
  name: 'Diwali Pack',
  festivals: ['Dhanteras', 'Diwali', 'Hindu New Year', 'Labh Pancham', 'Bhai Dooj'],
  video: ['Dhanteras', 'Diwali', 'Hindu New Year'], // video posts; the others are photo posts
  designs: 1, // per festival; more are paid redos
  redoPrice: 199, // rupees
  // Rupees. Keep in step with web/src/offer.ts, which shows them on the landing page.
  price: 999,
  regularPrice: 2999,
  launchEnds: '2026-11-05', // the launch price applies to the end of this day (India time)
};
const packPrice = () => (Date.now() <= Date.parse(`${PACK.launchEnds}T23:59:59+05:30`) ? PACK.price : PACK.regularPrice);
const FORMAT = { aspectRatio: '9:16', imageSize: '2K', resolution: '720p', durationSeconds: 8 };

// A new design for a festival: the image, and for video festivals (always, for admins) the video made from it.
function newDesign(user, brand, festival, chatId, opts = {}) {
  const o = { ...FORMAT, provider: defaultProviderId(), ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v != null)) };
  const video = user.role === 'admin' || PACK.video.includes(festival);
  return createJob({
    kind: 'image', chatId: chatId || crypto.randomUUID(), prompt: imagePrompt(brand, festival), request: festival, title: festival, aspectRatio: o.aspectRatio,
    imageSize: o.imageSize, provider: o.provider, brandId: brand.id, userId: user.id,
    next: video ? { resolution: o.resolution, durationSeconds: o.durationSeconds, provider: o.provider } : null,
  });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIST = path.resolve(ROOT, '..', 'web', 'dist');
const PORT = Number(process.env.API_PORT || process.env.PORT) || 8787;
const BASE = BASE_PATH;

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
// Served under BASE_PATH (www.quotegen.ai/digiteqstudio forwards here with the path as it is): drop it, so every
// route below works the same with or without it.
app.use((req, _res, next) => {
  if (BASE && (req.url === BASE || req.url.startsWith(`${BASE}/`) || req.url.startsWith(`${BASE}?`))) {
    req.url = req.url.slice(BASE.length) || '/';
    req.originalUrl = req.url; // what the sign-in check reads
  }
  next();
});
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
    pack: PACK,
  });
});

// For the landing page: how many founding spots are taken.
// For the landing page and the funnel: founding spots taken, and whether payments go through PhonePe.
app.get('/api/public/stats', (_req, res) => res.json({ paid: paidCount(), online: onlinePayments(), price: packPrice() }));

// The signed-in account owns it (admins can see everything).
const owns = (req, thing) => Boolean(thing) && (thing.userId === req.user.id || req.user.role === 'admin');

const isAdmin = (req) => req.user?.role === 'admin';

app.get('/api/jobs', (req, res) => res.json(listJobs(req.user.id).map((j) => toPublic(j, isAdmin(req)))));

app.get('/api/jobs/:id', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); // the ChatGPT player widget polls this
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(toPublic(job, isAdmin(req)));
});

// Raw jobs (any prompt) are for admins; customers make brand posts.
app.post('/api/jobs', requireAdmin, upload.single('image'), (req, res) => {
  try {
    const job = createJob({ ...req.body, image: req.file ?? null, userId: req.user.id });
    res.status(201).json(toPublic(job, isAdmin(req)));
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).json({ error: err.message });
  }
});

// ---- Brand kits ----

const brandFields = (body) => {
  const { name, industry, website, featured, contact, endCard, colors, tagline, logoBg } = body;
  return { name, industry, website, featured, contact, endCard, colors, tagline, logoBg };
};

// Each account has one brand: saving again updates it.
async function brandRoute(req, res, id) {
  try {
    if (id && !owns(req, getBrand(id))) return res.status(404).json({ error: 'Brand not found' });
    const existing = id ?? brandOf(req.user.id)?.id;
    const brand = await saveBrand({ ...brandFields(req.body), id: existing, userId: req.user.id, logo: req.file ?? null });
    res.status(existing ? 200 : 201).json(brandToPublic(brand));
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    res.status(err instanceof BrandError ? 400 : 502).json({ error: err.message });
  }
}
app.post('/api/brands', upload.single('logo'), (req, res) => brandRoute(req, res));
app.put('/api/brands/:id', upload.single('logo'), (req, res) => brandRoute(req, res, req.params.id));
app.get('/api/brands/current', (req, res) => {
  const brand = brandOf(req.user.id);
  if (!brand) return res.status(404).json({ error: 'No brand yet' });
  res.json(brandToPublic(brand));
});
app.get('/api/brands/:id', (req, res) => {
  const brand = getBrand(req.params.id);
  if (!owns(req, brand)) return res.status(404).json({ error: 'Brand not found' });
  res.json(brandToPublic(brand));
});

// For the setup screen (signed in): what's behind an uploaded logo and how each background choice looks.
app.post('/api/logo/preview', upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload your logo' });
  try {
    res.json(await previewLogo(req.file.path));
  } catch {
    res.status(400).json({ error: 'We couldn’t read that logo. Try a PNG or JPEG.' });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

// ---- Online payments (PhonePe) ----

const origin = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// The pack, for the signed-in account: paid right after creating it, before the business details.
app.post('/api/pay/pack', async (req, res) => {
  if (req.user.paid) return res.status(400).json({ error: 'Your pack is already unlocked' });
  if (!onlinePayments()) return res.status(400).json({ error: 'Online payments are not set up' });
  try {
    res.json({ url: await createPayment({ kind: 'pack', ref: req.user.id, amount: packPrice(), returnUrl: `${origin(req)}/api/pay/return` }) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// A paid redo: make the new design in the customer's post.
function redoPaid(redoId) {
  const r = db.prepare("SELECT * FROM redos WHERE id = ? AND status = 'awaiting'").get(redoId);
  if (!r) return;
  const user = listUsers().find((u) => u.id === r.userId);
  const brand = brandOf(r.userId);
  db.prepare('UPDATE redos SET status = ? WHERE id = ?').run(user && brand ? 'done' : 'pending', r.id);
  if (user && brand) newDesign(user, brand, r.festival, r.chatId);
}

// Checks a payment with PhonePe; the first time it turns out paid, acts on it (once): unlocks the pack, or makes the redo.
async function check(row) {
  const result = await checkPayment(row.id);
  if (result.fresh && row.kind === 'pack') setPaid(row.ref, true);
  if (result.fresh && row.kind === 'redo') redoPaid(row.ref);
  return result.state;
}

// PhonePe sends the customer back here (?order=<id>): to their pack, or to the post they bought a new design for.
app.get('/api/pay/return', async (req, res) => {
  const row = onlinePayments() && getPayment(String(req.query.order || ''));
  if (!row) return res.redirect(`${BASE}/`);
  const state = await check(row).catch(() => 'pending');
  const flag = state === 'paid' ? 1 : state === 'failed' ? 0 : 'wait';
  if (row.kind === 'pack') return res.redirect(`${BASE}/?paid=${flag}`);
  const redo = db.prepare('SELECT chatId FROM redos WHERE id = ?').get(row.ref);
  res.redirect(`${BASE}/?post=${encodeURIComponent(redo?.chatId ?? '')}&paid=${flag}`);
});

// While PhonePe is still confirming the pack payment, the app asks here every few seconds.
app.get('/api/pay/status', async (req, res) => {
  if (req.user.paid) return res.json({ state: 'paid' });
  const row = db.prepare("SELECT * FROM payments WHERE kind = 'pack' AND ref = ? ORDER BY createdAt DESC").get(req.user.id);
  if (!row) return res.json({ state: 'none' });
  res.json({ state: await check(row).catch(() => 'pending') });
});

// The backup: PhonePe calls this when a payment completes, even if the customer closed the tab.
app.post('/api/pay/webhook', express.json(), async (req, res) => {
  const order = webhookOrder(req.get('authorization'), req.body);
  const row = order && getPayment(order);
  if (row) await check(row).catch(() => {});
  res.json({ ok: true });
});

// ---- Accounts ----

// The end of the funnel: the answers to the setup questions plus a login. Creates the account (payment pending)
// and its brand, and signs them in.
// "Get it now" starts here: the login and the contact details for posts (not paid yet). Payment follows straight
// away, then the 3 questions about the business in the app.
app.post('/api/signup', express.json(), (req, res) => {
  try {
    const b = req.body ?? {};
    const contact = Object.fromEntries(['phone', 'email', 'website', 'address'].map((k) => [k, String(b.contact?.[k] ?? '').trim().slice(0, 120)]).filter(([, v]) => v));
    const user = createUser({ email: b.email, phone: b.phone, password: b.password, profile: { contact, endCard: b.endCard !== false } });
    startSession(req, res, user.id);
    res.status(201).json(toPublicUser(user));
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    res.status(400).json({ error: err.message });
  }
});

const lastPack = (userId) => db.prepare("SELECT * FROM payments WHERE kind = 'pack' AND ref = ? ORDER BY createdAt DESC").get(userId);
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json(
    listUsers()
      .filter((u) => u.role === 'customer')
      .map((u) => ({
        ...toPublicUser(u),
        business: brandOf(u.id)?.name ?? null,
        // Posts actually made (one per post, however many tries it took).
        posts: new Set(listJobs(u.id).filter((j) => j.kind === 'image' && j.status === 'succeeded' && !j.auto).map((j) => j.chatId ?? j.id)).size,
        // Their latest PhonePe payment for the pack: 'created' (opened PhonePe, not finished), 'failed' or 'paid'.
        payment: lastPack(u.id)?.status ?? null,
      })),
  );
});
// Money collected online, for the dashboard.
app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT kind, COUNT(*) AS count, SUM(amount) AS amount FROM payments WHERE status = 'paid' GROUP BY kind").all();
  const sum = (kind) => rows.find((r) => r.kind === kind);
  res.json(Object.fromEntries(['pack', 'redo'].map((k) => [k, { count: sum(k)?.count ?? 0, amount: sum(k)?.amount ?? 0 }])));
});
// Ask PhonePe about a customer's latest pack payment now (e.g. they say they paid but the app still asks).
app.post('/api/admin/users/:id/check', requireAdmin, async (req, res) => {
  const row = lastPack(req.params.id);
  if (!row || !onlinePayments()) return res.json({ state: 'none' });
  try {
    res.json({ state: await check(row) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.post('/api/admin/users/:id', requireAdmin, express.json(), (req, res) => {
  setPaid(req.params.id, Boolean(req.body?.paid));
  res.status(204).end();
});
// Login help: correct an account's mobile or email…
app.patch('/api/admin/users/:id', requireAdmin, express.json(), (req, res) => {
  try {
    res.json(toPublicUser(updateLogin(req.params.id, { email: req.body?.email, phone: req.body?.phone })));
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    res.status(400).json({ error: err.message });
  }
});
// …or give them a link to set a new password (works for 3 days, once).
app.post('/api/admin/users/:id/reset', requireAdmin, (req, res) => {
  try {
    res.status(201).json({ url: `${(process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/reset/${createReset(req.params.id)}` });
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    res.status(400).json({ error: err.message });
  }
});

// A link for a customer who paid but couldn't sign up: they set a password, then the brand setup opens.
app.post('/api/admin/invites', requireAdmin, express.json(), (req, res) => {
  try {
    const token = createInvite({ email: req.body?.email, phone: req.body?.phone });
    const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ url: `${origin.replace(/\/$/, '')}/invite/${token}` });
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    res.status(400).json({ error: err.message });
  }
});

// A festival ("Diwali") → image from the client's details; once it's ready the server asks the AI how to animate it
// and makes the video (jobs.js). With `changeOf`, makes the video for a finished image whose video didn't start.
app.post('/api/brand-posts', express.json(), async (req, res) => {
  const { chatId, request, changeOf, aspectRatio = '9:16', imageSize, resolution, durationSeconds, provider } = req.body ?? {};
  const user = req.user;
  const brand = brandOf(user.id);
  if (!brand) return res.status(404).json({ error: 'Set up your brand first' });
  const brandId = brand.id;
  const userId = user.id;
  try {
    if (changeOf) {
      const base = getJob(changeOf);
      if (!owns(req, base) || base.kind !== 'image' || base.status !== 'succeeded') return res.status(400).json({ error: 'That post is no longer available' });
      const prompt = await writeVideoPrompt(brand, base.request, base.cleanPath, durationSeconds);
      const job = createJob({
        kind: 'video', chatId, prompt, request: base.request, title: base.title, aspectRatio: base.aspectRatio,
        resolution, durationSeconds, provider, brandId, userId, sourceJobId: base.id, auto: true,
      });
      return res.status(201).json(toPublic(job, isAdmin(req)));
    }
    const festival = request?.trim();
    if (!festival) return res.status(400).json({ error: 'Pick a festival' });
    // Customers make the festivals in their pack, PACK.designs each, once their payment is confirmed.
    if (user.role !== 'admin') {
      if (!user.paid) return res.status(402).json({ error: 'We’re confirming your payment. Your posts unlock as soon as it’s confirmed.' });
      if (!PACK.festivals.includes(festival)) return res.status(400).json({ error: `Your ${PACK.name} covers ${PACK.festivals.join(', ')}` });
      const made = listJobs(userId).filter((j) => j.kind === 'image' && j.request === festival && j.status !== 'failed').length;
      if (made >= PACK.designs) return res.status(400).json({ error: `You can get a new ${festival} design for ₹${PACK.redoPrice} from your post` });
    }
    res.status(201).json(toPublic(newDesign(user, brand, festival, chatId, { aspectRatio, imageSize, resolution, durationSeconds, provider }), isAdmin(req)));
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 502).json({ error: err.message });
  }
});

// ---- Paid redos: the customer asks for a new design and pays; an admin confirms the payment and it's made ----

const redoOut = (r) => ({ id: r.id, jobId: r.jobId, chatId: r.chatId, festival: r.festival, status: r.status, createdAt: r.createdAt });

// With online payments the answer is { url } (PhonePe's payment page; the design is made as soon as it's paid);
// without, the request waits for an admin to confirm the payment.
app.post('/api/redos', express.json(), async (req, res) => {
  const job = getJob(req.body?.jobId);
  if (!owns(req, job) || job.kind !== 'image' || job.status !== 'succeeded') return res.status(400).json({ error: 'That post is no longer available' });
  if (onlinePayments()) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO redos (id, userId, jobId, chatId, festival, status, createdAt) VALUES (?, ?, ?, ?, ?, 'awaiting', ?)").run(
      id, req.user.id, job.id, job.chatId, job.request, new Date().toISOString(),
    );
    try {
      const url = await createPayment({ kind: 'redo', ref: id, amount: PACK.redoPrice, returnUrl: `${origin(req)}/api/pay/return` });
      return res.json({ url });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }
  const open = db.prepare("SELECT * FROM redos WHERE userId = ? AND chatId IS ? AND status = 'pending'").get(req.user.id, job.chatId);
  if (open) return res.json(redoOut(open));
  const r = { id: crypto.randomUUID(), userId: req.user.id, jobId: job.id, chatId: job.chatId, festival: job.request, status: 'pending', createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO redos (id, userId, jobId, chatId, festival, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    r.id, r.userId, r.jobId, r.chatId, r.festival, r.status, r.createdAt,
  );
  res.status(201).json(redoOut(r));
});
app.get('/api/redos', (req, res) => {
  res.json(db.prepare("SELECT * FROM redos WHERE userId = ? AND status = 'pending'").all(req.user.id).map(redoOut));
});

app.get('/api/admin/redos', requireAdmin, (_req, res) => {
  const users = new Map(listUsers().map((u) => [u.id, u]));
  res.json(
    db.prepare("SELECT * FROM redos WHERE status = 'pending' ORDER BY createdAt").all().map((r) => {
      const u = users.get(r.userId);
      return { ...redoOut(r), business: brandOf(r.userId)?.name ?? null, phone: u?.phone ?? null, email: u?.email ?? null };
    }),
  );
});
// Payment confirmed: make the new design in the customer's post.
app.post('/api/admin/redos/:id', requireAdmin, (req, res) => {
  const r = db.prepare("SELECT * FROM redos WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Redo not found' });
  const user = listUsers().find((u) => u.id === r.userId);
  const brand = brandOf(r.userId);
  if (!user || !brand) return res.status(400).json({ error: 'That customer has no brand' });
  try {
    newDesign(user, brand, r.festival, r.chatId);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return res.status(400).json({ error: err.message });
  }
  db.prepare("UPDATE redos SET status = 'done' WHERE id = ?").run(r.id);
  res.status(204).end();
});

// Body: { x, y, w, variant } (fractions of the frame; variant 'color' | 'light' | 'grey') to place the logo, or { remove: true }.
app.post('/api/jobs/:id/logo', express.json(), async (req, res) => {
  const job = getJob(req.params.id);
  if (!owns(req, job)) return res.status(404).json({ error: 'Job not found' });
  try {
    const b = req.body ?? {};
    res.json(toPublic(await placeLogo(job, b.remove ? null : { x: b.x, y: b.y, w: b.w, variant: b.variant }), isAdmin(req)));
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 500).json({ error: err.message });
  }
});

// Saves the post; brand videos come with the contact card at the end.
app.get('/api/jobs/:id/download', async (req, res) => {
  const job = getJob(req.params.id);
  if (!owns(req, job)) return res.status(404).json({ error: 'Job not found' });
  try {
    const file = await downloadFile(job);
    res.download(file, `${(job.title || 'post').replace(/[^\w -]/g, '').trim() || 'post'}${path.extname(file)}`);
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!owns(req, job)) return res.status(404).json({ error: 'Job not found' });
  deleteJob(job);
  res.status(204).end();
});

// ?download=1 makes the browser (and the Android app) save the file instead of opening it.
app.use('/media', (req, res, next) => {
  if (req.query.download) res.attachment(path.basename(req.path));
  next();
});
// Only uploads and results: the database and other files in the data folder are never served.
app.use('/media/uploads', express.static(UPLOADS_DIR));
app.use('/media/videos', express.static(OUTPUTS_DIR));

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
  console.log(adminId ? `Admin: ${process.env.AUTH_EMAIL}` : 'No admin account: set AUTH_EMAIL and AUTH_PASSWORD_HASH');
  if (!process.env.AUTH_SECRET) console.log('WARNING: AUTH_SECRET is not set, so everyone is signed out when the server restarts');
});
