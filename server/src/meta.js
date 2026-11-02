// Meta Conversions API: reports each sale to Meta from the server the moment PhonePe confirms it, so it counts even
// when the browser pixel is blocked or the customer closed the tab. It carries the same event ID as the pixel's
// Purchase in the app, so Meta counts each sale once.
// META_CAPI_ACCESS_TOKEN switches it on (Events Manager → the Digiteq Studio pixel → Settings → Conversions API →
// Generate access token). META_PIXEL_ID defaults to the Digiteq Studio pixel. META_TEST_EVENT_CODE sends events to
// Events Manager's Test Events tab instead of counting them.
import crypto from 'node:crypto';

const env = (name) => process.env[name]?.trim() || '';
const pixel = () => env('META_PIXEL_ID') || '2077330492969198';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
export const metaCapi = () => Boolean(env('META_CAPI_ACCESS_TOKEN'));

/** Meta's browser cookies, IP and browser from the customer's request, kept with a payment to match the sale later. */
export function clickInfo(req) {
  const cookie = (name) => (req.headers.cookie ?? '').match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
  return {
    fbp: cookie('_fbp') ? decodeURIComponent(cookie('_fbp')) : undefined,
    fbc: cookie('_fbc') ? decodeURIComponent(cookie('_fbc')) : undefined,
    // The customer's own address: first in the chain (Railway → QuoteGen → Railway). Only used for ad matching.
    ip: req.get('x-forwarded-for')?.split(',')[0].trim() || req.ip,
    ua: req.get('user-agent')?.slice(0, 512),
    url: req.get('referer')?.slice(0, 1024),
  };
}

/** Reports a confirmed sale. Never throws: a problem reaching Meta is logged and the payment carries on as normal. */
export async function reportPurchase({ eventId, value, contentName, user, click }) {
  if (!metaCapi()) return;
  const email = String(user?.email ?? '').trim().toLowerCase();
  const digits = String(user?.phone ?? '').replace(/\D/g, '').slice(-10);
  const userData = { country: [sha('in')] };
  if (email) userData.em = [sha(email)];
  if (digits.length === 10) userData.ph = [sha(`91${digits}`)];
  if (click?.fbp) userData.fbp = click.fbp;
  if (click?.fbc) userData.fbc = click.fbc;
  if (click?.ip) userData.client_ip_address = click.ip;
  if (click?.ua) userData.client_user_agent = click.ua;
  const event = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: click?.url,
    user_data: userData,
    custom_data: { currency: 'INR', value, content_name: contentName, num_items: 1 },
  };
  try {
    const res = await fetch(`https://graph.facebook.com/v23.0/${pixel()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: env('META_CAPI_ACCESS_TOKEN'), test_event_code: env('META_TEST_EVENT_CODE') || undefined }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) console.error('[meta] sale not reported:', data?.error?.message || res.status);
  } catch (err) {
    console.error('[meta] sale not reported:', err.message);
  }
}
