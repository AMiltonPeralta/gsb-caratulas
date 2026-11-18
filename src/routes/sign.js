import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q, audit } from '../db.js';
import {
  getCandidate,
  getRequestByToken,
  getRequests,
  latestDocument,
} from '../repo.js';
import {
  renderCandidatePdf,
  saveSignatureImage,
  signedPdfName,
  unsignedPdfName,
} from '../documents.js';
import {
  formatDateTime,
  formatDateLong,
  nowIso,
  parseDataUrl,
  requestStatus,
} from '../util.js';
import { summaryHtml, shortHash } from '../format.js';
import { coverFieldValue } from '../config.js';
import { coverView, formatMoney, isDirectorio, matchSignatureBlocks, sourcesOf, GSB_SOURCES } from '../gsb.js';
import { sameOrigin } from '../auth.js';
import { rateLimit, fileHeaders } from '../security.js';

const router = express.Router();
const attempts = new Map();

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
}

router.use('/f', noStore);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function baseData(req, request) {
  const candidate = getCandidate(request.candidate_id);
  const requests = getRequests(request.candidate_id).map((r) => ({
    id: r.id,
    status: r.effective_status,
    signer: r.signer,
    signature: r.signature
      ? {
          id: r.signature.id,
          signed_at: r.signature.signed_at,
          document_hash: r.signature.document_hash,
          signature_hash: r.signature.signature_hash,
          imageUrl: `/f/${request.token}/firma/${r.signature.id}.png`,
          dni: r.signature.dni || r.signer?.dni || null,
        }
      : null,
  }));
  return {
    candidate,
    requests,
    signatureGroups: matchSignatureBlocks(requests),
    gsb: coverView(candidate),
    sources: sourcesOf(candidate),
    photoUrl: candidate.photo_path ? `/f/${request.token}/foto` : null,
    highlightRequestId: request.id,
    GSB_SOURCES,
    formatMoney,
    template: config.coverTemplate,
    company: config.coverTemplate.company || config.companyName,
    request,
    token: request.token,
    expiresLabel: formatDateTime(request.expires_at),
    expiresLong: formatDateLong(request.expires_at),
    baseUrl: config.baseUrl,
    formatDateTime,
    coverFieldValue,
    summaryHtml,
    shortHash,
    interviewData: (() => {
      try {
        return candidate.interview_report_json ? JSON.parse(candidate.interview_report_json) : null;
      } catch {
        return null;
      }
    })(),
    rejection: candidate.rejected_at
      ? {
          at: candidate.rejected_at,
          atLabel: formatDateTime(candidate.rejected_at),
          by: candidate.rejected_by || 'Directorio',
          reason: candidate.rejection_reason || '',
        }
      : null,
    canReject:
      !request.signature &&
      !candidate.rejected_at &&
      !['expired', 'revoked'].includes(request.effective_status),
  };
}

function invalid(res, status, { title, message, code = 'link_no_disponible', candidate = null }) {
  return res.status(status).render('sign/invalid', { title, message, code, candidate, company: config.companyName });
}

/** Los links vencidos o anulados no deben servir para descargar el expediente. */
function linkBlocked(request) {
  if (!request) return true;
  if (request.effective_status === 'revoked') {
    // Si el candidato fue rechazado, el link anulado sigue sirviendo para
    // consultar la carátula y el motivo del rechazo, pero nunca para firmar.
    const candidate = getCandidate(request.candidate_id);
    return !candidate?.rejected_at;
  }
  return request.effective_status === 'expired';
}

function renderSignPage(req, res, request, { rejected = false } = {}) {
  const view = baseData(req, request);
  return res.render('sign/page', {
    ...view,
    signed: Boolean(request.signature),
    rejected: rejected ? view.rejection : null,
    canReject: rejected ? false : view.canReject,
    signedAt: request.signature ? formatDateTime(request.signature.signed_at) : null,
    signatureHash: request.signature ? (request.signature.signature_hash || request.signature.document_hash) : null,
    pageTitle: `${view.candidate.full_name} · Carátula`,
  });
}

