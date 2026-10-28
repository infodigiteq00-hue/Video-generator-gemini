// Login for a single account (no sign-up yet). Credentials live in server/.env:
// AUTH_EMAIL, AUTH_PASSWORD_HASH ("salt:scrypt-hash") and AUTH_SECRET (signs session cookies).
import crypto from 'node:crypto';
import express from 'express';

const COOKIE = 'ds_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in for 30 days
const attempts = new Map(); // ip → { count, until }

const secret = () => process.env.AUTH_SECRET || '';
const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function issue(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verify(token) {
  const [payload, mac] = (token || '').split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function passwordMatches(password) {
  const [salt, hash] = (process.env.AUTH_PASSWORD_HASH || '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const cookieOf = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)))[COOKIE];

export const authEnabled = () => Boolean(process.env.AUTH_EMAIL && process.env.AUTH_PASSWORD_HASH && process.env.AUTH_SECRET);

export function mountAuth(app) {
  const json = express.json();

  app.post('/api/login', json, (req, res) => {
    // Slow down guessing: 10 failed tries per 15 minutes per address.
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.count >= 10 && a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const ok = email === process.env.AUTH_EMAIL?.toLowerCase() && passwordMatches(req.body?.password || '');
    if (!ok) {
      attempts.set(ip, { count: (a?.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    attempts.delete(ip);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(COOKIE, issue(email), { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_MS, path: '/' });
    res.json({ email });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.get('/api/me', (req, res) => {
    const session = verify(cookieOf(req));
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    res.json({ email: session.email });
  });
}

// Everything under /api needs a session, except signing in and what the ChatGPT player needs
// (it polls a job by its unguessable id from outside the app, where there is no cookie).
export function requireAuth(req, res, next) {
  if (!authEnabled()) return next();
  const open = ['/api/login', '/api/logout', '/api/me'].includes(req.path) || (req.method === 'GET' && /^\/api\/jobs\/[\w-]+$/.test(req.path));
  if (open || verify(cookieOf(req))) return next();
  res.status(401).json({ error: 'Please sign in' });
}
