import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { q } from './db.js';
import { checkPassword } from './passwords.js';

const COOKIE = 'yc_admin';
const attempts = new Map();

export { checkPassword };

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function readCookie(req) {
  const raw = req.headers.cookie ?? '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(COOKIE.length + 1));
  } catch {
    return null;
  }
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure || config.baseUrl.startsWith('https://')),
    path: '/',
  };
}

/** Borra sesiones vencidas o revocadas hace más de una semana. */
function cleanupSessions() {
  q.run(
    'DELETE FROM admin_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
    iso(Date.now() - 7 * 24 * 60 * 60 * 1000),
    iso(Date.now() - 7 * 24 * 60 * 60 * 1000),
  );
}

/* ── Rate limit de login (solo intentos fallidos) ──────────────────────── */

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export function loginRateLimited(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > FAILURE_WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function registerLoginFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.first > FAILURE_WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(ip) {
  attempts.delete(ip);
}

/* ── Sesiones en base de datos ─────────────────────────────────────────── */

export function issueSession(res, req) {
  cleanupSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  q.run(
    `INSERT INTO admin_sessions (token_hash, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    hashToken(token),
    csrfToken,
    iso(now),
    iso(now),
    iso(now + config.sessionTtlMs),
    req.ip ?? null,
    (req.get('user-agent') ?? '').slice(0, 400),
  );
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: config.sessionTtlMs });
  return { csrfToken, expiresAt: now + config.sessionTtlMs };
}

export function readSession(req) {
  const token = readCookie(req);
  if (!token) return null;
  const row = q.get('SELECT * FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL', hashToken(token));
  if (!row) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    q.run('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?', iso(now), row.token_hash);
    return null;
  }
  if (new Date(row.last_seen_at).getTime() + config.sessionIdleMs <= now) {
    q.run('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?', iso(now), row.token_hash);
    return null;
  }

  // Evita una escritura por request: alcanza con actualizar cada minuto.
  if (now - new Date(row.last_seen_at).getTime() > 60_000) {
    q.run('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?', iso(now), row.token_hash);
  }

  return {
    tokenHash: row.token_hash,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

export function clearSession(req, res) {
  const token = readCookie(req);
  if (token) {
    q.run('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?', iso(), hashToken(token));
  }
  res.clearCookie(COOKIE, cookieOptions(req));
}

export function revokeOtherSessions(req) {
  if (!req.admin) return 0;
  const result = q.run(
    'UPDATE admin_sessions SET revoked_at = ? WHERE token_hash != ? AND revoked_at IS NULL',
    iso(),
    req.admin.tokenHash,
  );
  return result.changes;
}

export function activeSessionCount() {
  const row = q.get(
    'SELECT COUNT(*) AS total FROM admin_sessions WHERE revoked_at IS NULL AND expires_at > ?',
    iso(),
  );
  return Number(row?.total ?? 0);
}

/* ── Middlewares ───────────────────────────────────────────────────────── */

export function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (session) {
    req.admin = session;
    res.locals.csrfToken = session.csrfToken;
    res.locals.adminSession = session;
    return next();
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/') || req.xhr || (req.get('accept') ?? '').includes('application/json')) {
    return res.status(401).json({ error: 'Sesión vencida. Volvé a entrar.' });
  }
  return res.redirect('/admin/login');
}

export function requireCsrf(req, res, next) {
  const session = req.admin ?? readSession(req);
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  if (!session || !sent || !safeEqual(sent, session.csrfToken)) {
    // Si el formulario ya subió un archivo temporal, no lo dejamos huérfano.
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ya no existe */ }
    }
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/') || (req.get('accept') ?? '').includes('application/json')) {
      return res.status(403).json({ error: 'La solicitud no tiene un token de seguridad válido. Recargá la página.' });
    }
    return res.status(403).render('error', {
      title: 'Solicitud no permitida',
      message: 'La página venció o la solicitud no es válida. Recargá e intentá de nuevo.',
      company: config.companyName,
    });
  }
  return next();
}

export function sameOrigin(req, res, next) {
  // Sec-Fetch-Site es más confiable que Origin en formularios y navegadores
  // embebidos. SameSite=Lax protege además las acciones autenticadas.
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  const origin = req.get('origin');
  if (!origin || origin === 'null') return next();
  try {
    const originUrl = new URL(origin);
    const requestHost = (req.get('host') ?? '').toLowerCase();
    const baseHost = new URL(config.baseUrl).host.toLowerCase();
    if (originUrl.host.toLowerCase() === requestHost || originUrl.host.toLowerCase() === baseHost) return next();
  } catch {
    /* origen inválido */
  }
  return res.status(403).json({ error: 'Origen no permitido.' });
}
