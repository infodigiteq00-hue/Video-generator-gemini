// Brand kits: a client's business, featured products, logo and contact details, read once, then used to turn
// short requests ("Diwali post") into full creative briefs, to stamp the real logo onto every image and video,
// and to close videos with a contact card.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adminId } from './auth.js';
import { collection } from './db.js';
import { fetchRetry } from './providers/http.js';
import { processLogo } from './logo.js';
import { WebsiteError, normalizeUrl, readWebsite } from './website.js';

const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-flash-latest';
const run = promisify(execFile);

// ---- Store ----

const store = collection('brands', adminId);
const brands = new Map(store.all().map((b) => [b.id, b]));

export const getBrand = (id) => brands.get(id);

// Each account has one brand (the latest, if an older account somehow has more).
export const brandOf = (userId) =>
  [...brands.values()].filter((b) => b.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

export const LOGO_VARIANTS = ['color', 'light', 'grey'];
const mediaUrl = (file) => `/media/uploads/${path.basename(file)}`;

export function brandToPublic(b) {
  const { logoPath, logoMime, logoFiles, ...rest } = b;
  // The logo in its original colours, all white and all dark (the last two only for logos without a solid background).
  const variants = logoFiles ? Object.fromEntries(LOGO_VARIANTS.filter((v) => logoFiles[v]).map((v) => [v, mediaUrl(logoFiles[v])])) : b.logoUrl ? { color: b.logoUrl } : null;
  return { ...rest, logoVariants: variants };
}

// The logo file for a version, falling back to the original colours.
const logoFile = (brand, variant) => brand.logoFiles?.[variant] || brand.logoPath;

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
// `logoBg` is what to do with a solid background behind a new logo: 'keep', 'outer' or 'all' (see logo.js).
export async function saveBrand({ id, userId, name, industry, logo, website, featured, contact, endCard, colors, tagline, logoBg }) {
  industry = (industry || '').trim();
  name = (name || '').trim();
  if (!name) throw new BrandError('Tell us your business name');
  if (!industry) throw new BrandError('Tell us what your business does');
  if (industry.length > 500) throw new BrandError('Keep the business description under 500 characters');
  featured = cleanFeatured(featured);
  tagline = String(tagline || '').trim().replace(/\s+/g, ' ');
  if (tagline.length > 100) throw new BrandError('Keep your tagline under 100 characters');
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

  const brand = existing ?? { id: crypto.randomUUID(), userId, createdAt: new Date().toISOString() };
  if (logo) {
    let files;
    try {
      files = await processLogo(logo.path, logoBg);
    } catch {
      throw new BrandError('We couldn’t read that logo. Try a PNG or JPEG.');
    } finally {
      fs.rmSync(logo.path, { force: true });
    }
    for (const f of [existing?.logoPath, ...Object.values(existing?.logoFiles ?? {})]) if (f) fs.rmSync(f, { force: true });
    Object.assign(brand, { logoPath: files.color, logoMime: 'image/png', logoFiles: files, logoUrl: mediaUrl(files.color) });
  }
  Object.assign(brand, {
    name, industry, featured, contact, tagline,
    endCard: Object.keys(contact).length > 0 && endCard !== false && endCard !== 'false',
    updatedAt: new Date().toISOString(),
  });
  if (logo || (brand.logoPath && !brand.colors)) Object.assign(brand, await readLogo(brand).catch(() => ({ colors: [], style: '' })));
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
  store.put(brand);
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

// A logo that can't be read (no key, AI busy) never blocks saving: posts then go without brand colours.
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

// The image prompt, written straight from the client's details. It asks for an agency-style post where the
// business's own world is the heart of the festival, in a fixed layout: a calm space at the top for the real
// logo, an ornamental greeting with one line under it, and a clear band at the bottom for the contact bar
// (the logo and the contact bar are added by ffmpeg afterwards, so they're always sharp and correct).
export function imagePrompt(brand, festival) {
  const products = brand.featured?.length ? brand.featured.join(', ') : null;
  const site = brand.websiteProfile;
  const own = brand.name.endsWith('s') ? `${brand.name}’` : `${brand.name}’s`;
  const lines = [
    `You are the creative director of a top Indian advertising agency. Design a premium ${festival} greeting post for ${brand.name}, ` +
      `a business that does this: ${brand.industry}.`,
    products && `Their products and services: ${products}.`,
    site && `About them: ${site.summary} Their visual style: ${site.visualStyle}`,
    '',
    `THE IDEA: make ${own} own world the heart of ${festival}, so the post could only belong to them. ` +
      `Pick the one idea that suits this business and this festival best, for example:`,
    '- their product, or the material it is made of, forms the festival art (steel parts arranged into a rangoli, pigment powder ' +
      'sculpting the festival’s figures, fabric flowing into a diya’s flame);',
    '- their product presented as the festival’s gift, beautifully lit in an open gift box among diyas and marigolds;',
    '- their workplace (factory, shop, clinic, office or showroom) decorated and glowing for the festival, with people celebrating in front of it;',
    '- the festival’s story or ritual told in their brand colours, with a clear nod to what they make.',
    'Products always look exactly like the real thing: real shape, materials and finish.',
    '',
    `THE LOOK: photoreal and cinematic, rich in detail: the quality of a national brand’s festive campaign. ` +
      'Bright, luminous and celebratory: fresh daylight or a glowing golden light that fills the whole frame, never dark, gloomy or dull. ' +
      `Joyful and full of ${festival}: its traditional decorations, lights and colours` +
      (/diwali/i.test(festival) ? ' (diyas, rangoli, marigolds, fireworks)' : '') +
      ', used generously. Vivid, uplifting colour chemistry: saturated festive hues (marigold, saffron, magenta, turquoise, gold) ' +
      'in harmony with each other and with the brand. Elegant and uncluttered, with room to breathe.' +
      (brand.colors?.length ? ` Brand colours ${brand.colors.join(', ')} lead the palette.` : ''),
    '',
    'THE LAYOUT, a vertical 9:16 post:',
    '- Top 12%: just the scene itself continuing softly (wall, sky or light), calm and uncluttered: no text, no name, no band, ' +
      `no box and no frame there, because our ${brand.logoPath ? 'real logo' : 'business name'} is placed on top of it.`,
    `- The greeting people really use for ${festival} (like "Happy Diwali" or "Merry Christmas"): the first word small, in widely spaced ` +
      'capitals, and the festival name large, ornamental and elegant, in the brand colours with a subtle metallic or glowing finish. ' +
      'Place it where it balances the picture best: under the top area or in the lower third.',
    brand.tagline
      ? `- Under the greeting, in a small refined serif: "${brand.tagline}"`
      : `- Under the greeting, one short warm line in a small refined serif that links ${festival} to what they do (at most 10 words).`,
    hasContact(brand) && '- Bottom 10%: keep it plain, with no text and nothing important. Our contact details bar goes there.',
    `- Never write the business name anywhere, not even on products or packaging: our ${brand.logoPath ? 'logo' : 'name at the top'} carries it.`,
    '- Every word spelled perfectly. No other text, no logos, no watermarks.',
  ];
  return lines.filter((l) => l !== null && l !== undefined && l !== false).join('\n');
}

// After the image is made, the AI looks at it and says how it would turn it into a video. That answer is the video prompt.
export async function writeVideoPrompt(brand, festival, imagePath, seconds = 8) {
  if (!live()) return 'Gentle cinematic motion, drifting light particles, slow push-in.';
  const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(imagePath)] || 'image/png';
  const { videoPrompt } = await askGemini({
    system:
      'You are the director of premium festive brand films for Indian businesses. ' +
      'Write the prompt for an AI video model that brings the attached post to life.',
    parts: [
      {
        text:
          `This is a ${festival} post for ${brand.name} (${brand.industry}). Turn it into an elegant, bright and joyful ${seconds} second video, ` +
          'like a national brand’s festive film. Keep it as luminous and colourful as the post. Motion is cinematic and purposeful, never chaotic: the scene comes alive (people move naturally, products ' +
          'assemble or reveal themselves, a gift box opens, diyas flicker, petals and sparkles drift, fireworks bloom), with a slow, smooth ' +
          'camera push-in. Build to a beautiful final moment that matches the post. ' +
          'Describe the motion beat by beat, and the music and sounds that suit the festival and region. ' +
          'Keep the greeting, the line under it and the layout perfectly still, sharp and unchanged the whole time. Keep the top centre and the ' +
          'bottom band calm and empty (the logo and contact bar are added afterwards). Products keep their real shape. No new text, no logos. ' +
          (hasContact(brand) ? 'Let the music end softly on the last second. ' : '') +
          'Write only the video prompt, one paragraph, under 130 words.',
      },
      { inlineData: { mimeType, data: fs.readFileSync(imagePath).toString('base64') } },
    ],
    schema: { type: 'OBJECT', properties: { videoPrompt: { type: 'STRING' } }, required: ['videoPrompt'] },
  });
  return videoPrompt;
}

// ---- Brand frame: logo, contact bar and end card (drawn by ffmpeg, so they're always sharp and exact) ----

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:format=duration', '-of', 'json', file]);
  const { streams = [], format = {} } = JSON.parse(stdout);
  const v = streams.find((s) => s.codec_type === 'video') ?? {};
  const [n, d] = String(v.avg_frame_rate).split('/').map(Number);
  return { w: v.width, h: v.height, fps: n && d ? v.avg_frame_rate : '24', duration: Number(format.duration) || 0, audio: streams.some((s) => s.codec_type === 'audio') };
}

