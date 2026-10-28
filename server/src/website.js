// Reads a client's public website so the AI can learn their products, tone and visual style.
// Collects page text from the homepage and a few key pages, the site's colours and fonts from its CSS,
// and a few images. Only public addresses are fetched (no localhost or private networks).
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_PAGES = 5;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const KEY_PAGES = /about|company|who-we|product|service|solution|industr|portfolio|project|work|gallery|capabilit/i;
const UA = 'Mozilla/5.0 (compatible; DigiteqStudioBot/1.0; +brand style reader)';

export class WebsiteError extends Error {}

export function normalizeUrl(input) {
  let s = (input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new WebsiteError('That website address doesn’t look right');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new WebsiteError('Use an http or https website address');
  url.hash = '';
  return url.toString();
}

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url) {
  const { hostname } = new URL(url);
  const addrs = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new WebsiteError(`Couldn’t find the website ${hostname}`);
  if (addrs.some((a) => isPrivate(a.address))) throw new WebsiteError('Only public websites can be read');
}

// Fetch with redirects checked one by one, so a redirect can't lead to a private address.
async function get(url, accept) {
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, Accept: accept } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) throw new WebsiteError(`The website answered ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new WebsiteError('Page too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new WebsiteError('Page too large');
    return { url, type: (res.headers.get('content-type') || '').split(';')[0].trim(), buf };
  }
  throw new WebsiteError('Too many redirects');
}

const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, name) =>
  decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))?.[1] || '');

function pageText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function topCounts(list, n) {
  const counts = new Map();
  for (const x of list) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x);
}

/** Returns raw material for the AI: { url, title, description, pages: [{url, text}], colors, fonts, images: [{mimeType, data}] } */
export async function readWebsite(input) {
  const start = normalizeUrl(input);
  const home = await get(start, 'text/html');
  if (!home.type.includes('html')) throw new WebsiteError('That address isn’t a web page');
  const origin = new URL(home.url).origin;
  const homeHtml = home.buf.toString('utf8');

  // Same-site links that look like About / Products / Services pages.
  const links = [...homeHtml.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], home.url);
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.origin === origin && KEY_PAGES.test(u.pathname))
    .map((u) => u.origin + u.pathname);
  const pageUrls = [...new Set(links)].slice(0, MAX_PAGES - 1);

  const pages = [{ url: home.url, html: homeHtml }];
  for (const u of pageUrls) {
    try {
      const p = await get(u, 'text/html');
      if (p.type.includes('html')) pages.push({ url: p.url, html: p.buf.toString('utf8') });
    } catch {
      /* skip pages that fail */
    }
  }

  // Colours and fonts from inline styles and up to two same-site stylesheets.
  let css = pages.map((p) => [...p.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')).join('\n');
  css += pages.map((p) => [...p.html.matchAll(/style=["']([^"']+)["']/gi)].map((m) => m[1]).join(';')).join(';');
  const sheets = [...homeHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)]
    .map((m) => new URL(m[1], home.url))
    .filter((u) => u.origin === origin)
    .slice(0, 2);
  for (const s of sheets) {
    try {
      css += '\n' + (await get(s.toString(), 'text/css')).buf.toString('utf8');
    } catch {
      /* ignore */
    }
  }
  const colors = topCounts(
    [...css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)]
      .map((m) => (m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]).toLowerCase())
      .filter((h) => !['ffffff', '000000', 'fff000'].includes(h))
      .map((h) => `#${h}`),
    8,
  );
  const fonts = topCounts(
    [...css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].split(',')[0].replace(/["']/g, '').trim()).filter((f) => f && !/inherit|var\(/i.test(f)),
    4,
  );

  // A few images that show what the business looks like (social preview image first).
  const imgUrls = [meta(homeHtml, 'og:image'), ...[...homeHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])]
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s, home.url).toString();
      } catch {
        return null;
      }
    })
    .filter((u) => u && !/\.svg|logo|icon|sprite|pixel|data:/i.test(u));
  const images = [];
  for (const u of [...new Set(imgUrls)].slice(0, 6)) {
    if (images.length >= 3) break;
    try {
      const img = await get(u, 'image/*');
      if (['image/jpeg', 'image/png', 'image/webp'].includes(img.type) && img.buf.length > 15_000) {
        images.push({ mimeType: img.type, data: img.buf.toString('base64') });
      }
    } catch {
      /* ignore */
    }
  }

  return {
    url: home.url,
    title: decode(homeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim(),
    description: meta(homeHtml, 'description') || meta(homeHtml, 'og:description'),
    pages: pages.map((p) => ({ url: p.url, text: pageText(p.html).slice(0, 5000) })),
    colors,
    fonts,
    images,
  };
}
