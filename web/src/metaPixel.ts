// Meta Pixel for the Digiteq Studio funnel: PageView everywhere, then ViewContent (landing) → InitiateCheckout (create
// account page) → Lead (account created) → AddPaymentInfo (PhonePe opens) → Purchase (payment confirmed) →
// CompleteRegistration (business set up) → PostCreated (first post, custom).
// Only production builds send events. VITE_META_PIXEL_ID overrides the ID; 'debug' records events in
// window.__pixel (kept in sessionStorage) instead of sending them, for testing.

const PIXEL_ID = String(import.meta.env.VITE_META_PIXEL_ID || (import.meta.env.PROD ? '2077330492969198' : '')).trim();
const DEBUG = PIXEL_ID === 'debug';
const FIRED_KEY = 'ds_pixel_fired';
const USER_KEY = 'ds_pixel_user';

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; callMethod?: (...args: unknown[]) => void };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    __pixel?: unknown[][];
  }
}

let ready = false;
let userData: Record<string, string> | null = null;

export function initMetaPixel() {
  if (ready || !PIXEL_ID) return;
  ready = true;
  if (DEBUG) {
    // Kept for the tab's session, so a test can follow events across PhonePe and back.
    window.__pixel = JSON.parse(sessionStorage.getItem('ds_pixel_debug') || '[]');
    window.fbq = (...args: unknown[]) => {
      window.__pixel!.push(args);
      sessionStorage.setItem('ds_pixel_debug', JSON.stringify(window.__pixel));
    };
  } else {
    /* eslint-disable */
    // @ts-ignore Meta's loader, as given
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
  }
  // The customer's details from earlier in this visit (e.g. before PhonePe), so even the first PageView is matched.
  try {
    userData = JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
  } catch {
    /* private mode */
  }
  window.fbq!('init', PIXEL_ID, userData ?? undefined);
  window.fbq!('track', 'PageView');
}

/** Advanced matching: the customer's email and mobile (Meta hashes them) so ad clicks match up with sales. */
export function setPixelUser({ email, phone }: { email?: string | null; phone?: string | null }) {
  const data: Record<string, string> = { country: 'in' };
  const em = String(email ?? '').trim().toLowerCase();
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) data.em = em;
  if (digits.length === 10) data.ph = `91${digits}`;
  if (!data.em && !data.ph) return;
  userData = { ...userData, ...data };
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(userData));
  } catch {
    /* private mode */
  }
  if (PIXEL_ID && window.fbq) window.fbq('init', PIXEL_ID, userData);
}

// True the first time `key` is seen on this browser, so a refresh or a second check doesn't count a sale twice.
function firstTime(key: string) {
  try {
    const fired = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
    if (fired[key]) return false;
    fired[key] = Date.now();
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
  } catch {
    /* private mode: send it */
  }
  return true;
}

/**
 * A standard Meta event (or `custom` for our own). `once` makes it count once per browser and gives it an event ID
 * (`<event>-<once>`), so Meta also drops duplicates from other devices.
 */
export function trackPixel(event: string, params: Record<string, unknown> = {}, { once, custom }: { once?: string; custom?: boolean } = {}) {
  if (!PIXEL_ID || !window.fbq) return;
  if (once && !firstTime(`${event}:${once}`)) return;
  window.fbq(custom ? 'trackCustom' : 'track', event, params, once ? { eventID: `${event}-${once}`.slice(0, 128) } : undefined);
}

/** Before leaving the page (to PhonePe): a moment for the last event to go out. */
export const pixelFlush = () => new Promise((r) => setTimeout(r, PIXEL_ID ? 400 : 0));
