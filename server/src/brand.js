// Brand kits: a client's business, featured products, logo and contact details, read once, then used to turn
// short requests ("Diwali post") into full creative briefs, to stamp the real logo onto every image and video,
// and to close videos with a contact card.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from './paths.js';
import { fetchRetry } from './providers/http.js';
import { WebsiteError, normalizeUrl, readWebsite } from './website.js';

const BRANDS_FILE = path.join(DATA_DIR, 'brands.json');
const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-flash-latest';
const run = promisify(execFile);

// ---- Store ----

const brands = new Map();
if (fs.existsSync(BRANDS_FILE)) {
  for (const b of JSON.parse(fs.readFileSync(BRANDS_FILE, 'utf8'))) brands.set(b.id, b);
}
const save = () => fs.writeFileSync(BRANDS_FILE, JSON.stringify([...brands.values()], null, 2));

export const getBrand = (id) => brands.get(id);

// No logins yet, so the company set up most recently is "the" company on this server.
export const currentBrand = () => [...brands.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

export function brandToPublic(b) {
  const { logoPath, logoMime, ...rest } = b;
  return rest;
}

const CONTACT_FIELDS = ['phone', 'email', 'website', 'address'];

// Products or services the client wants in their posts: a list of short names.
function cleanFeatured(list) {
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = list.split(/[\n,]/);
    }
  }
  const items = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean))];
  if (items.length > 10) throw new BrandError('Pick up to 10 products or services');
  if (items.some((x) => x.length > 80)) throw new BrandError('Keep each product or service under 80 characters');
  return items;
}