router.get('/f/:token', (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (!request) {
      return invalid(res, 404, {
        title: 'Este link no es válido',
        message: 'El link que abriste no existe o fue reemplazado. Pedile a la persona que te lo envió que te comparta uno nuevo.',
        code: 'link_invalido',
      });
    }

    // El rechazo cierra el proceso. El link (aunque haya quedado anulado) sigue
    // mostrando la carátula y el motivo, para que el Directorio tenga la
    // constancia de su decisión.
    const candidate = getCandidate(request.candidate_id);
    if (candidate?.rejected_at) {
      return renderSignPage(req, res, request, { rejected: true });
    }

    const status = request.effective_status;
    if (status === 'revoked') {
      return invalid(res, 410, {
        title: 'Este link fue anulado',
        message: 'La solicitud de firma fue anulada. Si necesitás firmar, pedí un link nuevo.',
        code: 'link_anulado',
      });
    }
    if (status === 'expired') {
      return invalid(res, 410, {
        title: 'Este link venció',
        message: `El link tenía validez hasta el ${formatDateTime(request.expires_at)}. Pedí uno nuevo para poder firmar.`,
        code: 'link_vencido',
      });
    }

    if (!request.first_viewed_at) {
      q.run('UPDATE signature_requests SET first_viewed_at = ?, status = ? WHERE id = ? AND status = ?', nowIso(), 'viewed', request.id, 'pending');
      audit({
        candidateId: request.candidate_id,
        requestId: request.id,
        event: 'link_opened',
        detail: `${request.signer?.name ?? 'Director'} abrió el link`,
        req,
      });
      request.first_viewed_at = nowIso();
      request.status = 'viewed';
    } else {
      audit({ candidateId: request.candidate_id, requestId: request.id, event: 'link_reopened', req });
    }

    return renderSignPage(req, res, request);
  } catch (err) {
    return next(err);
  }
});

