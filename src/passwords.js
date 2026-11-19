import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';

/* ── Clave del panel ───────────────────────────────────────────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('La clave tiene que tener al menos 12 caracteres.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPasswordHash(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return safeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function checkPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (config.adminPasswordHash) return verifyPasswordHash(candidate, config.adminPasswordHash);
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return safeEqual(hash(candidate), hash(config.adminPassword));
}

/**
 * Autentica un usuario con nombre de usuario y contraseña.
 * Soporta usuarios guardados en la base de datos o los perfiles oficiales (yohita, yoha, admin, milton).
 */
export function authenticateUser(username, password) {
  if (!password) return null;
  const cleanUser = String(username || 'yohita').trim().toLowerCase();
  const isMasterPassword = checkPassword(password);

  // 1. Intentar validar contra la tabla users en SQLite
  try {
    const userRow = q.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', cleanUser);
    if (userRow) {
      const matchHash = userRow.password_hash ? verifyPasswordHash(password, userRow.password_hash) : false;
      const matchPlain = userRow.password_plain ? safeEqual(password, userRow.password_plain) : false;
      if (matchHash || matchPlain || isMasterPassword) {
        return {
          id: userRow.id,
          username: userRow.username,
          name: userRow.full_name,
          role: userRow.role || 'admin',
        };
      }
    }
  } catch (err) {
    // Si la tabla no está creada aún o falla la consulta
  }

  // 2. Si la contraseña maestra es correcta
  if (isMasterPassword) {
    if (['yohita', 'yoha'].includes(cleanUser) || cleanUser === '') {
      return { id: 1, username: 'yohita', name: 'Yohita', role: 'admin' };
    }
    if (cleanUser === 'milton') {
      return { id: 2, username: 'milton', name: 'Milton', role: 'admin' };
    }
    if (cleanUser === 'admin') {
      return { id: 3, username: 'admin', name: 'Administrador', role: 'admin' };
    }
    // Cualquier otro usuario que use la clave autorizada de la empresa
    return { id: 99, username: cleanUser, name: cleanUser.charAt(0).toUpperCase() + cleanUser.slice(1), role: 'admin' };
  }

  return null;
}


/* ── Doble factor TOTP (RFC 6238) ──────────────────────────────────────── */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const clean = String(input ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  if (key.length === 0) return null;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function totpCode(secret, at = Date.now()) {
  return hotp(secret, Math.floor(at / 30_000));
}

export function verifyTotp(code, secret = config.adminTotpSecret) {
  if (!secret) return true;
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (const offset of [-1, 0, 1]) {
    const expected = hotp(secret, step + offset);
    if (expected && safeEqual(clean, expected)) return true;
  }
  return false;
}

export function totpEnabled() {
  return Boolean(config.adminTotpSecret);
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

export function totpUri(secret, account = config.adminName) {
  const issuer = config.companyName || 'Carátulas';
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
