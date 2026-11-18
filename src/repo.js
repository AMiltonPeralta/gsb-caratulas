import { q, nowIso } from './db.js';
import { safeJson, requestStatus } from './util.js';

export function getCandidate(id) {
  const row = q.get('SELECT * FROM candidates WHERE id = ?', id);
  if (!row) return null;
  return { ...row, cover_data_json: safeJson(row.cover_data_json, {}) };
}

export function listCandidates() {
  return q
    .all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM signature_requests r WHERE r.candidate_id = c.id) AS request_count,
              (SELECT COUNT(*) FROM signature_requests r JOIN signatures s ON s.request_id = r.id WHERE r.candidate_id = c.id) AS signed_count
       FROM candidates c
       ORDER BY c.created_at DESC`,
    )
    .map((row) => ({ ...row, cover_data_json: safeJson(row.cover_data_json, {}) }));
}

export function getRequests(candidateId) {
  return q
    .all(
      `SELECT r.*, s.name AS signer_name, s.role AS signer_role, s.scope AS signer_scope,
              s.phone AS signer_phone, s.email AS signer_email, s.dni AS signer_dni,
              sig.id AS signature_id, sig.signed_at, sig.document_hash, sig.signature_hash, sig.signature_image_path, sig.ip, sig.user_agent, sig.dni AS signature_dni
       FROM signature_requests r
       JOIN signers s ON s.id = r.signer_id
       LEFT JOIN signatures sig ON sig.request_id = r.id
       WHERE r.candidate_id = ?
       ORDER BY r.id ASC`,
      candidateId,
    )
    .map((row) => ({
      ...row,
      effective_status: requestStatus(row),
      signer: { id: row.signer_id, name: row.signer_name, role: row.signer_role, scope: row.signer_scope, phone: row.signer_phone, email: row.signer_email, dni: row.signature_dni || row.signer_dni || null },
      signature: row.signature_id
        ? {
            id: row.signature_id,
            signed_at: row.signed_at,
            document_hash: row.document_hash,
            signature_hash: row.signature_hash,
            signature_image_path: row.signature_image_path,
            ip: row.ip,
            user_agent: row.user_agent,
            dni: row.signature_dni || row.signer_dni || null,
          }
        : null,
    }));
}

export function getRequestByToken(token) {
  const row = q.get(
    `SELECT r.*, c.full_name, c.position, c.summary_text,
            c.rejected_at, c.rejected_by, c.rejection_reason
     FROM signature_requests r JOIN candidates c ON c.id = r.candidate_id
     WHERE r.token = ?`,
    token,
  );
  if (!row) return null;
  const signer = q.get('SELECT * FROM signers WHERE id = ?', row.signer_id);
  const signature = q.get('SELECT * FROM signatures WHERE request_id = ?', row.id);
  return { ...row, signer, signature, effective_status: requestStatus(row) };
}

export function getRequestById(id) {
  return q.get(`SELECT r.*, c.full_name FROM signature_requests r JOIN candidates c ON c.id = r.candidate_id WHERE r.id = ?`, id);
}

export function findExistingRequest(candidateId, signerId) {
  return q.get(
    'SELECT * FROM signature_requests WHERE candidate_id = ? AND signer_id = ? AND status != ? ORDER BY id DESC LIMIT 1',
    candidateId,
    signerId,
    'revoked',
  );
}

export function auditFor(candidateId, limit = 60) {
  return q.all('SELECT * FROM audit_log WHERE candidate_id = ? ORDER BY id DESC LIMIT ?', candidateId, limit);
}

export function addDocument({ candidateId, type, filePath, sha256 }) {
  return q.run(
    'INSERT INTO documents (candidate_id, type, file_path, sha256, created_at) VALUES (?, ?, ?, ?, ?)',
    candidateId,
    type,
    filePath,
    sha256,
    nowIso(),
  );
}

export function latestDocument(candidateId, type) {
  return q.get('SELECT * FROM documents WHERE candidate_id = ? AND type = ? ORDER BY id DESC LIMIT 1', candidateId, type);
}

/**
 * Borra un expediente sin firmas y devuelve los archivos a eliminar del disco.
 * La auditoría NO se borra: es la constancia de que el borrado existió.
 */
export function deleteCandidate(id) {
  const candidate = getCandidate(id);
  if (!candidate) return null;

  const requests = getRequests(id);
  if (requests.some((r) => r.signature)) {
    return { blocked: true, candidate, requests: requests.length };
  }

  const documents = q.all('SELECT file_path FROM documents WHERE candidate_id = ?', id);
  const files = new Set();
  if (candidate.cv_file_path) files.add(candidate.cv_file_path);
  if (candidate.photo_path) files.add(candidate.photo_path);
  for (const d of documents) if (d.file_path) files.add(d.file_path);

  const signerIds = q.all('SELECT DISTINCT signer_id FROM signature_requests WHERE candidate_id = ?', id).map((r) => r.signer_id);

  q.exec('BEGIN IMMEDIATE');
  try {
    q.run('DELETE FROM signature_requests WHERE candidate_id = ?', id);
    for (const signerId of signerIds) {
      const still = q.get('SELECT COUNT(*) AS n FROM signature_requests WHERE signer_id = ?', signerId);
      if (!still?.n) q.run('DELETE FROM signers WHERE id = ?', signerId);
    }
    q.run('DELETE FROM documents WHERE candidate_id = ?', id);
    q.run('DELETE FROM candidates WHERE id = ?', id);
    q.exec('COMMIT');
  } catch (err) {
    q.exec('ROLLBACK');
    throw err;
  }

  return { blocked: false, candidate, requests: requests.length, documents: documents.length, files: [...files] };
}

export function deleteAllCandidates({ force = false } = {}) {
  const candidates = q.all('SELECT id FROM candidates');
  const deleted = [];
  const blocked = [];
  const allFiles = new Set();

  for (const c of candidates) {
    const candidate = getCandidate(c.id);
    if (!candidate) continue;
    const requests = getRequests(c.id);
    const hasSignature = requests.some((r) => r.signature);

    if (hasSignature && !force) {
      blocked.push({ id: c.id, full_name: candidate.full_name });
      continue;
    }

    const documents = q.all('SELECT file_path FROM documents WHERE candidate_id = ?', c.id);
    if (candidate.cv_file_path) allFiles.add(candidate.cv_file_path);
    if (candidate.photo_path) allFiles.add(candidate.photo_path);
    for (const d of documents) if (d.file_path) allFiles.add(d.file_path);

    const signatures = q.all(
      'SELECT s.signature_image_path FROM signatures s JOIN signature_requests r ON r.id = s.request_id WHERE r.candidate_id = ?',
      c.id,
    );
    for (const s of signatures) if (s.signature_image_path) allFiles.add(s.signature_image_path);

    deleted.push({ id: c.id, full_name: candidate.full_name });
  }

  if (deleted.length > 0) {
    const ids = deleted.map((d) => d.id);
    const inClause = ids.map(() => '?').join(',');

    q.exec('BEGIN IMMEDIATE');
    try {
      q.run(`DELETE FROM signatures WHERE request_id IN (SELECT id FROM signature_requests WHERE candidate_id IN (${inClause}))`, ...ids);
      q.run(`DELETE FROM signature_requests WHERE candidate_id IN (${inClause})`, ...ids);
      q.run(`DELETE FROM documents WHERE candidate_id IN (${inClause})`, ...ids);
      q.run(`DELETE FROM candidates WHERE id IN (${inClause})`, ...ids);
      q.run('DELETE FROM signers WHERE id NOT IN (SELECT signer_id FROM signature_requests)');
      q.exec('COMMIT');
    } catch (err) {
      q.exec('ROLLBACK');
      throw err;
    }
  }

  return { deleted, blocked, files: [...allFiles] };
}
