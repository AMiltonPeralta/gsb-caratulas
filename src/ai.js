import fs from 'node:fs';
import { config } from './config.js';
import { truncate } from './util.js';
import { GSB_BRANCHES } from './gsb.js';

/* ── Lectura del CV ────────────────────────────────────────────────────── */

export async function extractCvText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, 8);
    const chunks = [];
    for (let i = 1; i <= pages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      chunks.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      if (chunks.join(' ').length > 20000) break;
    }
    await doc.destroy();
    return chunks.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  } catch (err) {
    console.warn('[cv] no se pudo extraer texto:', err.message);
    return '';
  }
}

/* ── Prompts ───────────────────────────────────────────────────────────── */

function readPromptFile(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function loadPrompt() {
  return readPromptFile(
    config.aiPromptFile,
    'Resumí el CV del candidato en español rioplatense, máximo 200 palabras.',
  );
}

function loadExtractionPrompt() {
  return readPromptFile(
    config.aiExtractionPromptFile,
    'Extraé del CV el nombre, puesto, área, seniority, remuneración, disponibilidad y LinkedIn. Devolvé solo JSON.',
  );
}

function fillPrompt(template, candidate, cvText) {
  const values = {
    full_name: candidate.full_name ?? '',
    position: candidate.position ?? '',
    area: candidate.area ?? '',
    client: candidate.client ?? '',
    seniority: candidate.seniority ?? '',
    salary: candidate.salary ?? '',
    start_date: candidate.start_date ?? '',
    notes: candidate.notes ?? '',
    job_function: candidate.job_function ?? '',
    sector: candidate.sector ?? '',
    branch: candidate.branch ?? '',
    observations: candidate.observations ?? '',
    cv_text: cvText || '(no se pudo extraer texto del CV)',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''));
}

/* ── Lectura heurística del CV (mock y respaldo) ───────────────────────── */

const fieldLimits = {
  full_name: 140,
  position: 140,
  area: 140,
  client: 140,
  seniority: 80,
  salary: 120,
  start_date: 120,
  linkedin: 200,
  notes: 4000,
  age: 40,
  branch: 80,
  selected_by: 140,
  technical_test: 120,
  cultural_fit: 80,
  job_function: 140,
  sector: 120,
  national_manager: 140,
  branch_manager: 140,
  direct_leader: 140,
  observations: 500,
};

const nameConnectors = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
const nameStops = new Set([
  'perfil',
  'experiencia',
  'formacion',
  'formación',
  'educacion',
  'educación',
  'contacto',
  'datos',
  'resumen',
  'disponibilidad',
  'referencias',
  'curriculum',
  'vitae',
  'cv',
]);

const roleWords = [
  'gerente',
  'jefe',
  'jefa',
  'director',
  'directora',
  'coordinador',
  'coordinadora',
  'analista',
  'asistente',
  'especialista',
  'responsable',
  'lider',
  'líder',
  'supervisor',
  'supervisora',
  'consultor',
  'consultora',
  'administrador',
  'administradora',
  'operario',
  'operaria',
  'vendedor',
  'vendedora',
  'desarrollador',
  'desarrolladora',
  'product manager',
  'project manager',
  'head',
  'manager',
  'ceo',
  'cfo',
  'coo',
  'cto',
];

const degreeWords = [
  'licenciado',
  'licenciada',
  'ingeniero',
  'ingeniera',
  'contador',
  'contadora',
  'abogado',
  'abogada',
  'tecnico',
  'técnico',
  'tecnica',
  'técnica',
  'profesor',
  'profesora',
];

const roleRe = new RegExp(`\\b(${roleWords.map(escapeRegExp).join('|')})\\b`, 'i');
const degreeRe = new RegExp(`\\b(${degreeWords.map(escapeRegExp).join('|')})\\b`, 'i');

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñü])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

function cleanText(value, max = 500) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function guessName(cvText) {
  const head = String(cvText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!head) return '';
  const parts = [];
  for (const raw of head.split(' ')) {
    const token = raw.replace(/[·|,;:()]/g, '');
    if (!token) break;
    const lower = token.toLowerCase();
    if (nameStops.has(lower) || roleRe.test(token) || /\d/.test(token)) break;
    if (nameConnectors.has(lower)) {
      if (parts.length === 0) return '';
      parts.push(token);
      continue;
    }
    const nameLike = /^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'’.-]+$/.test(token) || /^[A-ZÁÉÍÓÚÑÜ'’.-]+$/.test(token);
    if (!nameLike) break;
    parts.push(token);
    if (parts.length >= 4) break;
  }
  while (parts.length && nameConnectors.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  if (parts.length < 2) return '';
  return titleCase(parts.join(' ')).slice(0, 140);
}

