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

// Brand colours picked by hand (clients without a logo): hex codes like "#d4a017".
function cleanColors(list) {
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return (Array.isArray(list) ? list : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
}

// `logo` is { path, mimetype } of an uploaded file, or null to keep the current one (or for no logo).
// Colours come from the logo; without one, from `colors` picked by hand.
export async function saveBrand({ id, name, industry, logo, website, featured, contact, endCard, colors }) {
  industry = (industry || '').trim();
  name = (name || '').trim();
  if (!name) throw new BrandError('Tell us your business name');
  if (!industry) throw new BrandError('Tell us what your business does');
  if (industry.length > 500) throw new BrandError('Keep the business description under 500 characters');
  featured = cleanFeatured(featured);
  contact = cleanContact(contact);
  const existing = id ? brands.get(id) : null;
  if (id && !existing) throw new BrandError('Brand not found');
  colors = cleanColors(colors);
  if (!logo && !existing?.logoPath && !colors.length) throw new BrandError('Upload your logo or pick your brand colours');
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
  if (logo || (brand.logoPath && !brand.colors)) Object.assign(brand, await readLogo(brand));
  else if (!brand.logoPath) Object.assign(brand, { logoUrl: null, colors, style: '' });
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

// ---- Prompts ----

// The image prompt, written straight from the client's details: warm and open, so the image model has room to design.
export function imagePrompt(brand, festival) {
  const products = brand.featured?.length ? brand.featured.join(', ') : null;
  const site = brand.websiteProfile;
  return (
    `Imagine you are the owner of ${brand.name}, a business that does this: ${brand.industry}. ` +
    `You are also a gifted designer who makes festival posts for businesses in your industry.\n\n` +
    `Create a beautiful, aesthetic ${festival} post for ${brand.name}: a vertical 9:16 post for Instagram and WhatsApp.\n` +
    (products
      ? `Feature our products and services: ${products}. Use all of them, a few, or just one, whatever makes the most beautiful post. ` +
        `Show them as they really look.\n`
      : '') +
    (brand.colors?.length ? `Use our brand colours ${brand.colors.join(', ')}, together with the festival's own colours.\n` : '') +
    (site ? `About us, from our website: ${site.summary} Our visual style: ${site.visualStyle}\n` : '') +
    `\nMake it feel happy, warm and neat, like a real designer made it, not AI. Fill it with the festivity of ${festival}: ` +
    `its traditional decorations, lights, colours and celebration` +
    (/diwali/i.test(festival) ? ' (diyas, rangoli, sparkles and fireworks)' : '') + '. ' +
    `Use all of them or a few, whatever suits the design.\n` +
    `Add the short ${festival} greeting people really use (like "Happy Diwali" or "Merry Christmas") with "${brand.name}", spelled exactly right. ` +
    `No other text, no logos and no watermarks.` +
    (brand.logoPath ? ' Keep the top-right corner clear: we add our real logo there.' : '')
  );
}

// After the image is made, the AI looks at it and says how it would turn it into a video. That answer is the video prompt.
export async function writeVideoPrompt(brand, festival, imagePath, seconds = 8) {
  if (!live()) return 'Gentle cinematic motion, drifting light particles, slow push-in.';
  const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(imagePath)] || 'image/png';
  const { videoPrompt } = await askGemini({
    system:
      'You are a video director who turns festival posts into short social media videos. ' +
      'Write the prompt for an AI video model that animates the attached image.',
    parts: [
      {
        text:
          `This is a ${festival} post for ${brand.name} (${brand.industry}). How would you turn it into a beautiful ${seconds} second video? ` +
          'Describe the camera moves, what moves, glows and sparkles, how the scene comes alive, and the music and sounds that suit the festival. ' +
          'Keep the products, the text and the layout exactly as in the image; the greeting stays sharp and never changes. No new text, no logos. ' +
          (hasContact(brand) ? 'Let the music end softly on the last second. ' : '') +
          'Write only the video prompt, one paragraph, under 120 words.',
      },
      { inlineData: { mimeType, data: fs.readFileSync(imagePath).toString('base64') } },
    ],
    schema: { type: 'OBJECT', properties: { videoPrompt: { type: 'STRING' } }, required: ['videoPrompt'] },
  });
  return videoPrompt;
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
  const { w: W, h: H, fps } = v;
  const S = Math.min(W, H);
  const portrait = H > W;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'endcard-'));
  try {
    // Logo on a rounded white plate, so dark and transparent logos both read. Without a logo the plate is a
    // transparent pixel, so the rest of the card stays the same.
    const plate = path.join(tmp, 'plate.png');
    let ph = 0;
    if (brand.logoPath) {
      const logo = await probe(brand.logoPath);
      const maxW = portrait ? W * 0.5 : W * 0.26;
      const maxH = S * 0.2;
      const k = Math.min(maxW / logo.w, maxH / logo.h);
      const lw = even(logo.w * k);
      const lh = even(logo.h * k);
      const pad = even(S * 0.04);
      const pw = lw + 2 * pad;
      ph = lh + 2 * pad;
      const r = Math.round(Math.min(ph, pw) * 0.18);
      const round = `if(gt(abs(X-W/2),W/2-${r})*gt(abs(Y-H/2),H/2-${r}),if(lte(hypot(abs(X-W/2)-(W/2-${r}),abs(Y-H/2)-(H/2-${r})),${r}),255,0),255)`;
      await run('ffmpeg', [
        '-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=${pw}x${ph}`, '-i', brand.logoPath, '-filter_complex',
        `[1:v]scale=${lw}:${lh}[l];[0:v][l]overlay=${pad}:${pad},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${round}'`,
        '-frames:v', '1', plate,
      ]);
    } else {
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0:s=2x2,format=rgba', '-frames:v', '1', plate]);
    }
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
    const block = (ph && ph + gap) + nameSize + gap * 0.7 + 3 + gap * 0.7 + capSize + gap * 0.55 + lines.length * lineStep;
    let y = Math.max(S * 0.04, (H - block) / 2);
    const plateY = Math.round(y);
    y += ph && ph + gap;

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
