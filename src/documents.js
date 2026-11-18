import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { buildCaratulaPdf } from './pdf.js';
import { getCandidate, getRequests, addDocument, latestDocument } from './repo.js';
import { audit } from './db.js';
import { nowIso } from './util.js';

const COVERS_DIR = path.join(config.uploadDir, 'covers');
const SIGNATURES_DIR = path.join(config.uploadDir, 'signatures');
fs.mkdirSync(COVERS_DIR, { recursive: true });
fs.mkdirSync(SIGNATURES_DIR, { recursive: true });

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'candidato';
}

export async function renderCandidatePdf(candidateId, { persist = false, type = 'cover', req = null, event = 'pdf_generated' } = {}) {
  const candidate = getCandidate(candidateId);
  if (!candidate) throw new Error('Candidato inexistente');
  const requests = getRequests(candidateId).map((r) => ({
    id: r.id,
    status: r.effective_status,
    signer: r.signer,
    signature: r.signature
      ? {
          signed_at: r.signature.signed_at,
          document_hash: r.signature.document_hash,
          signature_hash: r.signature.signature_hash,
          signature_image_path: r.signature.signature_image_path,
        }
      : null,
  }));

  const bytes = await buildCaratulaPdf({ candidate, requests, template: config.coverTemplate });
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  let filePath = null;
  if (persist) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    filePath = path.join(COVERS_DIR, `${slugify(candidate.full_name)}-${type}-${candidateId}-${stamp}.pdf`);
    fs.writeFileSync(filePath, bytes);
    addDocument({ candidateId, type, filePath, sha256: hash });
    audit({
      candidateId,
      event,
      detail: `${type} ${hash.slice(0, 16)}`,
      req,
    });
  }

  return { bytes, hash, filePath, candidate };
}

export function saveSignatureImage(requestId, pngBuffer) {
  const filePath = path.join(SIGNATURES_DIR, `firma-request-${requestId}-${Date.now()}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  return filePath;
}

export function signedPdfPath(candidateId) {
  const doc = latestDocument(candidateId, 'cover_signed');
  return doc && fs.existsSync(doc.file_path) ? doc.file_path : null;
}

export function savedSignaturePath(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return null;
  return fs.existsSync(relativeOrAbsolute) ? relativeOrAbsolute : null;
}

export function signedPdfName(candidate) {
  return `caratula-firmada-${slugify(candidate.full_name)}.pdf`;
}

export function unsignedPdfName(candidate) {
  return `caratula-${slugify(candidate.full_name)}.pdf`;
}

export { nowIso };
