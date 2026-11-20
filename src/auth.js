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

/* ── Sesiones resilientes y criptográficamente firmadas ────────────────── */

const PERSISTENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días de sesión ininterrumpida

function signToken(payloadObj) {
  const json = JSON.stringify(payloadObj);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const hmac = crypto.createHmac('sha256', config.sessionSecret).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

function verifyToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.indexOf('.');
  if (dot === -1) return null;
  const b64 = rawToken.slice(0, dot);
  const hmac = rawToken.slice(dot + 1);
  if (!b64 || !hmac) return null;

  try {
    const expectedHmac = crypto.createHmac('sha256', config.sessionSecret).update(b64).digest('base64url');
    if (hmac.length !== expectedHmac.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
      return null;
    }
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    const data = JSON.parse(json);
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function issueSession(res, req, user = { username: 'yohita', name: 'Yohita' }) {
  cleanupSessions();
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const expiresAt = now + PERSISTENT_SESSION_TTL_MS;

  const payload = {
    u: user.username || 'yohita',
    n: user.name || 'Yohita',
    r: user.role || 'admin',
    csrf: csrfToken,
    iat: now,
    exp: expiresAt,
  };

  const signedCookieToken = signToken(payload);
  const tokenHashValue = hashToken(signedCookieToken);

  try {
    q.run(
      `INSERT INTO admin_sessions (token_hash, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent, username, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tokenHashValue,
      csrfToken,
      iso(now),
      iso(now),
      iso(expiresAt),
      req.ip ?? null,
      (req.get('user-agent') ?? '').slice(0, 400),
      user.username || 'yohita',
      user.name || 'Yohita',
    );
  } catch {}

  res.cookie(COOKIE, signedCookieToken, { ...cookieOptions(req), maxAge: PERSISTENT_SESSION_TTL_MS });
  res.cookie('gsb_user', user.username || 'yohita', {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });
  return { csrfToken, expiresAt };
}

export function readSession(req) {
  const token = readCookie(req);
  if (!token) return null;

  // 1. Verificación por firma criptográfica (no depende de SQLite en reinicios de Render)
  const payload = verifyToken(token);
  const now = Date.now();

  if (payload) {
    const tokenHashValue = hashToken(token);

    // Verificar si fue explícitamente revocada
    let row = null;
    try {
      row = q.get('SELECT * FROM admin_sessions WHERE token_hash = ?', tokenHashValue);
      if (row && row.revoked_at) {
        return null;
      }
    } catch {}

    // Si SQLite se recreó por reinicio del contenedor, reinsertamos la sesión automáticamente
    if (!row) {
      try {
        q.run(
          `INSERT OR IGNORE INTO admin_sessions (token_hash, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent, username, user_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tokenHashValue,
          payload.csrf,
          iso(payload.iat || now),
          iso(now),
          iso(payload.exp || now + PERSISTENT_SESSION_TTL_MS),
          req.ip ?? null,
          (req.get('user-agent') ?? '').slice(0, 400),
          payload.u || 'yohita',
          payload.n || 'Yohita',
        );
      } catch {}
    } else if (now - new Date(row.last_seen_at).getTime() > 60_000) {
      try {
        q.run('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?', iso(now), tokenHashValue);
      } catch {}
    }

    return {
      tokenHash: tokenHashValue,
      csrfToken: payload.csrf,
      createdAt: iso(payload.iat || now),
      expiresAt: iso(payload.exp || now + PERSISTENT_SESSION_TTL_MS),
      lastSeenAt: iso(now),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? '',
      username: payload.u || 'yohita',
      userName: payload.n || 'Yohita',
      role: payload.r || 'admin',
    };
  }

  // 2. Fallback para sesiones anteriores basadas sólo en tabla SQLite
  try {
    const row = q.get('SELECT * FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL', hashToken(token));
    if (!row) return null;

    if (new Date(row.expires_at).getTime() <= now) {
      q.run('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?', iso(now), row.token_hash);
      return null;
    }

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
      username: row.username || 'yohita',
      userName: row.user_name || 'Yohita',
      role: 'admin',
    };
  } catch {
    return null;
  }
}

export function clearSession(req, res) {
  const token = readCookie(req);
  if (token) {
    try {
      q.run('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?', iso(), hashToken(token));
    } catch {}
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

export function readRememberedUser(req) {
  const raw = req?.headers?.cookie ?? '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith('gsb_user='));
  if (!match) return 'yohita';
  try {
    return decodeURIComponent(match.slice('gsb_user='.length)) || 'yohita';
  } catch {
    return 'yohita';
  }
}

export function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (session) {
    req.admin = session;
    res.locals.csrfToken = session.csrfToken;
    res.locals.adminSession = session;
    res.locals.adminName = session.userName || config.adminName;
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
