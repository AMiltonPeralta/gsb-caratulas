import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const dtf = new Intl.DateTimeFormat('es-AR', {
  timeZone: config.timeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const df = new Intl.DateTimeFormat('es-AR', {
  timeZone: config.timeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dtf.format(d).replace(',', ' ·');
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return df.format(d);
}

export function formatDateLong(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: config.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('54')) {
    if (digits.length === 12 && !digits.startsWith('549')) return `549${digits.slice(2)}`;
    return digits;
  }
  if (digits.length === 10) return `549${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `549${digits.slice(1)}`;
  return digits;
}

export function waLink(phone, text) {
  const n = normalizePhone(phone);
  const base = n ? `https://wa.me/${n}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function truncate(text, max = 180) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const STATUS_LABEL = {
  pending: 'Pendiente',
  viewed: 'Visto',
  signed: 'Firmado',
  expired: 'Vencido',
  revoked: 'Anulado',
};

export function requestStatus(request) {
  if (request.status === 'signed' || request.status === 'revoked') return request.status;
  if (new Date(request.expires_at).getTime() < Date.now()) return 'expired';
  return request.status;
}

/**
 * Estado global del candidato a partir de sus solicitudes.
 * draft → sin enviar · sent → enviadas, nadie firmó · partial → alguna firma
 * signed → todas firmadas · expired → todas vencidas sin firmar
 * rejected → el Directorio cerró el proceso
 */
export function candidateStatus(candidateId) {
  const candidate = q.get('SELECT rejected_at FROM candidates WHERE id = ?', candidateId);
  if (candidate?.rejected_at) return 'rejected';
  const requests = q.all('SELECT * FROM signature_requests WHERE candidate_id = ?', candidateId);
  if (requests.length === 0) return 'draft';
  const statuses = requests.map(requestStatus);
  const signed = statuses.filter((s) => s === 'signed').length;
  if (signed === requests.length) return 'signed';
  if (signed > 0) return 'partial';
  if (requests.some((r) => r.sent_at || r.first_viewed_at)) return 'sent';
  if (statuses.some((s) => s === 'pending' || s === 'viewed')) return 'draft';
  return 'expired';
}

export const CANDIDATE_STATUS_LABEL = {
  draft: 'Borrador',
  sent: 'Enviado',
  partial: 'Firma parcial',
  signed: 'Firmado',
  expired: 'Vencido',
  rejected: 'Rechazado',
};

export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const buf = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  if (buf.length < 200 || buf.length > 2_000_000) return null;
  // Firma PNG válida
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return buf;
}

export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function publicBaseUrl(req) {
  if (config.baseUrl) return config.baseUrl;
  return `${req.protocol}://${req.get('host')}`;
}