function nameFromFileName(originalName) {
  const base = String(originalName ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(cv|curriculum|vitae|curriculum vitae)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = base.split(' ').filter((w) => w && !/\d/.test(w));
  if (words.length < 2) return '';
  return titleCase(words.join(' ')).slice(0, 140);
}

function guessPosition(cvText) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ');
  const matches = text.matchAll(new RegExp(roleRe.source, 'gi'));
  for (const match of matches) {
    if (degreeRe.test(match[0])) continue;
    const tail = text.slice(match.index, match.index + 120);
    const cut = tail.search(
      /\s[·|•]\s|\s[–—]\s|,|;|\.\s|\s(?:perfil|experiencia|formaci[oó]n|educaci[oó]n|contacto|referencias|datos)\b|\s(?:19|20)\d{2}\b/i,
    );
    const phrase = (cut > 0 ? tail.slice(0, cut) : tail)
      .split(/\s+/)
      .slice(0, 6)
      .join(' ')
      .replace(/[·|•,;:]+$/, '')
      .trim();
    if (phrase && phrase.length <= 100) return phrase;
  }
  return '';
}

const areaRules = [
  [/operaciones/i, 'Operaciones'],
  [/producci[oó]n|manufactura|planta/i, 'Producción'],
  [/log[ií]stica|supply chain|abastecimiento/i, 'Logística'],
  [/finanzas|financiero|contabilidad|tesorer[ií]a/i, 'Finanzas'],
  [/recursos humanos|rrhh|capital humano|personas|talento/i, 'Recursos Humanos'],
  [/comercial|ventas|sales/i, 'Comercial'],
  [/marketing|comunicaci[oó]n/i, 'Marketing'],
  [/sistemas|tecnolog[ií]a|inform[aá]tica|desarrollo de software|\bti\b/i, 'Sistemas'],
  [/compras/i, 'Compras'],
  [/administraci[oó]n/i, 'Administración'],
  [/legal|jur[ií]dico|abogac[ií]a/i, 'Legal'],
  [/atenci[oó]n al cliente|servicio al cliente/i, 'Atención al cliente'],
];

function guessArea(cvText) {
  const text = String(cvText ?? '');
  for (const [rule, area] of areaRules) {
    if (rule.test(text)) return area;
  }
  return '';
}

const yearWords = {
  un: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciséis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};

function guessSeniority(cvText) {
  const text = String(cvText ?? '');
  const lower = text.toLowerCase();
  let years = 0;

  const digit = lower.match(/(\d{1,2})\s*\+?\s*(?:años|anos|years)/);
  if (digit) {
    years = Number.parseInt(digit[1], 10);
  } else {
    const word = lower.match(
      /\b(un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte)\s+(?:años|anos)\b/,
    );
    if (word) years = yearWords[word[1]] ?? 0;
  }

  let level = '';
  if (/\bsemi[\s-]?senior\b|\bssr\b/i.test(text)) level = 'Semi senior';
  else if (/\bsenior\b|\bsr\b/i.test(text)) level = 'Senior';
  else if (/\bjunior\b|\bjr\b/i.test(text)) level = 'Junior';
  else if (years >= 6) level = 'Senior';
  else if (years >= 3) level = 'Semi senior';
  else if (years >= 1) level = 'Junior';

  if (level && years) return `${level} · ${years} años`;
  return level;
}

function guessSalary(cvText) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ');
  const labeled = text.match(
    /(?:pretensi[oó]n(?:es)?(?: salarial(?:es)?)?|remuneraci[oó]n(?: pretendida)?|sueldo (?:pretendido|esperado))\s*:?\s*([^.;·|]{3,80})/i,
  );
  if (labeled) return cleanText(labeled[1], 120);
  const money = text.match(/\$\s?[\d][\d.,]*(?:\s*(?:mil|millones|k))?(?:\s*(?:brutos?|netos?))?/i);
  return money ? cleanText(money[0], 120) : '';
}

function guessStartDate(cvText) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ');
  const match = text.match(
    /disponibilidad(?: para comenzar| para iniciar| horaria)?\s*:?\s*([^.;·|]{2,60})/i,
  );
  if (!match) return '';
  const value = cleanText(match[1], 120);
  if (/^para (?:viajar|viajes|movilidad|residir)/i.test(value)) return '';
  return value;
}

