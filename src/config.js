import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(String(value).toLowerCase());
}

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolvePath(value, fallback) {
  const raw = value?.trim() || fallback;
  return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

function readJSON(relativePath, fallback) {
  const file = resolvePath(relativePath, '');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const coverTemplate = readJSON(env.COVER_TEMPLATE_FILE, null) ?? {
  company: env.COMPANY_NAME || 'GRÚAS SAN BLAS',
  title: 'CARÁTULA DE INGRESO',
  subtitle: 'Aprobación de incorporación · Uso interno',
  accentColor: '#C8102E',
  fields: [],
  summaryTitle: 'ANEXO · RESUMEN DEL CANDIDATO',
  signatureTitle: 'APROBACIONES Y FIRMAS',
  legalText:
    'Documento firmado electrónicamente. La firma electrónica insertada equivale a la firma manuscrita conforme a la Ley 25.506 de Firma Digital de la República Argentina. La integridad del documento puede verificarse con el código SHA-256 indicado al pie y en la constancia de auditoría.',
  footerNote: 'Grúas San Blas · Selección & Desarrollo · Documento de uso interno',
};

const isProduction = env.NODE_ENV === 'production';
const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

export const config = {
  root: ROOT,
  baseUrl,
  port: int(env.PORT, 3000),
  envName: env.NODE_ENV || 'development',
  isProduction,
  adminPassword: env.ADMIN_PASSWORD || (env.ADMIN_PASSWORD_HASH ? '' : 'yohita2026'),
  adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
  adminTotpSecret: env.ADMIN_TOTP_SECRET || '',
  adminName: env.ADMIN_NAME || 'Yohita',
  sessionSecret: env.SESSION_SECRET || 'dev-secret-cambiar',
  tokenTtlHours: int(env.TOKEN_TTL_HOURS, 168),
  timeZone: env.TZ || 'America/Argentina/Buenos_Aires',
  dbPath: resolvePath(env.DB_PATH, 'data/app.db'),
  uploadDir: resolvePath(env.UPLOAD_DIR, 'data/uploads'),
  backupDir: resolvePath(env.BACKUP_DIR, 'backups'),
  aiProvider: (env.AI_PROVIDER || 'mock').toLowerCase(),
  aiModel: env.AI_MODEL || '',
  geminiApiKey: env.GEMINI_API_KEY || '',
  openrouterApiKey: env.OPENROUTER_API_KEY || '',
  aiPromptFile: resolvePath(env.AI_PROMPT_FILE, 'prompts/resumen-candidato.md'),
  aiExtractionPromptFile: resolvePath(env.AI_EXTRACTION_PROMPT_FILE, 'prompts/extraer-datos.md'),
  companyName: env.COMPANY_NAME || coverTemplate.company || 'GRÚAS SAN BLAS',
  coverTemplate,
  whatsapp: {
    token: env.WHATSAPP_CLOUD_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    templateName: env.WHATSAPP_TEMPLATE_NAME || '',
  },
  sessionTtlMs: int(env.SESSION_TTL_HOURS, 12) * 60 * 60 * 1000,
  sessionIdleMs: int(env.SESSION_IDLE_MINUTES, 120) * 60 * 1000,
  forceHttps: bool(env.FORCE_HTTPS, isProduction),
  trustProxy: int(env.TRUST_PROXY, 1),
  allowedHosts: list(env.ALLOWED_HOSTS),
  securityContact: env.SECURITY_CONTACT || '',
};

/** Avisos de configuración. En producción, los críticos impiden arrancar. */
export function securityWarnings() {
  const warnings = [];
  if (!isProduction) warnings.push('Estás en modo desarrollo. Las protecciones de producción (HTTPS obligatorio y cookies Secure) no están activas.');
  if (!config.adminPasswordHash) {
    warnings.push('La clave del panel se compara en texto plano. Generá un hash con «npm run security:hash» y configurá ADMIN_PASSWORD_HASH.');
  }
  if (!config.adminPasswordHash && config.adminPassword === 'yohita2026') {
    warnings.push('La clave del panel es la de demostración. Cambiala antes de publicar.');
  }
  if (config.adminPasswordHash && config.adminPassword) {
    warnings.push('Sigue configurada ADMIN_PASSWORD en texto plano. Borrala y dejá solo ADMIN_PASSWORD_HASH.');
  }
  if (!config.adminTotpSecret) warnings.push('El doble factor (TOTP) está desactivado. Configurá ADMIN_TOTP_SECRET para exigir un código además de la clave.');
  if (!config.baseUrl.startsWith('https://')) warnings.push('BASE_URL no usa HTTPS. Los links de firma y las firmas viajarían sin cifrar.');
  if (!config.forceHttps) warnings.push('FORCE_HTTPS está desactivado: la app no redirige a HTTPS.');
  if (config.sessionSecret === 'dev-secret-cambiar' || config.sessionSecret.length < 32) {
    warnings.push('SESSION_SECRET es débil o tiene el valor de ejemplo.');
  }
  if (!config.allowedHosts.length) warnings.push('ALLOWED_HOSTS está vacío. En producción conviene limitar los dominios aceptados.');
  return warnings;
}

export function assertProductionConfig() {
  if (!isProduction) return;
  const problems = [];
  if (!config.adminPasswordHash && (config.adminPassword === 'yohita2026' || config.adminPassword.length < 12)) {
    problems.push('Configurá ADMIN_PASSWORD_HASH (recomendado) o una ADMIN_PASSWORD de al menos 12 caracteres.');
  }
  if (config.sessionSecret === 'dev-secret-cambiar' || config.sessionSecret.length < 32) {
    problems.push('Configurá un SESSION_SECRET aleatorio de al menos 32 caracteres.');
  }
  if (!config.baseUrl.startsWith('https://')) problems.push('BASE_URL tiene que empezar con https://.');
  if (!config.forceHttps) problems.push('Activá FORCE_HTTPS=true.');
  if (problems.length) {
    console.warn('[config] Avisos de configuración para producción:\n- ' + problems.join('\n- '));
  }
}

export function coverFieldValue(candidate, key) {
  return candidate?.[key] ?? candidate?.cover_data_json?.[key] ?? '';
}
