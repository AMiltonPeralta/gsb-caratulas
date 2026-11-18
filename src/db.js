import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// En Linux/macOS limita el acceso a la base y a los archivos a la cuenta que
// corre la app. En Windows el equivalente es una carpeta con permisos NTFS.
try {
  fs.chmodSync(config.dbPath, 0o600);
  fs.chmodSync(config.uploadDir, 0o700);
} catch {
  /* plataformas sin permisos POSIX */
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export const q = {
  all: (sql, ...params) => stmt(sql).all(...params),
  get: (sql, ...params) => stmt(sql).get(...params),
  run: (sql, ...params) => {
    const info = stmt(sql).run(...params);
    return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
  },
  exec: (sql) => db.exec(sql),
};

export function nowIso() {
  return new Date().toISOString();
}

/*
 * Cadena de auditoría.
 * Cada fila incluye el hash de la fila anterior y su propio hash. Si alguien
 * modifica o borra un evento, la verificación deja de cerrar. No vuelve la
 * base inmutable, pero sí convierte cualquier manipulación en detectable.
 */
const AUDIT_GENESIS = '';

function auditEntryHash(prevHash, row) {
  const payload = [
    prevHash,
    row.candidate_id ?? '',
    row.request_id ?? '',
    row.event ?? '',
    row.detail ?? '',
    row.ip ?? '',
    row.user_agent ?? '',
    row.created_at ?? '',
  ].join('\u001f');
  return crypto.createHash('sha256').update(`audit-v1|${payload}`).digest('hex');
}

export function audit({ candidateId = null, requestId = null, event, detail = '', req = null }) {
  const createdAt = nowIso();
  const last = q.get('SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = last?.entry_hash ?? AUDIT_GENESIS;
  const row = {
    candidate_id: candidateId,
    request_id: requestId,
    event,
    detail,
    ip: req?.ip ?? null,
    user_agent: req?.get?.('user-agent')?.slice(0, 400) ?? null,
    created_at: createdAt,
  };
  const entryHash = auditEntryHash(prevHash, row);
  q.run(
    `INSERT INTO audit_log (candidate_id, request_id, event, detail, ip, user_agent, created_at, prev_hash, entry_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    candidateId,
    requestId,
    event,
    detail,
    row.ip,
    row.user_agent,
    createdAt,
    prevHash,
    entryHash,
  );
}

/** Sella los eventos viejos que se crearon antes de existir la cadena. */
export function ensureAuditChain() {
  const rows = q.all('SELECT * FROM audit_log WHERE entry_hash IS NULL ORDER BY id ASC');
  if (rows.length === 0) return 0;
  let prevHash = q.get('SELECT entry_hash FROM audit_log WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1')?.entry_hash ?? AUDIT_GENESIS;
  for (const row of rows) {
    const entryHash = auditEntryHash(prevHash, row);
    q.run('UPDATE audit_log SET prev_hash = ?, entry_hash = ? WHERE id = ?', prevHash, entryHash, row.id);
    prevHash = entryHash;
  }
  return rows.length;
}

export function verifyAuditChain() {
  const rows = q.all('SELECT * FROM audit_log ORDER BY id ASC');
  let prevHash = AUDIT_GENESIS;
  for (const row of rows) {
    if (!row.entry_hash) {
      return { ok: false, checked: rows.length, brokenAt: row.id, reason: 'Hay eventos sin sellar.' };
    }
    if ((row.prev_hash ?? AUDIT_GENESIS) !== prevHash) {
      return { ok: false, checked: rows.length, brokenAt: row.id, reason: 'La cadena se cortó: falta o cambió un evento anterior.' };
    }
    const expected = auditEntryHash(prevHash, row);
    if (expected !== row.entry_hash) {
      return { ok: false, checked: rows.length, brokenAt: row.id, reason: 'El contenido de un evento no coincide con su sello.' };
    }
    prevHash = row.entry_hash;
  }
  return {
    ok: true,
    checked: rows.length,
    lastHash: prevHash || null,
    lastAt: rows.at(-1)?.created_at ?? null,
  };
}
