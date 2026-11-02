// Online payments through PhonePe Payment Gateway (Standard Checkout v2), on the Digiteq Solutions account.
// PHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET switch them on (PHONEPE_CLIENT_VERSION defaults to 1;
// PHONEPE_ENV is 'sandbox' until set to 'production'). Without them the app uses the manual flow: a placeholder
// QR, and an admin confirms each payment.
// A payment only ever counts as paid after PhonePe's own Order Status API says COMPLETED: the customer's return
// and the webhook are just signals to go and check.
// Docs: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment
import crypto from 'node:crypto';
import { db } from './db.js';
import { fetchRetry } from './providers/http.js';

const env = (name) => process.env[name]?.trim() || '';
export const onlinePayments = () => Boolean(env('PHONEPE_CLIENT_ID') && env('PHONEPE_CLIENT_SECRET'));

const production = () => env('PHONEPE_ENV').toLowerCase() === 'production';
const authUrl = () =>
  production() ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token' : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';
const pgUrl = (path) => (production() ? 'https://api.phonepe.com/apis/pg' : 'https://api-preprod.phonepe.com/apis/pg-sandbox') + path;

// The access token, reused until shortly before it expires.
let token = null;
async function accessToken() {
  if (token && token.expiresAt - 60 > Date.now() / 1000) return token.value;
  const res = await fetchRetry(authUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('PHONEPE_CLIENT_ID'),
      client_version: env('PHONEPE_CLIENT_VERSION') || '1',
      client_secret: env('PHONEPE_CLIENT_SECRET'),
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new Error(`Payment provider error: ${data?.message || data?.code || res.status}`);
  token = { value: data.access_token, expiresAt: Number(data.expires_at) || Date.now() / 1000 + 600 };
  return token.value;
}

async function phonepe(method, path, body) {
  const res = await fetchRetry(
    pgUrl(path),
    { method, headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${await accessToken()}` }, body: body && JSON.stringify(body) },
    { idempotent: method === 'GET' },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Payment provider error: ${data?.message || data?.code || res.status}`);
  return data;
}

export const getPayment = (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(id);

/**
 * Starts a payment of `amount` rupees. `kind` is 'pack' (ref = the account) or 'redo' (ref = the redo request).
 * PhonePe sends the customer back to `returnUrl?order=<id>` afterwards. Returns PhonePe's payment page.
 * `click` is kept to report the sale to Meta later (meta.js).
 */
export async function createPayment({ kind, ref, amount, returnUrl, click }) {
  const id = crypto.randomUUID(); // PhonePe's merchantOrderId too, so the return and the webhook find this row
  const order = await phonepe('POST', '/checkout/v2/pay', {
    merchantOrderId: id,
    amount: amount * 100,
    expireAfter: 1200,
    metaInfo: { udf1: kind, udf2: ref },
    paymentFlow: { type: 'PG_CHECKOUT', merchantUrls: { redirectUrl: `${returnUrl}?order=${id}` } },
  });
  db.prepare("INSERT INTO payments (id, kind, ref, amount, linkId, status, createdAt, meta) VALUES (?, ?, ?, ?, ?, 'created', ?, ?)").run(
    id, kind, ref, amount, order.orderId ?? null, new Date().toISOString(), click ? JSON.stringify(click) : null,
  );
  return order.redirectUrl;
}

/**
 * Asks PhonePe how a payment stands and records it. Returns 'paid' | 'failed' | 'pending', and `fresh` is true the
 * one time it becomes paid, so the caller acts on it exactly once even when the return and the webhook both arrive.
 */
export async function checkPayment(id) {
  const row = getPayment(id);
  if (!row) return { state: 'failed', fresh: false };
  if (row.status === 'paid') return { state: 'paid', fresh: false };
  if (row.status === 'failed') return { state: 'failed', fresh: false }; // final at PhonePe: no need to ask again
  const order = await phonepe('GET', `/checkout/v2/order/${encodeURIComponent(id)}/status?details=false`);
  if (order.state === 'FAILED') {
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'created'").run(id);
    return { state: 'failed', fresh: false };
  }
  if (order.state !== 'COMPLETED' || Number(order.amount) !== row.amount * 100) return { state: 'pending', fresh: false };
  const { changes } = db.prepare("UPDATE payments SET status = 'paid', paymentId = ?, paidAt = ? WHERE id = ? AND status != 'paid'").run(
    order.paymentDetails?.[0]?.transactionId ?? order.orderId ?? null, new Date().toISOString(), id,
  );
  return { state: 'paid', fresh: changes > 0 };
}

/**
 * The webhook: returns the merchantOrderId to go and check, when the request carries the configured credentials
 * (Authorization = SHA256 of "username:password"). Checking with PhonePe afterwards is what makes it count.
 */
export function webhookOrder(authorization, body) {
  const { PHONEPE_WEBHOOK_USERNAME: user, PHONEPE_WEBHOOK_PASSWORD: pass } = process.env;
  if (user && pass) {
    const want = crypto.createHash('sha256').update(`${user}:${pass}`).digest('hex');
    const got = String(authorization || '').replace(/^SHA256\s+/i, '').trim().toLowerCase();
    if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  }
  return typeof body?.payload?.merchantOrderId === 'string' ? body.payload.merchantOrderId : null;
}
