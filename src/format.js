import { escapeHtml } from './util.js';

const SECTION_RE = /^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ\s]{2,40}:$/;

/** Convierte el resumen (texto plano con secciones y viñetas) en HTML seguro. */
export function summaryHtml(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const clean = line.replace(/^[•\-*]\s*/, '');
    if (SECTION_RE.test(line)) {
      closeList();
      out.push(`<h3>${escapeHtml(line.replace(/:$/, ''))}</h3>`);
    } else if (/^[•\-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(clean)}</li>`);
    } else {
      closeList();
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

export function initials(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '—';
}

export function displayValue(value) {
  return value === null || value === undefined || value === '' ? '—' : value;
}