const FONTS = {
  bold: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Unicode.ttf'],
  regular: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial Unicode.ttf'],
  serif: ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial Unicode.ttf'],
};
function font(kind) {
  const f = FONTS[kind].find((p) => fs.existsSync(p));
  if (!f) throw new Error('No font available for the brand frame');
  return f;
}
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

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const toHex = (c) => `0x${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// The darkest brand colour, darkened further if needed, so white text on it is easy to read.
function darkBrand(colors = []) {
  const list = colors.map((c) => /^#?([0-9a-f]{6})$/i.exec(c.trim())?.[1]).filter(Boolean).map(rgb);
  if (!list.length) return '0x1d1d1f';
  let c = list.sort((a, b) => lum(a) - lum(b))[0];
  while (lum(c) > 0.32) c = c.map((v) => v * 0.8);
  return toHex(c);
}

// Draws text from a file (no escaping problems with addresses or symbols); `top` may be an expression.
function text(tmp, key, value, { fontfile, size, color, top, alpha }) {
  const file = path.join(tmp, `${key}.txt`);
  fs.writeFileSync(file, value);
  return (
    `drawtext=fontfile='${fontfile}':textfile='${file}':expansion=none:fontsize=${size}:fontcolor=${color}` +
    `:x=(w-text_w)/2:y=${top}` + (alpha ? `:alpha='${alpha}'` : '')
  );
}

// The default logo spot: centred in the calm area the image prompt leaves at the top, in the white version when
// that area is dark (and the logo has one), else in its own colours.
export async function defaultPlace(brand, input) {
  const v = await probe(input);
  const l = await probe(brand.logoPath);
  const w = Math.min(0.34, ((0.075 * v.h) / v.w) * (l.w / l.h));
  const dark = await topIsDark(input);
  return { x: +((1 - w) / 2).toFixed(4), y: 0.03, w: +w.toFixed(4), variant: dark && brand.logoFiles?.light ? 'light' : 'color' };
}

// Whether the calm area at the top of a post (or a video's first frame) is dark.
async function topIsDark(input) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', input, '-frames:v', '1', '-vf', 'crop=iw*0.5:ih*0.12:iw*0.25:0,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return lum([...stdout.subarray(0, 3)]) < 0.42;
}

// Two balanced rows for the contact bar: phone and email, then website and address.
const contactRows = (c = {}) =>
  [[c.phone, c.email], [c.website?.replace(/^https?:\/\//i, '').replace(/\/$/, ''), c.address]]
    .map((r) => r.filter(Boolean).join('   ·   '))
    .filter(Boolean);

// The brand frame on an image or an MP4: the logo at `place` ({ x, y, w } fractions of the frame; null = no logo),
// or for clients without a logo their name at the top, and, when they want their contact details shown, a bar
// across the bottom in their darkest brand colour.
export async function stampBrand(input, output, brand, place) {
  const { w, h } = await probe(input);
  const args = ['-y', '-v', 'error', '-i', input];
  // Always opaque, so a PNG with transparency can't make the bar look washed out.
  const chain = ['[0:v]format=rgb24[base]'];
  let last = 'base';
  if (place && brand.logoPath) {
    args.push('-i', logoFile(brand, place.variant));
    chain.push(`[1:v]scale=${even(w * place.w)}:-2[logo]`, `[base][logo]overlay=${Math.round(w * place.x)}:${Math.round(h * place.y)}[l]`);
    last = 'l';
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-'));
  try {
    if (!brand.logoPath && brand.name) {
      const size = Math.round(Math.min(h * 0.032, (w * 0.8) / (brand.name.length * 0.62)));
      const color = (await topIsDark(input)) ? 'white' : darkBrand(brand.colors);
      chain.push(`[${last}]${text(tmp, 'name', brand.name.toUpperCase(), { fontfile: font('serif'), size, color, top: Math.round(h * 0.045) })}[n]`);
      last = 'n';
    }
    if (hasContact(brand)) {
      const band = even(h * 0.075);
      const rows = contactRows(brand.contact);
      // One font size that keeps the longest row on one line.
      const size = Math.round(Math.min(band * 0.25, ...rows.map((r) => (w * 0.92) / (r.length * 0.55))));
      const step = Math.round(size * 1.5);
      const first = Math.round(h - band + (band - (rows.length - 1) * step - size) / 2);
      const draws = rows.map((r, i) => text(tmp, `row${i}`, r, { fontfile: font('regular'), size, color: 'white', top: first + i * step }));
      chain.push(`[${last}]drawbox=x=0:y=${h - band}:w=iw:h=${band}:color=${darkBrand(brand.colors)}:t=fill,${draws.join(',')}[f]`);
      last = 'f';
    }
    if (last === 'base') return fs.copyFileSync(input, output);
    const video = output.endsWith('.mp4');
    const codec = video
      ? ['-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart']
      : ['-frames:v', '1', '-q:v', '2'];
    await run('ffmpeg', [...args, '-filter_complex', chain.join(';'), '-map', `[${last}]`, ...codec, output]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- End card (after the video) ----

const CARD_SECONDS = 3;
const CROSSFADE = 0.6;

// Appends a clean white closing card to `input`: the logo (or the business name), the tagline, and the contact
// details, faded in from the video.
export async function addEndCard(input, output, brand) {
  const c = brand.contact ?? {};
  const v = await probe(input);
  const { w: W, h: H, fps } = v;
  const S = Math.min(W, H);
  const portrait = H > W;
  const dark = darkBrand(brand.colors);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'endcard-'));
  try {
    const args = ['-y', '-v', 'error', '-i', input, '-f', 'lavfi', '-i', `color=c=0xFBFAF7:s=${W}x${H}:r=${fps}:d=${CARD_SECONDS}`];
    const gap = S * 0.045;
    let lh = 0;
    let lw = 0;
    if (brand.logoPath) {
      const l = await probe(brand.logoPath);
      const k = Math.min((portrait ? W * 0.62 : W * 0.32) / l.w, (S * 0.26) / l.h);
      [lw, lh] = [even(l.w * k), even(l.h * k)];
      args.push('-loop', '1', '-framerate', String(fps), '-t', String(CARD_SECONDS), '-i', brand.logoPath);
    }

    // Lines from top to bottom, then centred as one block.
    const size = Math.round(S * (portrait ? 0.038 : 0.034));
    const max = Math.floor((W * 0.84) / (size * 0.58));
    const rows = [];
    if (!brand.logoPath) rows.push({ t: brand.name, f: 'bold', s: Math.round(Math.min(S * 0.075, (W * 0.86) / (brand.name.length * 0.62))), c: dark, after: gap });
    for (const t of brand.tagline ? wrap(brand.tagline, Math.floor(max * 0.95)) : []) rows.push({ t, f: 'serif', s: Math.round(size * 1.05), c: '0x3a3a3c' });
    if (rows.length) rows[rows.length - 1].after = gap;
    const site = c.website?.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (site) rows.push({ t: site, f: 'bold', s: Math.round(size * 1.1), c: dark });
    for (const t of [c.email, c.phone, ...(c.address ? wrap(c.address, max) : [])].filter(Boolean)) rows.push({ t, f: 'regular', s: size, c: '0x2c2c2e' });

    const height = (lh ? lh + gap * 1.2 : 0) + rows.reduce((sum, r) => sum + r.s * 1.55 + (r.after ?? 0), 0);
    let y = Math.max(S * 0.05, (H - height) / 2);
    const logoY = Math.round(y);
    if (lh) y += lh + gap * 1.2;
    // Each line fades in and rises a little, one after another.
    const draws = rows.map((r, i) => {
      const delay = (0.35 + i * 0.08).toFixed(2);
      const a = `min(1\\,max(0\\,(t-${delay})/0.5))`;
      const top = `${Math.round(y)}+${Math.round(S * 0.015)}*(1-${a})`;
      y += r.s * 1.55 + (r.after ?? 0);
      return text(tmp, `l${i}`, r.t, { fontfile: font(r.f), size: r.s, color: r.c, top, alpha: a });
    });

    const D = v.duration;
    const total = D - CROSSFADE + CARD_SECONDS;
    const card = lh
      ? `[2:v]scale=${lw}:${lh},format=rgba,fade=t=in:st=0.1:d=0.5:alpha=1[logo];[1:v][logo]overlay=x=(W-w)/2:y=${logoY}:shortest=1`
      : '[1:v]null';
    const filter = [
      `${card}${draws.length ? ',' + draws.join(',') : ''},fps=${fps},format=yuv420p,setsar=1[card]`,
      `[0:v]fps=${fps},setsar=1,format=yuv420p[main]`,
      `[main][card]xfade=transition=fade:duration=${CROSSFADE}:offset=${(D - CROSSFADE).toFixed(3)}[v]`,
      ...(v.audio ? [`[0:a]afade=t=out:st=${Math.max(0, D - 0.8).toFixed(3)}:d=0.8,apad=whole_dur=${total.toFixed(3)}[a]`] : []),
    ].join(';');
    await run('ffmpeg', [
      ...args, '-filter_complex', filter, '-map', '[v]', ...(v.audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