function guessLinkedin(cvText) {
  const match = String(cvText ?? '').match(
    /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i,
  );
  return match ? match[0] : '';
}

function guessAge(cvText) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ');
  const labeled = text.match(/\bedad\s*:?\s*(\d{1,2})\b/i);
  if (labeled) return `${labeled[1]} años`;
  const years = text.match(/\b(\d{1,2})\s*(?:años|anos)\b/i);
  if (years) {
    const age = Number.parseInt(years[1], 10);
    if (age >= 16 && age <= 80) return `${age} años`;
  }
  return '';
}

function normalizePlace(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function guessBranch(cvText) {
  const text = normalizePlace(cvText);
  // De la más larga a la más corta para que "Chaco Resistencia" gane sobre "Chaco".
  const branches = [...GSB_BRANCHES].sort((a, b) => b.length - a.length);
  for (const branch of branches) {
    if (text.includes(normalizePlace(branch))) return branch;
  }
  return '';
}

function heuristicFields(cvText, originalName) {
  const position = guessPosition(cvText);
  return {
    full_name: guessName(cvText) || nameFromFileName(originalName),
    position,
    area: guessArea(cvText),
    client: '',
    seniority: guessSeniority(cvText),
    salary: guessSalary(cvText),
    start_date: guessStartDate(cvText),
    linkedin: guessLinkedin(cvText),
    notes: '',
    age: guessAge(cvText),
    branch: guessBranch(cvText),
    selected_by: '',
    technical_test: '',
    cultural_fit: '',
    job_function: position,
    sector: '',
    national_manager: '',
    branch_manager: '',
    direct_leader: '',
    observations: '',
  };
}

/* ── Resumen ───────────────────────────────────────────────────────────── */

function sectionAlternation(words) {
  return words
    .map((word) => {
      const upper = word.toUpperCase();
      const title = word.replace(/^([a-z])/, (letter) => letter.toUpperCase());
      return `(?:${upper}|${title})`;
    })
    .join('|');
}

function cvSection(cvText, headings, stops) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const pattern = new RegExp(
    `(?:${sectionAlternation(headings)})\\s+([\\s\\S]{10,600}?)(?=\\s+(?:${sectionAlternation(stops)})\\b|$)`,
  );
  const match = pattern.exec(text);
  return match ? cleanText(match[1], 400) : '';
}

function cvExcerpt(cvText, name, position) {
  const text = String(cvText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const profile = cvSection(text, ['perfil', 'resumen profesional', 'sobre m[ií]'], [
    'experiencia',
    'formaci[oó]n',
    'educaci[oó]n',
    'referencias',
    'datos',
    'contacto',
  ]);
  if (profile) return truncate(profile, 380);

  let rest = text;
  if (name) rest = rest.replace(new RegExp(`^${escapeRegExp(name)}\\s*`, 'i'), '');
  if (position) rest = rest.replace(new RegExp(`^${escapeRegExp(position)}\\s*`, 'i'), '');
  return truncate(rest.replace(/^[·|–—,:;\s-]+/, ''), 380);
}

function mockSummary(candidate, cvText) {
  const name = candidate.full_name || 'El candidato';
  const position = candidate.position || 'la búsqueda';
  const area = candidate.area ? ` en el área de ${candidate.area}` : '';
  const seniority = candidate.seniority ? ` con perfil ${candidate.seniority}` : '';
  const excerpt = cvExcerpt(cvText, candidate.full_name, candidate.position);
  const experience = cvSection(
    cvText,
    ['experiencia(?: laboral| profesional)?'],
    ['formaci[oó]n', 'educaci[oó]n', 'referencias', 'idiomas', 'cursos', 'habilidades', 'datos', 'contacto'],
  );
  const formation = cvSection(
    cvText,
    ['formaci[oó]n(?: acad[eé]mica)?', 'educaci[oó]n'],
    ['referencias', 'experiencia', 'idiomas', 'cursos', 'habilidades', 'datos', 'contacto'],
  );

  return [
    'PERFIL:',
    `${name} se postula para ${position}${area}${seniority}. ${excerpt || 'El CV se adjunta en este expediente para su lectura completa.'}`,
    '',
    'EXPERIENCIA:',
    experience
      ? `• ${truncate(experience, 320)}`
      : `• ${position} — trayectoria y empresas detalladas en el CV adjunto.`,
    candidate.notes ? `• ${truncate(candidate.notes, 220)}` : '• Experiencia alineada con la búsqueda.',
    '',
    'FORMACIÓN:',
    formation ? `• ${truncate(formation, 260)}` : 'Sin datos en el CV.',
    '',
    'PUNTOS FUERTES:',
    '• Perfil alineado con la búsqueda.',
    candidate.seniority ? `• Experiencia ${candidate.seniority}.` : '• Experiencia en posiciones similares.',
    candidate.start_date ? `• Disponibilidad: ${candidate.start_date}.` : '• Disponibilidad a confirmar en entrevista.',
  ].join('\n');
}

/* ── Proveedores ───────────────────────────────────────────────────────── */

function defaultModel(provider) {
  return provider === 'gemini' ? 'gemini-2.5-flash' : 'google/gemini-2.5-flash';
}

async function gemini(prompt) {
  const model = config.aiModel || defaultModel('gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Gemini respondió ${res.status}: ${truncate(await res.text(), 200)}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return clean(text);
}

async function openrouter(prompt) {
  const model = config.aiModel || defaultModel('openrouter');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openrouterApiKey}`,
      'x-title': 'Firma de caratulas',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1400,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}: ${truncate(await res.text(), 200)}`);
  const json = await res.json();
  return clean(json.choices?.[0]?.message?.content ?? '');
}

