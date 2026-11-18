import crypto from 'node:crypto';
import { config } from './config.js';

/* ── Cabeceras de seguridad ────────────────────────────────────────────── */

export function securityHeaders(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const secure = Boolean(req.secure || config.baseUrl.startsWith('https://'));
  res.locals.cspNonce = nonce;
  res.locals.secure = secure;

  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (secure) csp.push('upgrade-insecure-requests');

  res.set('Content-Security-Policy', csp.join('; '));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.set('X-DNS-Prefetch-Control', 'off');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  if (secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // El panel y los links de firma tienen datos personales: no se cachean.
  if (req.path.startsWith('/admin') || req.path.startsWith('/f/')) {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    res.set('X-Request-ID', crypto.randomUUID());
  }
  next();
}

/* ── HTTPS y dominio permitido ─────────────────────────────────────────── */

export function enforceHttps(req, res, next) {
  if (!config.forceHttps || req.secure || req.path === '/healthz') return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    const host = req.get('host');
    if (!host) return res.status(400).send('Host inválido.');
    return res.redirect(308, `https://${host}${req.originalUrl}`);
  }
  return res.status(403).send('Esta acción requiere una conexión cifrada (HTTPS).');
}

export function checkHost(req, res, next) {
  if (!config.allowedHosts.length) return next();
  const raw = (req.get('host') ?? '').toLowerCase();
  const hostname = raw.replace(/:\d+$/, '');
  if (config.allowedHosts.includes(raw) || config.allowedHosts.includes(hostname)) return next();
  return res.status(400).send('Dominio no permitido.');
}

/* ── Rate limiting simple en memoria ───────────────────────────────────── */

export function rateLimit({ windowMs, max, message = 'Demasiadas solicitudes. Esperá unos minutos.', key }) {
  const hits = new Map();
  return (req, res, next) => {
    const id = key ? key(req) : (req.ip ?? 'desconocido');
    const now = Date.now();
    const entry = hits.get(id);
    if (!entry || now - entry.first > windowMs) {
      hits.set(id, { count: 1, first: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.first + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

/* ── Archivos descargables ─────────────────────────────────────────────── */

/**
 * Los PDF y las imágenes no deben interpretarse como HTML. Se quita la CSP de
 * página para no romper el visor nativo del navegador y se fuerza el tipo.
 */
export function fileHeaders(res, { type, disposition }) {
  // La CSP de página puede romper el visor nativo de PDF. El tipo controlado
  // y nosniff evitan que el archivo se interprete como HTML.
  res.removeHeader('Content-Security-Policy');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Type', type);
  if (disposition) res.set('Content-Disposition', disposition);
  res.set('Cache-Control', 'private, no-store, max-age=0');
}

/* ── security.txt / robots.txt ─────────────────────────────────────────── */

export function securityTxt(req, res) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const contact = config.securityContact || `${config.baseUrl}/seguridad`;
  res.type('text/plain').send(
    [
      `Contact: ${contact}`,
      `Expires: ${expires}`,
      'Preferred-Languages: es',
      `Canonical: ${config.baseUrl}/.well-known/security.txt`,
      'Policy: ' + `${config.baseUrl}/seguridad`,
      '',
    ].join('\n'),
  );
}

export function robotsTxt(req, res) {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
}
