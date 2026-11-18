/**
 * Repara las rutas absolutas guardadas en la base cuando la carpeta del
 * proyecto se mueve a otra computadora o a otra ruta.
 *
 * La app guarda rutas absolutas de CVs, fotos, firmas y PDFs. Si el proyecto
 * se abre en otra ruta, esos archivos existen pero la base sigue apuntando a
 * la ruta vieja. Este script reemplaza la parte anterior a /uploads/ por la
 * carpeta UPLOAD_DIR actual y verifica que cada archivo exista.
 *
 * Uso:
 *   npm run relocate
 *
 * Es idempotente: si las rutas ya están bien, no cambia nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { q } from '../src/db.js';

function relocate(value) {
  if (!value) return value;
  const original = String(value);
  const normalized = original.replace(/\\/g, '/');
  const marker = '/uploads/';
  const index = normalized.lastIndexOf(marker);

  if (index >= 0) {
    return path.join(config.uploadDir, normalized.slice(index + marker.length));
  }
  if (!path.isAbsolute(original)) {
    return path.join(config.uploadDir, original);
  }
  return original;
}

let changed = 0;
const missing = [];

for (const row of q.all('SELECT id, cv_file_path, photo_path FROM candidates')) {
  const cv = relocate(row.cv_file_path);
  const photo = relocate(row.photo_path);
  if (cv !== row.cv_file_path || photo !== row.photo_path) {
    q.run('UPDATE candidates SET cv_file_path = ?, photo_path = ? WHERE id = ?', cv, photo, row.id);
    changed += 1;
  }
  if (cv && !fs.existsSync(cv)) missing.push(`candidato ${row.id} · CV: ${cv}`);
  if (photo && !fs.existsSync(photo)) missing.push(`candidato ${row.id} · foto: ${photo}`);
}

for (const row of q.all('SELECT id, signature_image_path FROM signatures')) {
  const image = relocate(row.signature_image_path);
  if (image !== row.signature_image_path) {
    q.run('UPDATE signatures SET signature_image_path = ? WHERE id = ?', image, row.id);
    changed += 1;
  }
  if (image && !fs.existsSync(image)) missing.push(`firma ${row.id}: ${image}`);
}

for (const row of q.all('SELECT id, file_path FROM documents')) {
  const file = relocate(row.file_path);
  if (file !== row.file_path) {
    q.run('UPDATE documents SET file_path = ? WHERE id = ?', file, row.id);
    changed += 1;
  }
  if (file && !fs.existsSync(file)) missing.push(`documento ${row.id}: ${file}`);
}

console.log('');
console.log('  Reparación de rutas');
console.log(`  Carpeta de archivos: ${config.uploadDir}`);
console.log(`  Registros actualizados: ${changed}`);
if (missing.length) {
  console.log(`  Archivos que no se encontraron: ${missing.length}`);
  for (const item of missing) console.log(`   · ${item}`);
  console.log('  Revisá que la carpeta data/uploads se haya copiado completa.');
} else {
  console.log('  Todos los archivos referenciados existen.');
}
console.log('');
