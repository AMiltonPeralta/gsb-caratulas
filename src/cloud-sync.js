import fs from 'node:fs';
import path from 'node:path';
import { q, nowIso } from './db.js';
import { config } from './config.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'AMiltonPeralta/gsb-caratulas';
const BACKUP_PATH = 'data/cloud_backup.json';

let syncTimer = null;
let cachedSha = null;

/**
 * Obtiene el SHA actual del archivo en GitHub para poder actualizarlo.
 */
async function getRemoteFileSha(filePath) {
  if (cachedSha) return cachedSha;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'GSB-CloudSync',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.ok) {
      const data = await res.json();
      cachedSha = data.sha;
      return data.sha;
    }
  } catch (err) {
    console.warn('[cloud-sync] Error consultando SHA remoto:', err.message);
  }
  return null;
}

/**
 * Genera un volcado completo y fiel de todas las tablas de la base de datos en JSON.
 */
export function exportSnapshot() {
  try {
    const tables = ['users', 'candidates', 'signers', 'signature_requests', 'signatures', 'documents', 'audit_log'];
    const snapshot = {
      version: 2,
      exported_at: nowIso(),
      tables: {}
    };

    for (const table of tables) {
      try {
        snapshot.tables[table] = q.all(`SELECT * FROM ${table}`);
      } catch (e) {
        snapshot.tables[table] = [];
      }
    }

    // Compatibilidad retroactiva
    snapshot.candidates = snapshot.tables.candidates || [];
    snapshot.users = snapshot.tables.users || [];
    snapshot.signers = snapshot.tables.signers || [];
    snapshot.signatures = snapshot.tables.signatures || [];

    return snapshot;
  } catch (err) {
    console.warn('[cloud-sync] No se pudo exportar snapshot:', err.message);
    return null;
  }
}

/**
 * Restaura un snapshot JSON en las tablas de SQLite con inserción genérica por columnas.
 */
export function importSnapshot(snapshot) {
  if (!snapshot) return 0;

  const tablesData = snapshot.tables || {
    users: snapshot.users,
    candidates: snapshot.candidates,
    signers: snapshot.signers,
    signature_requests: snapshot.signature_requests,
    signatures: snapshot.signatures,
    documents: snapshot.documents,
    audit_log: snapshot.audit_log
  };

  const importOrder = ['users', 'candidates', 'signers', 'signature_requests', 'signatures', 'documents', 'audit_log'];

  q.exec('PRAGMA foreign_keys = OFF');
  q.exec('BEGIN TRANSACTION');
  let candidateCount = 0;
  try {
    for (const table of importOrder) {
      const rows = tablesData[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      for (const row of rows) {
        const keys = Object.keys(row);
        if (keys.length === 0) continue;
        const placeholders = keys.map(() => '?').join(',');
        const values = keys.map(k => row[k]);
        q.run(
          `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
          ...values
        );
      }
      if (table === 'candidates') candidateCount = rows.length;
    }
    q.exec('COMMIT');
    q.exec('PRAGMA foreign_keys = ON');
    console.log(`[cloud-sync] Snapshot restaurado con éxito: ${candidateCount} candidatos recuperados.`);
    return candidateCount;
  } catch (err) {
    q.exec('ROLLBACK');
    q.exec('PRAGMA foreign_keys = ON');
    console.error('[cloud-sync] Error aplicando snapshot:', err);
    return 0;
  }
}

/**
 * Se ejecuta al iniciar el servidor:
 * Si la base de datos local está vacía o recién inicializada (como ocurre en Render free tier),
 * descarga automáticamente el respaldo persistente desde GitHub para recuperar todos los datos de Yohita.
 */
export async function initCloudSync() {
  if (!GITHUB_TOKEN) {
    console.log('[cloud-sync] GITHUB_TOKEN no configurado; persistencia en la nube desactivada.');
    return;
  }

  try {
    // Verificamos si la base local tiene candidatos
    let count = 0;
    try {
      const row = q.get('SELECT COUNT(*) as c FROM candidates');
      count = Number(row?.c || 0);
    } catch {
      count = 0;
    }

    if (count > 0) {
      console.log(`[cloud-sync] Base local existente con ${count} candidatos. Listo.`);
      return;
    }

    console.log('[cloud-sync] Base local vacía (posible reinicio de Render). Descargando respaldo persistente desde GitHub...');
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_PATH}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'GSB-CloudSync',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!res.ok) {
      console.log('[cloud-sync] No se encontró respaldo previo en GitHub o repo nuevo (Status:', res.status, ').');
      return;
    }

    const fileData = await res.json();
    cachedSha = fileData.sha;
    const jsonStr = Buffer.from(fileData.content, 'base64').toString('utf8');
    const snapshot = JSON.parse(jsonStr);
    importSnapshot(snapshot);
  } catch (err) {
    console.warn('[cloud-sync] Aviso al inicializar sync:', err.message);
  }
}

/**
 * Programa una sincronización con GitHub (con debounce de 2 segundos)
 * para no saturar la API si se hacen múltiples cambios seguidos.
 */
export function scheduleCloudSync() {
  if (!GITHUB_TOKEN) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    await performCloudSync();
  }, 2000);
}

/**
 * Realiza la subida inmediata del snapshot a GitHub.
 */
export async function performCloudSync() {
  if (!GITHUB_TOKEN) return false;
  try {
    const snapshot = exportSnapshot();
    if (!snapshot) return false;

    // Guardar copia local también
    const localBackupFile = path.join(config.root, 'data', 'cloud_backup.json');
    try {
      fs.writeFileSync(localBackupFile, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch {}

    const contentB64 = Buffer.from(JSON.stringify(snapshot)).toString('base64');
    const sha = await getRemoteFileSha(BACKUP_PATH);

    const body = {
      message: `respaldo automático [${nowIso()}] · ${snapshot.candidates?.length || 0} candidatos`,
      content: contentB64,
      ...(sha ? { sha } : {})
    };

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'GSB-CloudSync',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const data = await res.json();
      cachedSha = data.content?.sha || null;
      console.log(`[cloud-sync] Sincronización a la nube OK: ${snapshot.candidates?.length || 0} candidatos respaldados.`);
      return true;
    } else {
      const errText = await res.text();
      console.warn('[cloud-sync] Error subiendo respaldo a GitHub (HTTP', res.status, '):', errText.slice(0, 150));
      cachedSha = null; // invalidar para pedir SHA fresco la próxima
      return false;
    }
  } catch (err) {
    console.warn('[cloud-sync] Error en performCloudSync:', err.message);
    return false;
  }
}
