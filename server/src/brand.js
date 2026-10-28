// Brand kits: a client's industry + logo, read once, then used to turn short
// requests ("Diwali post") into full creative briefs, and to stamp the real logo
// onto every image and video.
import crypto from 'node:crypto';
import fs from 'node:fs';
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

// `logo` is { path, mimetype } of an uploaded file, or null to keep the current one.
export async function saveBrand({ id, name, industry, logo, website }) {
  industry = (industry || '').trim();
  name = (name || '').trim();
  if (!name) throw new BrandError('Tell us your business name');
  if (!industry) throw new BrandError('Tell us what your business does');
  if (industry.length > 500) throw new BrandError('Keep the business description under 500 characters');
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
  Object.assign(brand, { name, industry, updatedAt: new Date().toISOString() });
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

const BRIEF_SYSTEM = `You are the executive creative director of a world-class advertising agency, known for festival campaigns that are
original, on-brand and culturally precise. A business gives you a festival or occasion. You write the brief for an AI image model
(the post) and an AI video model (which animates that exact image).

ART DIRECTION: the client message gives a required art style for this post. Commit to it fully; it sets the look of the image
and the video. If earlier concepts for this occasion are listed, your idea must be clearly different from all of them: a new
subject, a new metaphor and a new composition, never a variation of a previous one.

If the client's website profile is given, use it: build the idea around their REAL products or services, match their visual
style and tone of voice, and keep the palette consistent with their website colours as well as their logo.

STEP 1, concept (field "concept"):
Think of three different ideas that connect what this business actually makes or does with the spirit of the occasion, in a clever,
specific way (their product, process, tools, materials or customers, transformed by the festival). Avoid clichés and generic stock
imagery that any business could post. Pick the strongest, most visual idea and describe it in 2 sentences.

STEP 2, greeting (field "greeting"):
The exact words that appear on the post: a warm greeting for the occasion plus the business name, at most 7 words in total,
on one or two lines, for example "Happy Diwali" / "from Acme Prints". Use the occasion's correct, commonly used spelling.
If the client asked for specific text, use their words exactly. Use "none" only if the client asked for no text.

STEP 3, imagePrompt (one detailed paragraph, 130 to 200 words), covering in this order:
1. Format and medium: a {ASPECT} premium social media post; photoreal 3D/CGI or high-end photography, whichever suits the concept.
2. Hero subject: exactly what it is, its materials and finish, and how it shows the business's world fused with the festival.
3. Composition: a clear focal point and visual hierarchy designed for {ASPECT}, using the full frame edge to edge; where the
   greeting sits (usually the lower third), with clean breathing room around it so it reads instantly on a phone.
4. Festival details: the symbols, objects, colours and light that genuinely belong to THIS occasion (for example diyas, rangoli
   and marigolds for Diwali; a trident, lion and red-and-white for Durga Puja). Respectful and accurate, never mixing festivals.
5. Colour: the brand colours (give the hex codes) lead the palette; the festival's traditional colours support them in harmony.
6. Lighting and mood: key light, rim light, glow, depth of field, atmosphere (bokeh, sparks, dust), emotional tone.
7. Typography: the greeting in double quotes, exactly as in "greeting", with the font style, weight, colour, effect and placement.
8. Finish: crisp, high detail, commercial advertising quality.
End with these rules, written out: "Render the quoted text exactly once, spelled exactly as written, with perfect letters; no other
text, words, numbers or letters anywhere. No logos, brand marks, watermarks or signatures."

STEP 4, videoPrompt (110 to 170 words): you are now a senior video editor cutting a premium brand reel that starts from THIS image.
Write it as a timed shot list with the cuts, for the requested length:
- Shot 1, the hook (first ~1.5 s): an arresting opening on a detail of the scene (a macro close-up, a reveal from darkness,
  or a fast push-in), so viewers stop scrolling.
- Shots 2 and 3, the build: cut to two different angles or close-ups of the hero subject and festival details from the same
  scene, joined with professional transitions (a match cut, whip pan, speed ramp, light-leak or focus-pull), each with its own
  motion (rotation, sparks, petals, flowing light).
- Final shot, the payoff (last ~2 s): settle on the full composition exactly as in the image, with the greeting crisp and still,
  held calmly to the end.
- Edit rhythm: cuts land on the music's beats; describe colour grade and lighting continuity across shots.
- Sound design: music for the occasion and region (for example temple bells and sitar for Diwali, dhak drums for Durga Puja,
  dhol for Navratri) with a rising build, a hit on the reveal, and subtle whooshes on transitions.
- Rules, written out: "All shots belong to the same scene, colours and lighting. The greeting appears only in the final shot,
  exactly as written in the image, sharp and legible; it never moves, changes, repeats or duplicates. No other text, no logos,
  no watermarks. No morphing or distortion of the subject."

title: 2 to 5 words naming the post.

Everything you write must be in flawless English: correct spelling and grammar, no repeated sentences or phrases.`;

function websiteContext(brand) {
  const w = brand.websiteProfile;
  if (!w) return '';
  return (
    `From their website (${brand.website}):\n` +
    `- About them: ${w.summary}\n- Products and services: ${w.products.join('; ') || 'not listed'}\n` +
    `- Customers: ${w.audience}\n- Tone of voice: ${w.tone}\n- Visual style: ${w.visualStyle}\n` +
    `- Website colours: ${w.colors.join(', ') || 'not found'}\n- Website fonts: ${w.fonts.join(', ') || 'not found'}\n`
  );
}

// `revision` = { previousPrompt, change } when the client asks to change an earlier post.
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

// `variety` = { style, avoid: [earlier concepts for this occasion] } for new posts.
export async function writeBrief(brand, request, aspectRatio, revision, variety, seconds = 8) {
  if (!live()) {
    return {
      title: request.slice(0, 40),
      imagePrompt: `${request} for ${brand.name || 'a business'} that ${brand.industry}. Premium social media post, ${aspectRatio}.`,
      videoPrompt: 'Gentle cinematic motion, drifting light particles, slow push-in.',
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  return askGemini({
    system: BRIEF_SYSTEM.replaceAll('{ASPECT}', aspectRatio === '9:16' ? 'vertical 9:16' : 'landscape 16:9'),
    parts: [
      {
        text:
          `Business name: ${brand.name}\nWhat they do: ${brand.industry}\n` +
          `Brand colours: ${brand.colors?.join(', ') || 'not known'}\nBrand style: ${brand.style || 'not known'}\n` +
          websiteContext(brand) +
          `Today: ${today}\nClient request: ${request}\nVideo length: ${seconds} seconds (time the shot list to fill exactly this)` +
          (variety?.style ? `\nRequired art style for this post: ${variety.style}` : '') +
          (variety?.avoid?.length ? `\nEarlier concepts for this occasion (do NOT repeat or resemble these):\n- ${variety.avoid.join('\n- ')}` : '') +
          (revision
            ? `\n\nThis is a REVISION of an earlier post. The earlier image prompt was:\n${revision.previousPrompt}\n` +
              `The client wants this change: ${revision.change}\n` +
              'Rewrite both prompts so they keep everything the client did not ask to change and apply the change clearly. ' +
              'The earlier image is attached to the image model as a reference.'
            : ''),
      },
    ],
    schema: {
      type: 'OBJECT',
      // Order matters: the concept and greeting are decided before the prompts are written.
      properties: {
        concept: { type: 'STRING' },
        greeting: { type: 'STRING' },
        imagePrompt: { type: 'STRING' },
        videoPrompt: { type: 'STRING' },
        title: { type: 'STRING' },
      },
      required: ['concept', 'greeting', 'imagePrompt', 'videoPrompt', 'title'],
      propertyOrdering: ['concept', 'greeting', 'imagePrompt', 'videoPrompt', 'title'],
    },
  });
}

// ---- Logo overlay ----

// Places the logo where the client put it: `place` = { x, y, w } as fractions of the frame
// (top-left corner and width; height follows the logo's shape). Works for images and MP4s.
export async function stampLogo(input, output, brand, place) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input]);
  const [w, h] = stdout.trim().split(',').map(Number);
  const lw = Math.max(2, Math.round(w * place.w / 2) * 2);
  const filter = `[1:v]scale=${lw}:-2[logo];[0:v][logo]overlay=${Math.round(w * place.x)}:${Math.round(h * place.y)}`;
  const video = output.endsWith('.mp4');
  const codec = video
    ? ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart']
    : ['-frames:v', '1', '-q:v', '2'];
  await run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-i', brand.logoPath, '-filter_complex', filter, ...codec, output]);
}
