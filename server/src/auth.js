// Accounts: customers sign up from the landing page (or an admin's invite link) and log in with their email
// or phone number and a password. The account in AUTH_EMAIL / AUTH_PASSWORD_HASH (server/.env) is the admin.
// AUTH_SECRET signs the session cookie.
import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';

const COOKIE = 'ds_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in for 30 days
const INVITE_DAYS = 7;
const attempts = new Map(); // ip → { count, until }

// Without AUTH_SECRET (local dev) sessions are signed with a random key and end when the server restarts.
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function issue(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
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

// Passwords are stored as "salt:scrypt-hash".
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---- Users ----

export class AuthError extends Error {}

const normEmail = (v) => String(v || '').trim().toLowerCase() || null;
// Indian mobile numbers are kept as their last 10 digits, so "+91 98250 12345" and "9825012345" match.
const normPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d ? (d.length > 10 && d.startsWith('91') ? d.slice(-10) : d) : null;
};

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const findUser = (login) =>
  login.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(login))
    : db.prepare('SELECT * FROM users WHERE phone = ?').get(normPhone(login));

export const toPublicUser = (u) => ({
  id: u.id, email: u.email, phone: u.phone, role: u.role, paid: Boolean(u.paid), createdAt: u.createdAt,
  // The contact details for posts given when signing up, until the brand setup takes them over.
  ...(u.profile ? JSON.parse(u.profile) : {}),
});
export const listUsers = () => db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all();
export const setPaid = (id, paid) => db.prepare('UPDATE users SET paid = ? WHERE id = ?').run(paid ? 1 : 0, id);
export const paidCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE paid = 1 AND role = 'customer'").get().n;

// `profile`: { contact, endCard } from the signup form, used by the brand setup.
export function createUser({ email, phone, password, paid = false, profile = null }) {
  email = normEmail(email);
  phone = normPhone(phone);
  if (!email && !phone) throw new AuthError('Enter your email or mobile number');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('That email address doesn’t look right');
  if (phone && phone.length !== 10) throw new AuthError('Enter a 10 digit mobile number');
  if (String(password || '').length < 6) throw new AuthError('Use a password of at least 6 characters');
  if (email && findUser(email)) throw new AuthError('An account with this email already exists. Log in instead.');
  if (phone && findUser(phone)) throw new AuthError('An account with this mobile number already exists. Log in instead.');
  const user = {
    id: crypto.randomUUID(), email, phone, password: hashPassword(password), role: 'customer', paid: paid ? 1 : 0,
    createdAt: new Date().toISOString(), profile: profile ? JSON.stringify(profile) : null,
  };
  db.prepare('INSERT INTO users (id, email, phone, password, role, paid, createdAt, profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    user.id, user.email, user.phone, user.password, user.role, user.paid, user.createdAt, user.profile,
  );
  return user;
}
export const deleteUser = (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id);

// The admin account comes from server/.env; created once, and its password follows AUTH_PASSWORD_HASH.
export const adminId = (() => {
  const email = normEmail(process.env.AUTH_EMAIL);
  if (!email || !process.env.AUTH_PASSWORD_HASH) return null;
  const existing = findUser(email);
  if (existing) {
    db.prepare("UPDATE users SET password = ?, role = 'admin', paid = 1 WHERE id = ?").run(process.env.AUTH_PASSWORD_HASH, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password, role, paid, createdAt) VALUES (?, ?, ?, 'admin', 1, ?)").run(
    id, email, process.env.AUTH_PASSWORD_HASH, new Date().toISOString(),
  );
  return id;
})();

// ---- Invites (admin → a customer who paid but couldn't finish signing up) ----

export function createInvite({ email, phone }) {
  email = normEmail(email);
  phone = normPhone(phone);
  if (!email && !phone) throw new AuthError('Enter their email or mobile number');
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO invites (token, email, phone, createdAt) VALUES (?, ?, ?, ?)').run(token, email, phone, new Date().toISOString());
  return token;
}

function getInvite(token) {
  const inv = db.prepare('SELECT * FROM invites WHERE token = ?').get(String(token || ''));
  if (!inv || inv.usedAt || Date.now() - Date.parse(inv.createdAt) > INVITE_DAYS * 86400000) return null;
  return inv;
}

// ---- Login help (admin → a customer who typed the wrong mobile, email or password) ----

const RESET_DAYS = 3;

