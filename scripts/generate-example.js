import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { buildCaratulaPdf } from '../src/pdf.js';
import { buildSampleCvPdf, demoCandidate, makeSignaturePng, makeAvatarPng } from './lib/sample.js';

const outDir = path.join(config.root, 'ejemplos');
fs.mkdirSync(outDir, { recursive: true });

const cvPath = path.join(outDir, 'cv-ejemplo.pdf');
fs.writeFileSync(cvPath, await buildSampleCvPdf());

const signaturePath = path.join(outDir, 'firma-ejemplo.png');
fs.writeFileSync(signaturePath, makeSignaturePng());

const photoPath = path.join(outDir, 'foto-ejemplo.png');
fs.writeFileSync(photoPath, makeAvatarPng());

const candidate = { ...demoCandidate, cv_file_path: cvPath, photo_path: photoPath };

const requests = [
  {
    id: 1,
    status: 'signed',
    signer: { name: 'Martín Sosa', role: 'Gerente', scope: 'central' },
    signature: {
      signed_at: '2026-10-30T13:42:00.000Z',
      document_hash: crypto.createHash('sha256').update('demo-documento-1').digest('hex'),
      signature_hash: crypto.createHash('sha256').update('demo-firma-1').digest('hex'),
      signature_image_path: signaturePath,
    },
  },
  {
    id: 2,
    status: 'signed',
    signer: { name: 'Carolina Pérez', role: 'Recursos Humanos', scope: 'central' },
    signature: {
      signed_at: '2026-10-30T14:05:00.000Z',
      document_hash: crypto.createHash('sha256').update('demo-documento-2').digest('hex'),
      signature_hash: crypto.createHash('sha256').update('demo-firma-2').digest('hex'),
      signature_image_path: signaturePath,
    },
  },
];

const unsigned = await buildCaratulaPdf({ candidate, requests: requests.map((r) => ({ ...r, signature: null })) });
const signed = await buildCaratulaPdf({ candidate, requests });

const unsignedPath = path.join(outDir, 'caratula-ejemplo.pdf');
const signedPath = path.join(outDir, 'caratula-ejemplo-firmada.pdf');
fs.writeFileSync(unsignedPath, unsigned);
fs.writeFileSync(signedPath, signed);

const sha = crypto.createHash('sha256').update(signed).digest('hex');
console.log('');
console.log('  Ejemplos generados en /ejemplos:');
console.log('  · caratula-ejemplo.pdf          (sin firmas)');
console.log('  · caratula-ejemplo-firmada.pdf  (con dos firmas)');
console.log('  · cv-ejemplo.pdf                (CV de muestra)');
console.log('  · firma-ejemplo.png             (trazo de firma)');
console.log('  · foto-ejemplo.png              (foto de ingreso de muestra)');
console.log('');
console.log('  SHA-256 del PDF firmado: ' + sha);
console.log('');