function callProvider(prompt, provider) {
  return provider === 'gemini' ? gemini(prompt) : openrouter(prompt);
}

function clean(text) {
  return String(text ?? '')
    .replace(/^```(?:text|markdown|json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function parseJsonObject(text) {
  const cleaned = clean(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('La IA no devolvió un JSON válido.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeExtractedFields(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, max] of Object.entries(fieldLimits)) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) out[key] = cleanText(value, max);
  }
  return out;
}

/* ── API pública ───────────────────────────────────────────────────────── */

export function activeProvider() {
  if (config.aiProvider === 'gemini' && config.geminiApiKey) return 'gemini';
  if (config.aiProvider === 'openrouter' && config.openrouterApiKey) return 'openrouter';
  return 'mock';
}

export async function summarizeCandidate(candidate, cvText = '') {
  const provider = activeProvider();
  if (provider === 'mock') {
    return { text: mockSummary(candidate, cvText), provider, model: 'demo' };
  }
  const prompt = fillPrompt(loadPrompt(), candidate, cvText);
  const text = await callProvider(prompt, provider);
  if (!text) throw new Error('El proveedor de IA devolvió un resumen vacío.');
  return { text, provider, model: config.aiModel || defaultModel(provider) };
}

/**
 * Lee el CV una sola vez y devuelve los datos de la carátula + el resumen.
 * Si la IA falla o no está configurada, completa con heurísticas locales y
 * deja los avisos para que Yohita sepa qué revisar.
 */
export async function analyzeCv(cvText, { originalName = '' } = {}) {
  const fallback = heuristicFields(cvText, originalName);
  const warnings = [];
  const provider = activeProvider();
  let fieldProvider = 'mock';
  let model = 'demo';
  let fields = { ...fallback };

  if (!cvText) {
    warnings.push('No se pudo leer texto del CV. Revisá que el PDF no sea una imagen escaneada.');
  } else if (provider !== 'mock') {
    try {
      const prompt = loadExtractionPrompt().replace(
        /\{\{cv_text\}\}/g,
        cvText || '(no se pudo extraer texto del CV)',
      );
      const raw = parseJsonObject(await callProvider(prompt, provider));
      fields = { ...fallback, ...normalizeExtractedFields(raw) };
      fieldProvider = provider;
      model = config.aiModel || defaultModel(provider);
    } catch (err) {
      warnings.push(`La IA no pudo leer el CV (${err.message}). Se completó con una lectura básica.`);
    }
  }

  if (!fields.full_name) {
    fields.full_name = nameFromFileName(originalName) || 'Candidato';
    warnings.push('No se detectó el nombre y apellido. Revisalo en “Editar datos”.');
  }
  if (!fields.position) {
    fields.position = 'A definir';
    warnings.push('No se detectó el puesto. Revisalo en “Editar datos”.');
  }

  let summary = '';
  let summaryProvider = 'mock';
  try {
    const result = await summarizeCandidate(fields, cvText);
    summary = result.text;
    summaryProvider = result.provider;
  } catch (err) {
    warnings.push(`No se pudo generar el resumen con IA (${err.message}). Se dejó un borrador editable.`);
    summary = mockSummary(fields, cvText);
  }

  return { fields, summary, provider: fieldProvider, summaryProvider, model, warnings };
}
