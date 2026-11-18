/**
 * Definiciones fijas de la carátula de ingreso de Grúas San Blas (GSB).
 * Se usan en el PDF, en la vista de firma y en el formulario del panel para
 * que los tres lugares muestren exactamente el mismo documento.
 */

export const GSB_COMPANY = 'GRÚAS SAN BLAS';
export const GSB_COMPANY_SUB = 'Selección & Desarrollo · Onboarding Digital';
export const GSB_DOC_TITLE = 'Carátula de Ingreso';
export const GSB_DOC_SUB = 'Aprobación de incorporación · Uso interno';
export const GSB_RED = '#C8102E';

export const GSB_SOURCES = [
  'Base de Datos',
  'Página Web',
  'Portal de Empleo',
  'Pres. Espontánea',
  'Referido',
  'Consultora',
  'Formulario QR',
  'Sucursal',
  'Pasantía',
  'Cesión',
];

export const GSB_BRANCHES = [
  'Añelo',
  'Buenos Aires',
  'Casa Central',
  'Centenario',
  'Chaco',
  'Chaco Resistencia',
  'Comodoro Rivadavia',
  'Córdoba',
  'Entre Ríos',
  'Jujuy',
  'Maquinar',
  'Mendoza',
  'Misiones',
  'Rosario',
  'San Juan',
];

/** Orden y ámbito de los bloques de firma de la carátula. */
export const GSB_SIGNATURE_GROUPS = [
  {
    scope: 'sucursal',
    label: 'Sucursal',
    roles: ['Líder de Sector', 'Coordinador'],
  },
  {
    scope: 'central',
    label: 'Casa Central',
    roles: ['Recursos Humanos', 'Líder de Sector', 'Gerente', 'Directorio'],
  },
];

/** Opciones para el select del panel: "ámbito|rol". */
export const GSB_ROLE_OPTIONS = GSB_SIGNATURE_GROUPS.flatMap((group) =>
  group.roles.map((role) => ({
    value: `${group.scope}|${role}`,
    scope: group.scope,
    scopeLabel: group.label,
    role,
    label: `${group.label} — ${role}`,
  })),
);

export function normalizeRole(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function scopeLabel(scope) {
  return scope === 'sucursal' ? 'Sucursal' : 'Casa Central';
}

/** Sólo el rol Directorio de Casa Central puede rechazar un candidato. */
export function isDirectorio(signer) {
  return (signer?.scope || 'central') === 'central' && normalizeRole(signer?.role) === 'directorio';
}

/** Busca la solicitud que ocupa cada bloque fijo de la carátula. */
export function matchSignatureBlocks(requests = []) {
  const used = new Set();
  const groups = GSB_SIGNATURE_GROUPS.map((group) => ({
    ...group,
    blocks: group.roles.map((role) => {
      const request =
        requests.find(
          (r) =>
            !used.has(r.id) &&
            (r.signer?.scope || 'central') === group.scope &&
            normalizeRole(r.signer?.role) === normalizeRole(role),
        ) ?? null;
      if (request) used.add(request.id);
      return { scope: group.scope, role, request };
    }),
  }));
  return { groups, extras: requests.filter((r) => !used.has(r.id)) };
}

export function parseSources(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(',').map((item) => item.trim());
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? '').trim())
    .filter((item) => GSB_SOURCES.includes(item));
}

export function sourcesOf(candidate) {
  if (!candidate) return [];
  return parseSources(candidate.recruitment_sources ?? candidate.cover_data_json?.recruitment_sources);
}

export function positionTypeLabel(value) {
  if (value === 'nuevo') return 'Puesto nuevo';
  if (value === 'reemplazo') return 'Reemplazo';
  return '';
}

/**
 * Datos mínimos que pide la carátula original antes de generar el PDF.
 * El panel bloquea la creación de links de firma mientras falte alguno.
 */
export function coverCompleteness(candidate) {
  if (!candidate) return { required: [], recommended: [], complete: false };
  const required = [];
  const recommended = [];
  if (!String(candidate.full_name ?? '').trim()) required.push('Postulante (apellido, nombre)');
  if (!String(candidate.branch ?? '').trim()) required.push('Sucursal / Localidad');
  if (!sourcesOf(candidate).length) required.push('Al menos una fuente de reclutamiento');
  if (!['nuevo', 'reemplazo'].includes(candidate.position_type)) required.push('Tipo de puesto (nuevo o reemplazo)');

  if (!String(candidate.age ?? '').trim()) recommended.push('Edad');
  if (!String(candidate.job_function ?? candidate.position ?? '').trim()) recommended.push('Función');
  if (!String(candidate.sector ?? '').trim()) recommended.push('Sector');
  if (!String(candidate.area ?? '').trim()) recommended.push('Área');
  if (!String(candidate.selected_by ?? '').trim()) recommended.push('Seleccionado por');
  if (!String(candidate.direct_leader ?? '').trim()) recommended.push('Líder / Tutor directo');
  if (!String(candidate.gross_salary ?? candidate.salary ?? '').trim()) recommended.push('Sueldo bruto');

  return { required, recommended, complete: required.length === 0 };
}

/** Texto corto para listados y mensajes de WhatsApp. */
export function displayPosition(candidate) {
  return String(candidate?.job_function || candidate?.position || '').trim();
}

function text(value) {
  return String(value ?? '').trim();
}

/**
 * Normaliza los datos del candidato a los campos fijos de la carátula GSB.
 * Lo usan la vista de firma y el PDF para que ambos muestren lo mismo.
 */
export function coverView(candidate) {
  const c = candidate ?? {};
  return {
    full_name: text(c.full_name),
    age: text(c.age),
    branch: text(c.branch),
    selected_by: text(c.selected_by),
    technical_test: text(c.technical_test),
    cultural_fit: text(c.cultural_fit),
    job_function: text(c.job_function || c.position),
    sector: text(c.sector),
    area: text(c.area),
    national_manager: text(c.national_manager),
    branch_manager: text(c.branch_manager),
    direct_leader: text(c.direct_leader),
    sources: sourcesOf(c),
    position_type: text(c.position_type),
    position_type_label: positionTypeLabel(c.position_type),
    replaces_name: text(c.replaces_name),
    agreement_category: text(c.agreement_category),
    gsb_category: text(c.gsb_category),
    schedule: text(c.schedule),
    cct: text(c.cct),
    overtime: text(c.overtime),
    corporate_card: text(c.corporate_card),
    gross_salary: text(c.gross_salary || c.salary),
    net_salary: text(c.net_salary),
    value_added: text(c.value_added),
    observations: text(c.observations),
    summary: text(c.summary_text),
  };
}

/** Formatea importes en pesos sin decimales. Acepta "1500000" o "$ 1.500.000". */
export function formatMoney(value) {
  const raw = text(value);
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits || digits.length > 12) return raw;
  return `$ ${Number(digits).toLocaleString('es-AR')}`;
}