router.post('/f/:token/firmar', sameOrigin, rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }), express.json({ limit: '3mb' }), async (req, res, next) => {
  try {
    const token = String(req.params.token).slice(0, 120);
    const key = `${req.ip}:${token.slice(-12)}`;
    const now = Date.now();
    const entry = attempts.get(key) ?? { count: 0, first: now };
    if (now - entry.first > 10 * 60 * 1000) {
      entry.count = 0;
      entry.first = now;
    }
    entry.count += 1;
    attempts.set(key, entry);
    if (entry.count > 20) {
      return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' });
    }

    const request = getRequestByToken(token);
    if (!request) return res.status(404).json({ error: 'Link inválido.' });
    const candidate = getCandidate(request.candidate_id);
    if (candidate?.rejected_at) {
      return res.status(409).json({ error: 'Esta carátula fue rechazada por el Directorio. Ya no se puede firmar.' });
    }
    if (request.effective_status === 'signed') return res.status(409).json({ error: 'Esta carátula ya fue firmada.', alreadySigned: true });
    if (request.effective_status === 'expired') return res.status(410).json({ error: 'El link venció. Pedí uno nuevo.' });
    if (request.effective_status === 'revoked') return res.status(410).json({ error: 'La solicitud fue anulada.' });

    if (req.body?.accepted !== true) {
      return res.status(400).json({ error: 'Tenés que aceptar la declaración de firma.' });
    }

    let dni = cleanText(req.body?.dni, 30).replace(/\D/g, '');
    if (!dni && request.signer?.dni) {
      dni = cleanText(request.signer.dni, 30).replace(/\D/g, '');
    }
    if (!dni) {
      return res.status(400).json({ error: 'El DNI es obligatorio para validar la firma.' });
    }
    if (dni.length !== 8) {
      return res.status(400).json({ error: 'El DNI debe tener exactamente 8 dígitos numéricos.' });
    }

    const png = parseDataUrl(req.body?.signature);
    if (!png) return res.status(400).json({ error: 'La firma no llegó en un formato válido. Probá de nuevo.' });

    if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });
    const imagePath = saveSignatureImage(request.id, png);
    const signedAt = nowIso();
    const userAgent = (req.get('user-agent') ?? '').slice(0, 400);
    const signatureHash = crypto
      .createHash('sha256')
      .update(`caratula-firma-v1|${request.id}|${request.candidate_id}|${request.signer_id}|${signedAt}|${dni}|${req.ip ?? ''}|${userAgent}|`)
      .update(png)
      .digest('hex');

    q.run(
      `INSERT INTO signatures (request_id, signature_image_path, signed_at, ip, user_agent, signature_hash, dni)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      request.id,
      imagePath,
      signedAt,
      req.ip ?? null,
      userAgent,
      signatureHash,
      dni,
    );
    q.run('UPDATE signers SET dni = ? WHERE id = ?', dni, request.signer_id);
    q.run('UPDATE signature_requests SET status = ? WHERE id = ?', 'signed', request.id);

    let hash = null;
    try {
      const rendered = await renderCandidatePdf(request.candidate_id, {
        persist: true,
        type: 'cover_signed',
        req,
        event: 'pdf_signed_generated',
      });
      hash = rendered.hash;
      q.run('UPDATE signatures SET document_hash = ? WHERE request_id = ?', hash, request.id);
    } catch (err) {
      console.error('[firma] no se pudo generar el PDF firmado:', err);
    }

    audit({
      candidateId: request.candidate_id,
      requestId: request.id,
      event: 'signature_created',
      detail: `${request.signer?.name ?? 'Director'} (DNI ${dni}) firmó · firma ${signatureHash.slice(0, 16)}${hash ? ` · pdf ${hash.slice(0, 16)}` : ''}`,
      req,
    });

    const all = getRequests(request.candidate_id);
    if (all.every((r) => r.effective_status === 'signed')) {
      audit({ candidateId: request.candidate_id, requestId: request.id, event: 'candidate_fully_signed', detail: 'Todas las firmas completas', req });
    }

    return res.json({
      ok: true,
      hash,
      signatureHash,
      signedAt,
      signedAtLabel: formatDateTime(signedAt),
      downloadUrl: `/f/${token}/firmado.pdf`,
    });
  } catch (err) {
    return next(err);
  }
});

/*
 * Rechazo del candidato. Sólo lo puede ejecutar el rol Directorio de Casa
 * Central. Cierra el proceso: registra motivo, autor y fecha, anula los links
 * pendientes y conserva las firmas ya emitidas como evidencia.
 */
router.post(
  '/f/:token/rechazar',
  sameOrigin,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }),
  express.json({ limit: '16kb' }),
  async (req, res, next) => {
    try {
      const request = getRequestByToken(String(req.params.token).slice(0, 120));
      if (!request) return res.status(404).json({ error: 'Link inválido.' });

      const candidate = getCandidate(request.candidate_id);
      if (!candidate) return res.status(404).json({ error: 'El expediente no está disponible.' });
      if (candidate.rejected_at) return res.status(409).json({ error: 'El candidato ya fue rechazado.' });
      if (request.signature) {
        return res.status(409).json({
          error: 'Ya firmaste esta carátula. Para dejar constancia del rechazo, escribile a Selección & Desarrollo.',
        });
      }
      if (request.effective_status === 'expired') {
        return res.status(410).json({ error: 'El link venció. Pedí uno nuevo para dejar constancia del rechazo.' });
      }
      if (request.effective_status === 'revoked') {
        return res.status(410).json({ error: 'La solicitud fue anulada.' });
      }

      const reason = String(req.body?.reason ?? '').replace(/\u0000/g, '').trim().slice(0, 500);
      if (reason.length < 5) {
        return res.status(400).json({ error: 'Escribí el motivo del rechazo (al menos 5 caracteres).' });
      }

      const rejectedAt = nowIso();
      const signerRole = request.signer?.role ? ` (${request.signer.role})` : '';
      const rejectedBy = `${request.signer.name}${signerRole}`;
      const update = q.run(
        `UPDATE candidates SET rejected_at = ?, rejected_by = ?, rejection_reason = ?, updated_at = ?
         WHERE id = ? AND rejected_at IS NULL`,
        rejectedAt,
        rejectedBy,
        reason,
        rejectedAt,
        candidate.id,
      );
      if (!update.changes) return res.status(409).json({ error: 'El candidato ya fue rechazado.' });

      // Los links pendientes se anulan. Las firmas ya registradas no se tocan:
      // son evidencia del proceso.
      const revoked = q.run(
        "UPDATE signature_requests SET status = 'revoked' WHERE candidate_id = ? AND status != 'signed'",
        candidate.id,
      );

      audit({
        candidateId: candidate.id,
        requestId: request.id,
        event: 'candidate_rejected',
        detail: `${rejectedBy}: ${reason} · ${revoked.changes} link(s) anulados`,
        req,
      });

      try {
        await renderCandidatePdf(candidate.id, {
          persist: true,
          type: 'cover',
          req,
          event: 'cover_regenerated',
        });
      } catch (err) {
        console.warn('[rechazo] no se pudo regenerar el PDF con el rechazo:', err.message);
      }

      return res.json({ ok: true, rejectedAt, rejectedBy, reason, revoked: revoked.changes });
    } catch (err) {
      return next(err);
    }
  },
);

router.get('/f/:token/foto', (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (linkBlocked(request)) return res.status(410).end();
    const candidate = getCandidate(request.candidate_id);
    if (!candidate?.photo_path || !fs.existsSync(candidate.photo_path)) return res.status(404).end();
    const ext = candidate.photo_path.toLowerCase().split('.').pop();
    fileHeaders(res, { type: ext === 'png' ? 'image/png' : 'image/jpeg' });
    return res.sendFile(candidate.photo_path);
  } catch (err) {
    return next(err);
  }
});

router.get('/f/:token/cv', (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (linkBlocked(request)) return res.status(410).send('Este link ya no está disponible.');
    const candidate = getCandidate(request.candidate_id);
    if (!candidate?.cv_file_path || !fs.existsSync(candidate.cv_file_path)) return res.status(404).send('CV no disponible');
    audit({ candidateId: candidate.id, requestId: request.id, event: 'cv_viewed', req });
    fileHeaders(res, { type: 'application/pdf', disposition: `inline; filename="cv-${candidate.id}.pdf"` });
    return res.sendFile(candidate.cv_file_path);
  } catch (err) {
    return next(err);
  }
});

router.get('/f/:token/caratula.pdf', async (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (linkBlocked(request)) return res.status(410).send('Este link ya no está disponible.');
    const { bytes, hash, candidate } = await renderCandidatePdf(request.candidate_id);
    const disposition = req.query.download ? 'attachment' : 'inline';
    fileHeaders(res, { type: 'application/pdf', disposition: `${disposition}; filename="${unsignedPdfName(candidate)}"` });
    res.set('X-Document-SHA256', hash);
    return res.send(Buffer.from(bytes));
  } catch (err) {
    return next(err);
  }
});

router.get('/f/:token/firmado.pdf', (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (linkBlocked(request)) return res.status(410).send('Este link ya no está disponible.');
    const candidate = getCandidate(request.candidate_id);
    const doc = latestDocument(candidate.id, 'cover_signed');
    if (!doc || !fs.existsSync(doc.file_path)) {
      return res.status(404).send('Todavía no hay un PDF firmado para este candidato.');
    }
    fileHeaders(res, { type: 'application/pdf', disposition: `attachment; filename="${signedPdfName(candidate)}"` });
    if (doc.sha256) res.set('X-Document-SHA256', doc.sha256);
    return res.sendFile(doc.file_path);
  } catch (err) {
    return next(err);
  }
});

router.get('/f/:token/firma/:signatureId.png', (req, res, next) => {
  try {
    const request = getRequestByToken(String(req.params.token).slice(0, 120));
    if (linkBlocked(request)) return res.status(410).end();
    const signature = q.get(
      `SELECT s.* FROM signatures s JOIN signature_requests r ON r.id = s.request_id
       WHERE s.id = ? AND r.candidate_id = ?`,
      Number(req.params.signatureId),
      request.candidate_id,
    );
    if (!signature || !fs.existsSync(signature.signature_image_path)) return res.status(404).end();
    fileHeaders(res, { type: 'image/png' });
    return res.sendFile(signature.signature_image_path);
  } catch (err) {
    return next(err);
  }
});

export default router;
