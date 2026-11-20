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
  // 1. Restauración local inmediata si la base de datos está vacía
  let count = 0;
  try {
    const row = q.get('SELECT COUNT(*) as c FROM candidates');
    count = Number(row?.c || 0);
  } catch {
    count = 0;
  }

  const localBackupFile = path.join(config.root, 'data', 'cloud_backup.json');
  if (fs.existsSync(localBackupFile)) {
    try {
      const localJson = JSON.parse(fs.readFileSync(localBackupFile, 'utf8'));
      const localBackupCount = localJson.candidates?.length || localJson.tables?.candidates?.length || 0;
      if (count === 0 || count < localBackupCount) {
        const restored = importSnapshot(localJson);
        count = restored;
        console.log(`[cloud-sync] Restauración desde backup local: ${restored} candidatos inicializados.`);
      }
    } catch (err) {
      console.warn('[cloud-sync] Error leyendo backup local:', err.message);
    }
  }

  if (!GITHUB_TOKEN) {
    console.log('[cloud-sync] GITHUB_TOKEN no configurado; persistencia remota desactivada.');
    return;
  }

  // 2. Comprobar / descargar la versión más reciente desde GitHub
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${BACKUP_PATH}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'GSB-CloudSync',
        'Accept': 'application/vnd.github.raw'
      }
    });

    if (!res.ok) {
      console.log('[cloud-sync] No se pudo obtener respaldo remoto (Status:', res.status, ').');
      return;
    }

    const jsonStr = await res.text();
    const snapshot = JSON.parse(jsonStr);
    const remoteCandidates = snapshot.candidates?.length || snapshot.tables?.candidates?.length || 0;

    // Si la base local tenía menos candidatos o estaba vacía, aplicamos el snapshot remoto
    if (count < remoteCandidates || count === 0) {
      importSnapshot(snapshot);
      console.log(`[cloud-sync] Sincronización inicial remota completada (${remoteCandidates} candidatos).`);
    } else {
      console.log(`[cloud-sync] Base al día (${count} candidatos locales).`);
    }
  } catch (err) {
    console.warn('[cloud-sync] Aviso al inicializar sync remoto:', err.message);
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

    const candCount = snapshot.candidates?.length || 0;

    // Guardar copia local también
    const localBackupFile = path.join(config.root, 'data', 'cloud_backup.json');
    try {
      fs.writeFileSync(localBackupFile, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch {}

    // Protección crítica: si la base local tiene 0 candidatos, nunca sobreescribir el backup remoto
    if (candCount === 0) {
      console.warn('[cloud-sync] Protección: evitando sobreescribir backup remoto con 0 candidatos.');
      return false;
    }

    const contentB64 = Buffer.from(JSON.stringify(snapshot)).toString('base64');
    const sha = await getRemoteFileSha(BACKUP_PATH);

    const body = {
      message: `respaldo automático [${nowIso()}] · ${candCount} candidatos`,
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
      console.log(`[cloud-sync] Sincronización a la nube OK: ${candCount} candidatos respaldados.`);
      return true;
    } else {
      const errText = await res.text();
      console.warn('[cloud-sync] Error subiendo respaldo a GitHub (HTTP', res.status, '):', errText.slice(0, 150));
      cachedSha = null;
      return false;
    }
  } catch (err) {
    console.warn('[cloud-sync] Error en performCloudSync:', err.message);
    return false;
  }
}