/** Corrects an account's login: `email` and `phone` as typed (either may be blank, not both). */
export function updateLogin(id, { email, phone }) {
  const user = getUser(id);
  if (!user) throw new AuthError('Account not found');
  email = normEmail(email);
  phone = normPhone(phone);
  if (!email && !phone) throw new AuthError('Keep an email or a mobile number to log in with');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('That email address doesn’t look right');
  if (phone && phone.length !== 10) throw new AuthError('Enter a 10 digit mobile number');
  const other = (u) => u && u.id !== id;
  if (email && other(findUser(email))) throw new AuthError('Another account already uses this email');
  if (phone && other(findUser(phone))) throw new AuthError('Another account already uses this mobile number');
  db.prepare('UPDATE users SET email = ?, phone = ? WHERE id = ?').run(email, phone, id);
  return getUser(id);
}

/** A one-time link for an account to set a new password (it signs them in). */
export function createReset(userId) {
  if (!getUser(userId)) throw new AuthError('Account not found');
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO resets (token, userId, createdAt) VALUES (?, ?, ?)').run(token, userId, new Date().toISOString());
  return token;
}

function getReset(token) {
  const r = db.prepare('SELECT * FROM resets WHERE token = ?').get(String(token || ''));
  if (!r || r.usedAt || Date.now() - Date.parse(r.createdAt) > RESET_DAYS * 86400000) return null;
  return getUser(r.userId) ? r : null;
}

// ---- Routes ----

export function startSession(req, res, uid) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, issue(uid), { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_MS, path: '/' });
}

const cookieOf = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)))[COOKIE];

const sessionUser = (req) => {
  const s = verify(cookieOf(req));
  return s ? getUser(s.uid) : null;
};

export function mountAuth(app) {
  const json = express.json();

  app.post('/api/login', json, (req, res) => {
    // Slow down guessing: 10 failed tries per 15 minutes per address.
    const ip = req.ip;
    const a = attempts.get(ip);
    if (a && a.count >= 10 && a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

    const login = String(req.body?.login || req.body?.email || '').trim();
    const user = login && findUser(login);
    if (!user || !passwordMatches(req.body?.password || '', user.password)) {
      attempts.set(ip, { count: (a?.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
      return res.status(401).json({ error: 'Wrong email, mobile number or password' });
    }
    attempts.delete(ip);
    startSession(req, res, user.id);
    res.json(toPublicUser(user));
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  app.get('/api/me', (req, res) => {
    const user = sessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    res.json(toPublicUser(user));
  });

  app.get('/api/invites/:token', (req, res) => {
    const inv = getInvite(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invite link has expired or was already used. Ask us for a new one.' });
    res.json({ email: inv.email, phone: inv.phone });
  });

  app.get('/api/resets/:token', (req, res) => {
    const r = getReset(req.params.token);
    if (!r) return res.status(404).json({ error: 'This link has expired or was already used. Ask us for a new one.' });
    const u = getUser(r.userId);
    res.json({ email: u.email, phone: u.phone });
  });

  app.post('/api/resets/:token', json, (req, res) => {
    const r = getReset(req.params.token);
    if (!r) return res.status(404).json({ error: 'This link has expired or was already used. Ask us for a new one.' });
    if (String(req.body?.password || '').length < 6) return res.status(400).json({ error: 'Use a password of at least 6 characters' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(req.body.password), r.userId);
    db.prepare('UPDATE resets SET usedAt = ? WHERE token = ?').run(new Date().toISOString(), r.token);
    startSession(req, res, r.userId);
    res.json(toPublicUser(getUser(r.userId)));
  });

  // Accepting an invite creates a paid account; the brand setup then opens on first login.
  app.post('/api/invites/:token', json, (req, res) => {
    const inv = getInvite(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invite link has expired or was already used. Ask us for a new one.' });
    try {
      const user = createUser({ email: req.body?.email || inv.email, phone: req.body?.phone || inv.phone, password: req.body?.password, paid: true });
      db.prepare('UPDATE invites SET usedAt = ? WHERE token = ?').run(new Date().toISOString(), inv.token);
      startSession(req, res, user.id);
      res.status(201).json(toPublicUser(user));
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      res.status(400).json({ error: err.message });
    }
  });
}

// Everything under /api needs a session, except signing up and in, the landing page's numbers, and what the
// ChatGPT player needs (it polls a job by its unguessable id from outside the app, where there is no cookie).
const OPEN = ['/api/login', '/api/logout', '/api/me', '/api/signup', '/api/public/stats', '/api/pay/return', '/api/pay/webhook'];
export function requireAuth(req, res, next) {
  const p = req.originalUrl.split('?')[0]; // req.path is relative to where this is mounted
  const open = OPEN.includes(p) || p.startsWith('/api/invites/') || p.startsWith('/api/resets/') || (req.method === 'GET' && /^\/api\/jobs\/[\w-]+$/.test(p));
  if (open) return next();
  req.user = sessionUser(req);
  if (req.user) return next();
  res.status(401).json({ error: 'Please sign in' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Admins only' });
}
