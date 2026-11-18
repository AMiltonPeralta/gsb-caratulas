import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { db, q, verifyAuditChain } from '../src/db.js';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const problems = [];
let checked = 0;

const integrity = db.prepare('PRAGMA integrity_check').get();
const integrityValue = Object.values(integrity ?? {})[0];
if (integrityValue !== 'ok') problems.push(`SQLite integrity_check: ${integrityValue}`);
else checked += 1;

const chain = verifyAuditChain();
if (!chain.ok) problems.push(`Auditoría: evento ${chain.brokenAt} — ${chain.reason}`);
else checked += 1;

const documents = q.all('SELECT * FROM documents ORDER BY id ASC');
for (const doc of documents) {
  if (!fs.existsSync(doc.file_path)) {
    problems.push(`Documento ${doc.id}: falta el archivo ${doc.file_path}`);
    continue;
  }
  const actual = sha256(doc.file_path);
  if (doc.sha256 && actual !== doc.sha256) {
    problems.push(`Documento ${doc.id}: el hash no coincide (posible alteración).`);
  }
  checked += 1;
}

const signatures = q.all('SELECT * FROM signatures ORDER BY id ASC');
for (const signature of signatures) {
  if (!fs.existsSync(signature.signature_image_path)) {
    problems.push(`Firma ${signature.id}: falta la imagen ${signature.signature_image_path}`);
  }
  checked += 1;
}

if (config.uploadDir && fs.existsSync(config.uploadDir)) checked += 1;

console.log('');
console.log('Verificación de integridad');
console.log(`  Base:      ${config.dbPath}`);
console.log(`  Documentos: ${documents.length}`);
console.log(`  Firmas:     ${signatures.length}`);
console.log(`  Eventos:    ${chain.checked}`);
console.log('');

if (problems.length) {
  console.error('Se encontraron problemas:');
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error('');
  console.error('Restaurá desde un respaldo y revisá quién tuvo acceso al servidor.');
  process.exit(1);
}

console.log(`OK: ${checked} comprobaciones pasaron. La base, los documentos y la auditoría están íntegros.`);
console.log('');
