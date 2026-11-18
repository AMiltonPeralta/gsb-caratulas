import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { db, verifyAuditChain } from '../src/db.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(config.backupDir, stamp);
const filesDir = path.join(target, 'files');
fs.mkdirSync(filesDir, { recursive: true });

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const dbTarget = path.join(target, 'app.db');
const escaped = dbTarget.replace(/'/g, "''");
db.exec(`VACUUM INTO '${escaped}'`);

if (fs.existsSync(config.uploadDir)) {
  fs.cpSync(config.uploadDir, filesDir, { recursive: true });
}

const files = walk(target)
  .filter((file) => path.basename(file) !== 'manifest.json')
  .map((file) => ({
    path: path.relative(target, file).split(path.sep).join('/'),
    bytes: fs.statSync(file).size,
    sha256: sha256(file),
  }));

const chain = verifyAuditChain();
const manifest = {
  createdAt: new Date().toISOString(),
  app: config.companyName,
  baseUrl: config.baseUrl,
  database: {
    path: 'app.db',
    sha256: sha256(dbTarget),
  },
  files,
  auditChain: chain,
  warning: 'Este respaldo contiene datos personales. Guardalo cifrado y con acceso restringido.',
};

fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
console.log('');
console.log(`Respaldo creado: ${target}`);
console.log(`  Archivos: ${files.length}`);
console.log(`  Tamaño:   ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  Auditoría: ${chain.ok ? 'íntegra' : 'CON PROBLEMAS'} (${chain.checked} eventos)`);
console.log('');
console.log('Guardá esta carpeta cifrada y fuera del servidor. Probalá restaurarla.');
console.log('');