// Contact details for the end card of videos. All optional.
function cleanContact(contact) {
  if (typeof contact === 'string') {
    try {
      contact = JSON.parse(contact);
    } catch {
      contact = {};
    }
  }
  const out = {};
  for (const k of CONTACT_FIELDS) {
    const v = String(contact?.[k] ?? '').trim().replace(/\s+/g, ' ');
    if (v.length > 120) throw new BrandError(`Keep the ${k} under 120 characters`);
    if (v) out[k] = v;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new BrandError('That email address doesn’t look right');
  return out;
}

export const hasContact = (brand) => Boolean(brand?.endCard && brand.contact && Object.keys(brand.contact).length);

// `logo` is { path, mimetype } of an uploaded file, or null to keep the current one.
export async function saveBrand({ id, name, industry, logo, website, featured, contact, endCard }) {
  industry = (industry || '').trim();
  name = (name || '').trim();
  if (!name) throw new BrandError('Tell us your business name');
  if (!industry) throw new BrandError('Tell us what your business does');
  if (industry.length > 500) throw new BrandError('Keep the business description under 500 characters');
  featured = cleanFeatured(featured);
  contact = cleanContact(contact);
  const existing = id ? brands.get(id) : null;
  if (id && !existing) throw new BrandError('Brand not found');
  if (!logo && !existing) throw new BrandError('Upload your logo');
  let site = null;
  try {
    site = normalizeUrl(website);
  } catch (err) {
    throw new BrandError(err.message);
  }

  const brand = existing ?? { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  if (logo) {
    if (existing?.logoPath) fs.rmSync(existing.logoPath, { force: true });
    Object.assign(brand, { logoPath: logo.path, logoMime: logo.mimetype, logoUrl: `/media/uploads/${path.basename(logo.path)}` });
  }
  Object.assign(brand, {
    name, industry, featured, contact,
    endCard: Object.keys(contact).length > 0 && endCard !== false && endCard !== 'false',
    updatedAt: new Date().toISOString(),
  });
  if (logo || !brand.colors) Object.assign(brand, await readLogo(brand));
  // Read the website when it's new or changed. A site that can't be read doesn't block saving.
  if (!site) Object.assign(brand, { website: null, websiteProfile: null, websiteError: null });
  else if (site !== brand.website || !brand.websiteProfile) {
    brand.website = site;
    try {
      Object.assign(brand, { websiteProfile: await studyWebsite(brand, await readWebsite(site)), websiteError: null });
    } catch (err) {
      Object.assign(brand, { websiteProfile: null, websiteError: `Couldn’t read the website: ${err instanceof WebsiteError ? err.message : 'it took too long or blocked us'}` });
    }
  }
  brands.set(brand.id, brand);
  save();
  return brand;
}

export class BrandError extends Error {}

// ---- Gemini text calls ----

const live = () => Boolean(process.env.GEMINI_API_KEY);

async function askGemini({ system, parts, schema }) {
  const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 1.1 },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || 'request failed'}`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini returned an unreadable answer. Try again.');
  }
}

async function readLogo(brand) {
  if (!live()) return { colors: [], style: 'Demo mode: colours are read once a Gemini key is set' };
  return askGemini({
    system:
      'You are a brand designer. From the logo, extract the brand palette: 2 to 5 dominant brand colours as hex codes, ' +
      'most important first. Ignore a plain white or transparent background unless it is clearly part of the brand. ' +
      'Also describe the visual style in under 12 words (for example "modern, minimal, corporate, geometric").',
    parts: [
      { text: `Business: ${brand.name}. What they do: ${brand.industry}` },
      { inlineData: { mimeType: brand.logoMime, data: fs.readFileSync(brand.logoPath).toString('base64') } },
    ],
    schema: {
      type: 'OBJECT',
      properties: { colors: { type: 'ARRAY', items: { type: 'STRING' } }, style: { type: 'STRING' } },
      required: ['colors', 'style'],
    },
  });
}

// Turns the raw website into a short company profile the brief writer can use.
export async function studyWebsite(brand, site) {
  if (!live()) return { summary: site.description || site.title, products: [], audience: '', tone: '', visualStyle: '', colors: site.colors, fonts: site.fonts };
  const profile = await askGemini({
    system:
      'You are a brand strategist. From this company’s website (page text, CSS colours and fonts, and photos), write an accurate, ' +
      'concise profile for designers making their social media posts. Use only what the website shows; do not invent facts. ' +
      'products: their real products or services by name (max 8). visualStyle: how their website and photos look ' +
      '(photography vs illustration, light or dark, minimal or busy, materials, mood), in under 40 words. ' +
      'colors: their main brand colours as hex codes, most important first (max 5).',
    parts: [
      {
        text:
          `Business: ${brand.name}. They describe themselves as: ${brand.industry}\nWebsite: ${site.url}\nTitle: ${site.title}\n` +
          `Description: ${site.description}\nCSS colours (most used first): ${site.colors.join(', ') || 'none found'}\n` +
          `Fonts: ${site.fonts.join(', ') || 'none found'}\n\n` +
          site.pages.map((p) => `--- ${p.url}\n${p.text}`).join('\n\n'),
      },
      ...site.images.map((img) => ({ inlineData: img })),
    ],
    schema: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        products: { type: 'ARRAY', items: { type: 'STRING' } },
        audience: { type: 'STRING' },
        tone: { type: 'STRING' },
        visualStyle: { type: 'STRING' },
        colors: { type: 'ARRAY', items: { type: 'STRING' } },
        fonts: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['summary', 'products', 'audience', 'tone', 'visualStyle', 'colors', 'fonts'],
    },
  });
  return { ...profile, readAt: new Date().toISOString(), pagesRead: site.pages.length };
}

const BRIEF_SYSTEM = `You are the executive creative director of a world-class advertising agency, famous for festival campaigns that feel made
for one specific business: original, warm, on-brand and culturally precise. A business gives you a festival or occasion. You write
the brief for an AI image model (the post) and an AI video model (which animates that exact image into a short reel).

THE CLIENT
The client message tells you what the business does, the products or services they want featured, their brand colours and logo
style, and sometimes a profile read from their website. Treat it as the truth about them. Never invent products, prices, offers,
awards, statistics or claims. The test of every post: it could only have been made for THIS business. A generic festival
greeting that any company could post is a failure.

ART DIRECTION
The client message gives a required art style for this post. Commit to it fully; it sets the look of the image and the video.
If earlier concepts for this occasion are listed, your idea must be clearly different from all of them: a new subject, a new
metaphor and a new composition, never a variation of a previous one.

STEP 1, featured (field "featured"):
Choose ONE of the client's featured products or services as the hero of this post, written exactly as the client wrote it.
Prefer one that was not featured recently (listed in the message) and that has the most natural, beautiful link to this occasion.
If the client gave no list, choose their most recognisable real product or service from what they do or their website.

STEP 2, concept (field "concept"):
Imagine three different ideas where the featured offering meets the spirit of the occasion: through its shape, materials, the craft
or process behind it, the people who use it, or the moment it creates for their customers. Avoid clichés and stock imagery.
Pick the strongest, most visual and most emotionally resonant idea and describe it in 2 sentences.
Physical products stay recognisable and true to life (real shape, proportions, materials, finish); never melt, morph or rebuild them
into festival objects. The occasion transforms the world AROUND the product: its setting, light, decoration and story.
Services are shown through the experience or the result, with real-looking people and places that fit the business's customers.

STEP 3, greeting (field "greeting"):
The exact words on the post: a warm greeting for the occasion plus the business name, at most 7 words in total, on one or two lines,
for example "Happy Diwali" / "from Acme Prints". Use the occasion's correct, commonly used spelling. If the client's request includes
their own words, an offer or a message, use their words exactly (up to 12 words). Use "none" only if the client asked for no text.

STEP 4, imagePrompt (one flowing paragraph, 150 to 230 words):
Write it the way a master art director briefs a photographer or CGI artist: vivid, specific and sensory, precise about what matters
and leaving the model room to invent the incidental detail. Cover, in this order:
1. Format and medium: a {ASPECT} premium social media post; photoreal CGI or high-end photography, or the medium the art style asks for.
2. The hero: the featured offering, exactly what it looks like (form, material, finish, scale), and how the occasion surrounds it.
3. Composition: one clear focal point and a visual hierarchy designed for {ASPECT}, using the full frame edge to edge. The greeting
   sits in a clean area (usually the lower third) with breathing room so it reads instantly on a phone. Keep the top-right corner
   calm and uncluttered: the client places their real logo there afterwards.
4. The occasion: the symbols, objects, colours and light that genuinely belong to THIS occasion and region (for example diyas,
   rangoli and marigolds for Diwali; a trident, lion and red-and-white for Durga Puja), respectful and accurate, never mixing festivals.
5. Colour: the brand colours (give the hex codes) lead the palette; the occasion's traditional colours support them in harmony.
6. Light and mood: key light, rim light, glow, depth of field, atmosphere (bokeh, sparks, dust, haze) and the emotion it should create.
7. Typography: the greeting in double quotes, exactly as in "greeting", with font style, weight, colour, effect and placement.
8. Finish: crisp, high detail, commercial advertising quality.
End with these rules, written out: "Render the quoted text exactly once, spelled exactly as written, with perfect letters; no other
text, words, numbers or letters anywhere. No logos, brand marks, watermarks or signatures."

STEP 5, videoPrompt (120 to 180 words): you are now a senior video editor cutting a premium brand reel that starts from THIS image.
Write it as a timed shot list with the cuts, for the requested length:
- Shot 1, the hook (first ~1.5 s): an arresting opening on a detail of the scene (a macro close-up of the featured product or
  service, a reveal from darkness, or a fast push-in), so viewers stop scrolling.
- Shots 2 and 3, the build: two different angles or close-ups of the featured offering and the festival details from the same
  scene, joined with professional transitions (a match cut, whip pan, speed ramp, light-leak or focus-pull), each with its own
  motion (rotation, sparks, petals, flowing light, people's hands at work).
- Final shot, the payoff (last ~2 s): settle on the full composition exactly as in the image, with the greeting crisp and still,
  held calmly to the end.
- Edit rhythm: cuts land on the music's beats; keep the colour grade and lighting continuous across shots.
- Sound design: music for the occasion and region (for example temple bells and sitar for Diwali, dhak drums for Durga Puja,
  dhol for Navratri) with a rising build, a hit on the reveal, subtle whooshes on transitions{ENDING}.
- Rules, written out: "All shots belong to the same scene, colours and lighting. The featured product keeps its real shape and
  details in every shot. The greeting appears only in the final shot, exactly as written in the image, sharp and legible; it never
  moves, changes, repeats or duplicates. No other text, no logos, no watermarks. No morphing or distortion of the subject."

title: 2 to 5 words naming the post.

Everything you write must be in flawless English: correct spelling and grammar, no repeated sentences or phrases.`;

const END_CARD_NOTE =
  ', and the music resolves on the final beat with a soft ring-out (the app adds its own closing card with the logo and contact ' +
  'details after this shot, so never show contact details, phone numbers or web addresses yourself)';

function clientContext(brand, recentFeatured = []) {
  const w = brand.websiteProfile;
  const featured = brand.featured?.length ? brand.featured : null;
  return (
    `Business name: ${brand.name}\nWhat they do: ${brand.industry}\n` +
    (featured
      ? `Products and services they want featured: ${featured.join('; ')}\n` +
        (recentFeatured.length ? `Featured in their most recent posts (prefer a different one): ${recentFeatured.join('; ')}\n` : '')
      : '') +
    `Brand colours (from the logo): ${brand.colors?.join(', ') || 'not known'}\nLogo style: ${brand.style || 'not known'}\n` +
    (w
      ? `From their website (${brand.website}):\n` +
        `- About them: ${w.summary}\n- Products and services: ${w.products.join('; ') || 'not listed'}\n` +
        `- Customers: ${w.audience}\n- Tone of voice: ${w.tone}\n- Visual style: ${w.visualStyle}\n` +
        `- Website colours: ${w.colors.join(', ') || 'not found'}\n- Website fonts: ${w.fonts.join(', ') || 'not found'}\n`
      : '')
  );
}

// Art styles rotated between posts so every generation looks different.
export const STYLES = [
  'cinematic product photography: dramatic studio lighting, rich reflections, shallow depth of field',
  'luxury minimal: deep matte background, gold-foil accents, generous negative space, editorial layout',
  'layered paper-cut art: handcrafted paper layers, soft cast shadows, tactile depth',
  '3D isometric miniature world: a tiny detailed diorama, tilt-shift feel, playful but premium',
  'bold flat illustration: confident shapes, vibrant colour blocking, clean vector look',
  'Indian folk-art fusion: Madhubani or Kalamkari inspired patterns framing a modern composition',
  'neon night: glowing light trails, dark atmosphere, cinematic haze',
  'warm documentary photography: real people, the workplace and craftsmanship, golden-hour light',
  'watercolour and ink: flowing washes, delicate line work, airy and elegant',
  'bold typographic poster: strong grid, oversized type as the hero, graphic shapes',
  'soft glassmorphism: frosted glass panels, gradients, modern tech aesthetic',
  'macro detail: extreme close-up of materials and textures, jewel-like highlights',
];

export function pickStyle(recent = []) {
  const fresh = STYLES.filter((s) => !recent.includes(s));
  const pool = fresh.length ? fresh : STYLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// `variety` = { style, avoid: [earlier concepts for this occasion], recentFeatured: [offerings in recent posts] } for new posts.
// `revision` = { previousPrompt, change, featured } when the client asks to change an earlier post.
export async function writeBrief(brand, request, aspectRatio, revision, variety, seconds = 8) {
  if (!live()) {
    const featured = revision?.featured || brand.featured?.[0] || null;
    return {
      featured,
      title: request.slice(0, 40),
      imagePrompt: `${request} for ${brand.name || 'a business'} that ${brand.industry}${featured ? `, featuring ${featured}` : ''}. Premium social media post, ${aspectRatio}.`,
      videoPrompt: 'Gentle cinematic motion, drifting light particles, slow push-in.',
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const system = BRIEF_SYSTEM
    .replaceAll('{ASPECT}', aspectRatio === '9:16' ? 'vertical 9:16' : 'landscape 16:9')
    .replace('{ENDING}', hasContact(brand) ? END_CARD_NOTE : '');
  return askGemini({
    system,
    parts: [
      {
        text:
          clientContext(brand, variety?.recentFeatured) +
          `Today: ${today}\nClient request: ${request}\nVideo length: ${seconds} seconds (time the shot list to fill exactly this)` +
          (variety?.style ? `\nRequired art style for this post: ${variety.style}` : '') +
          (variety?.avoid?.length ? `\nEarlier concepts for this occasion (do NOT repeat or resemble these):\n- ${variety.avoid.join('\n- ')}` : '') +
          (revision
            ? `\n\nThis is a REVISION of an earlier post. The earlier image prompt was:\n${revision.previousPrompt}\n` +
              (revision.featured ? `It featured: ${revision.featured}. Keep featuring it unless the change asks otherwise.\n` : '') +
              `The client wants this change: ${revision.change}\n` +
              'Rewrite both prompts so they keep everything the client did not ask to change and apply the change clearly. ' +
              'The earlier image is attached to the image model as a reference.'
            : ''),
      },
    ],
    schema: {
      type: 'OBJECT',
      // Order matters: the offering, concept and greeting are decided before the prompts are written.
      properties: {
        featured: { type: 'STRING' },
        concept: { type: 'STRING' },
        greeting: { type: 'STRING' },
        imagePrompt: { type: 'STRING' },
        videoPrompt: { type: 'STRING' },
        title: { type: 'STRING' },
      },
      required: ['featured', 'concept', 'greeting', 'imagePrompt', 'videoPrompt', 'title'],
      propertyOrdering: ['featured', 'concept', 'greeting', 'imagePrompt', 'videoPrompt', 'title'],
    },
  });
}

// ---- Logo overlay ----

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:format=duration', '-of', 'json', file]);
  const { streams = [], format = {} } = JSON.parse(stdout);
  const v = streams.find((s) => s.codec_type === 'video') ?? {};
  const [n, d] = String(v.avg_frame_rate).split('/').map(Number);
  return { w: v.width, h: v.height, fps: n && d ? v.avg_frame_rate : '24', duration: Number(format.duration) || 0, audio: streams.some((s) => s.codec_type === 'audio') };
}

// Places the logo where the client put it: `place` = { x, y, w } as fractions of the frame
// (top-left corner and width; height follows the logo's shape). Works for images and MP4s.
export async function stampLogo(input, output, brand, place) {
  const { w, h } = await probe(input);
  const lw = Math.max(2, Math.round(w * place.w / 2) * 2);
  const filter = `[1:v]scale=${lw}:-2[logo];[0:v][logo]overlay=${Math.round(w * place.x)}:${Math.round(h * place.y)}`;
  const video = output.endsWith('.mp4');
  const codec = video
    ? ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart']
    : ['-frames:v', '1', '-q:v', '2'];
  await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-i', brand.logoPath, '-filter_complex', filter, ...codec, output]);
}

// ---- End card (contact details after the video) ----

const CARD_SECONDS = 3;
const CROSSFADE = 0.6;
const FONTS = {
  bold: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Unicode.ttf'],
  regular: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial Unicode.ttf'],
};
const font = (kind) => FONTS[kind].find((f) => fs.existsSync(f));
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) lines.push(line), (line = word);
    else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

// A brand colour bright enough to read on the dark card, else soft white.
function accent(colors = []) {
  for (const c of colors) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) continue;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35) return `0x${m[1]}`;
  }
  return 'white@0.75';
}

// Appends a closing card to `input`: the last frame blurred and dimmed, the logo on a white plate, the business
// name and the contact details, faded in from the video. Text is drawn by ffmpeg, so numbers are always exact.
export async function addEndCard(input, output, brand) {
  const c = brand.contact ?? {};
  const fontBold = font('bold');
  const fontRegular = font('regular');
  if (!fontBold || !fontRegular) throw new Error('No font available for the end card');
  const v = await probe(input);
  const logo = await probe(brand.logoPath);
  const { w: W, h: H, fps } = v;
  const S = Math.min(W, H);
  const portrait = H > W;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'endcard-'));
  try {
    // Logo on a rounded white plate, so dark and transparent logos both read.
    const maxW = portrait ? W * 0.5 : W * 0.26;
    const maxH = S * 0.2;
    const k = Math.min(maxW / logo.w, maxH / logo.h);
    const lw = even(logo.w * k);
    const lh = even(logo.h * k);
    const pad = even(S * 0.04);
    const pw = lw + 2 * pad;
    const ph = lh + 2 * pad;
    const r = Math.round(Math.min(ph, pw) * 0.18);
    const round = `if(gt(abs(X-W/2),W/2-${r})*gt(abs(Y-H/2),H/2-${r}),if(lte(hypot(abs(X-W/2)-(W/2-${r}),abs(Y-H/2)-(H/2-${r})),${r}),255,0),255)`;
    const plate = path.join(tmp, 'plate.png');
    await run('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=${pw}x${ph}`, '-i', brand.logoPath, '-filter_complex',
      `[1:v]scale=${lw}:${lh}[l];[0:v][l]overlay=${pad}:${pad},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${round}'`,
      '-frames:v', '1', plate,
    ]);
    const last = path.join(tmp, 'last.png');
    await run('ffmpeg', ['-y', '-v', 'error', '-sseof', '-0.25', '-i', input, '-frames:v', '1', '-update', '1', last]);

    // Text lines, laid out top to bottom and centred as one block.
    const nameSize = Math.round(Math.min(S * 0.066, (W * 0.86) / (brand.name.length * 0.62)));
    const lineSize = Math.round(S * (portrait ? 0.042 : 0.038));
    const maxChars = Math.floor((W * 0.84) / (lineSize * 0.58));
    const site = c.website?.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const lines = [c.phone, c.email, site, ...(c.address ? wrap(c.address, maxChars) : [])].filter(Boolean);
    const gap = S * 0.05;
    const capSize = Math.round(S * 0.024);
    const lineStep = lineSize * 1.6;
    const block = ph + gap + nameSize + gap * 0.7 + 3 + gap * 0.7 + capSize + gap * 0.55 + lines.length * lineStep;
    let y = Math.max(S * 0.04, (H - block) / 2);
    const plateY = Math.round(y);
    y += ph + gap;

    const files = {};
    const text = (key, value) => fs.writeFileSync((files[key] = path.join(tmp, `${key}.txt`)), value);
    // Each element fades in and rises a little, one after another.
    const draw = (key, fontfile, size, color, top, delay) =>
      `drawtext=fontfile='${fontfile}':textfile='${files[key]}':expansion=none:fontsize=${size}:fontcolor=${color}` +
      `:x=(w-text_w)/2:y=${Math.round(top)}+${Math.round(S * 0.02)}*(1-min(1\\,max(0\\,(t-${delay})/0.5)))` +
      `:alpha='min(1\\,max(0\\,(t-${delay})/0.5))'`;
    text('name', brand.name);
    const parts = [draw('name', fontBold, nameSize, 'white', y, 0.35)];
    y += nameSize + gap * 0.7;
    const dw = Math.round(S * 0.1);
    parts.push(`drawbox=x=${Math.round((W - dw) / 2)}:y=${Math.round(y)}:w=${dw}:h=3:color=${accent(brand.colors)}:t=fill:enable='gte(t,0.5)'`);
    y += 3 + gap * 0.7;
    text('cap', 'G E T   I N   T O U C H');
    parts.push(draw('cap', fontBold, capSize, 'white@0.6', y, 0.5));
    y += capSize + gap * 0.55;
    lines.forEach((line, i) => {
      text(`l${i}`, line);
      parts.push(draw(`l${i}`, fontRegular, lineSize, 'white@0.92', y, 0.6 + i * 0.12));
      y += lineStep;
    });

    const D = v.duration;
    const total = D - CROSSFADE + CARD_SECONDS;
    const filter = [
      `[1:v]scale=${W}:${H},setsar=1,gblur=sigma=${Math.round(S * 0.04)},eq=brightness=-0.1:saturation=0.9,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.5:t=fill[bg]`,
      `[2:v]format=rgba,fade=t=in:st=0.15:d=0.5:alpha=1[pl]`,
      `[bg][pl]overlay=x=(W-w)/2:y=${plateY}:shortest=1,${parts.join(',')},fps=${fps},format=yuv420p[card]`,
      `[0:v]fps=${fps},setsar=1,format=yuv420p[main]`,
      `[main][card]xfade=transition=fade:duration=${CROSSFADE}:offset=${(D - CROSSFADE).toFixed(3)}[v]`,
      ...(v.audio ? [`[0:a]afade=t=out:st=${Math.max(0, D - 0.8).toFixed(3)}:d=0.8,apad=whole_dur=${total.toFixed(3)}[a]`] : []),
    ].join(';');
    const still = ['-loop', '1', '-framerate', String(fps), '-t', String(CARD_SECONDS)];
    await run('ffmpeg', [
      '-y', '-v', 'error', '-i', input, ...still, '-i', last, ...still, '-i', plate, '-filter_complex', filter,
      '-map', '[v]', ...(v.audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
