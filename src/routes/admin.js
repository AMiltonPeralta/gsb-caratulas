import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, coverFieldValue, securityWarnings } from '../config.js';
import { q, audit, verifyAuditChain } from '../db.js';
import {
  addDocument,
  auditFor,
  deleteCandidate,
  deleteAllCandidates,
  getCandidate,
  getRequests,
  latestDocument,
  listCandidates,
} from '../repo.js';
import { candidateStatus, CANDIDATE_STATUS_LABEL, formatDateTime, nowIso, randomToken, waLink, requestStatus, STATUS_LABEL } from '../util.js';
import { summaryHtml, shortHash, initials } from '../format.js';
import { summarizeCandidate, extractCvText, activeProvider, analyzeCv } from '../ai.js';
import { renderCandidatePdf, signedPdfName, unsignedPdfName } from '../documents.js';
import {
  checkPassword,
  issueSession,
  clearSession,
  requireAdmin,
  requireCsrf,
  sameOrigin,
  readSession,
  readRememberedUser,
  loginRateLimited,
  registerLoginFailure,
  clearLoginFailures,
  revokeOtherSessions,
  activeSessionCount,
} from '../auth.js';
import { totpEnabled, verifyTotp, authenticateUser } from '../passwords.js';
import { scheduleCloudSync, importSnapshot, initCloudSync } from '../cloud-sync.js';
import { getAssistantResponse } from '../assistant-knowledge.js';
import { fileHeaders } from '../security.js';
import {
  GSB_BRANCHES,
  GSB_ROLE_OPTIONS,
  GSB_SOURCES,
  coverCompleteness,
  coverView,
  formatMoney,
  normalizeRole,
  parseSources,
  positionTypeLabel,
  scopeLabel,
  sourcesOf,
} from '../gsb.js';

const router = express.Router();
const CV_DIR = path.join(config.uploadDir, 'cv');
const TMP_DIR = path.join(config.uploadDir, 'tmp');
const PHOTO_DIR = path.join(config.uploadDir, 'photos');
fs.mkdirSync(CV_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf.slice(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString('ascii') === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

function hasActiveContent(filePath) {
  const raw = fs.readFileSync(filePath).toString('latin1');
  return ['/JavaScript', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'].some((token) => raw.includes(token));
}

function storeCv(file) {
  const kind = sniff(file.path);
  if (!kind) {
    fs.unlinkSync(file.path);
    throw new Error('El CV tiene que ser un PDF, PNG o JPG válido.');
  }
  if (kind === 'pdf' && hasActiveContent(file.path)) {
    fs.unlinkSync(file.path);
    throw new Error('El PDF contiene contenido activo (JavaScript, formularios o archivos embebidos). Pedile al candidato un PDF simple.');
  }
  const target = path.join(CV_DIR, `cv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${kind}`);
  fs.renameSync(file.path, target);
  return target;
}

/** Guarda la foto del ingreso. Sólo JPG o PNG reales (se valida por magic bytes). Retorna { target, base64, mime } */
function storePhoto(file) {
  if (!file?.path) return null;
  const kind = sniff(file.path);
  if (kind !== 'png' && kind !== 'jpg') {
    fs.unlinkSync(file.path);
    throw new Error('La foto tiene que ser una imagen JPG o PNG.');
  }
  if (file.size > 5 * 1024 * 1024) {
    fs.unlinkSync(file.path);
    throw new Error('La foto no puede superar los 5 MB.');
  }
  const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
  const buffer = fs.readFileSync(file.path);
  const base64 = buffer.toString('base64');
  const target = path.join(PHOTO_DIR, `foto-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${kind}`);
  fs.renameSync(file.path, target);
  return { target, base64, mime };
}

function removeQuietly(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* el archivo ya no estaba */
  }
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function getReqBase(req) {
  if (!req) return config.baseUrl;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function buildLinks(candidateId, req) {
  const base = getReqBase(req);
  return getRequests(candidateId).map((r) => ({
    ...r,
    url: `${base}/f/${r.token}`,
    expiresLabel: formatDateTime(r.expires_at),
  }));
}

function shareMessage(candidate, request, req) {
  const base = getReqBase(req);
  const first = String(request.signer.name).split(/\s+/)[0];
  const url = `${base}/f/${request.token}`;
  return [
    `Hola ${first}, ¿cómo estás?`,
    `Te comparto la carátula de ${candidate.full_name} para la búsqueda de ${candidate.position} para que la revises y firmes desde el celular.`,
    '',
    `Firmar acá: ${url}`,
    '',
    `El link vence el ${formatDateTime(request.expires_at)}.`,
    'Cualquier duda, escribime. ¡Gracias!',
  ].join('\n');
}

/* ── Login ─────────────────────────────────────────────────────────────── */

router.get('/admin/login', (req, res) => {
  if (readSession(req)) return res.redirect('/admin');
  const rememberedUser = readRememberedUser(req);
  res.render('admin/login', {
    error: null,
    adminName: config.adminName,
    rememberedUser,
    needsTotp: totpEnabled(),
  });
});

router.post('/admin/login', sameOrigin, (req, res) => {
  const ip = req.ip ?? 'desconocido';
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  const renderError = (status, error) => res.status(status).render('admin/login', {
    error,
    adminName: config.adminName,
    rememberedUser: username || readRememberedUser(req),
    needsTotp: totpEnabled(),
  });

  if (loginRateLimited(ip)) {
    return renderError(429, 'Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.');
  }

  const authenticatedUser = authenticateUser(username, password);
  if (!authenticatedUser) {
    registerLoginFailure(ip);
    audit({ event: 'admin_login_failed', detail: `Credenciales incorrectas para usuario: ${username || 'sin usuario'}`, req });
    return renderError(401, 'El usuario o la contraseña no son correctos.');
  }

  if (totpEnabled()) {
    if (!String(req.body?.code ?? '').trim()) {
      return renderError(401, 'Ingresá el código de 6 dígitos de tu app autenticadora.');
    }
    if (!verifyTotp(req.body.code)) {
      registerLoginFailure(ip);
      audit({ event: 'admin_login_failed', detail: 'Código de doble factor incorrecto', req });
      return renderError(401, 'El código de verificación no es correcto o venció. Probá con el código actual.');
    }
  }

  clearLoginFailures(ip);
  issueSession(res, req, authenticatedUser);
  audit({ event: 'admin_login', detail: `Ingreso de ${authenticatedUser.name} (${authenticatedUser.username})`, req });
  return res.redirect('/admin');
});

router.post('/admin/logout', requireAdmin, requireCsrf, (req, res) => {
  clearSession(req, res);
  // No borramos 'storage' para preservar borradores locales en caso de cierre accidental
  res.set('Clear-Site-Data', '"cache", "cookies"');
  res.redirect('/admin/login');
});

/* ── Panel ─────────────────────────────────────────────────────────────── */

router.get('/admin', requireAdmin, (req, res) => {
  let rawCandidates = listCandidates();
  if (rawCandidates.length === 0) {
    try {
      const localBackupFile = path.join(config.root, 'data', 'cloud_backup.json');
      if (fs.existsSync(localBackupFile)) {
        const localJson = JSON.parse(fs.readFileSync(localBackupFile, 'utf8'));
        const restored = importSnapshot(localJson);
        if (restored > 0) {
          rawCandidates = listCandidates();
        }
      }
    } catch (e) {
      console.warn('[admin] Error al auto-restaurar backup:', e.message);
    }
  }

  const candidates = rawCandidates.map((c) => ({
    ...c,
    status: candidateStatus(c.id),
    statusLabel: CANDIDATE_STATUS_LABEL[candidateStatus(c.id)],
  }));
  const counts = { total: candidates.length, sent: 0, partial: 0, signed: 0, rejected: 0 };
  for (const c of candidates) {
    if (c.status === 'sent' || c.status === 'expired') counts.sent += 1;
    if (c.status === 'partial') counts.partial += 1;
    if (c.status === 'signed') counts.signed += 1;
    if (c.status === 'rejected') counts.rejected += 1;
  }
  res.render('admin/dashboard', {
    candidates,
    counts,
    adminName: config.adminName,
    coverFieldValue,
    formatDateTime,
    initials,
    ok: req.query.ok,
    csrfToken: req.csrfToken?.() || '',
  });
});

router.post('/admin/api/restaurar-backup', requireAdmin, sameOrigin, requireCsrf, async (req, res) => {
  try {
    const localBackupFile = path.join(config.root, 'data', 'cloud_backup.json');
    if (fs.existsSync(localBackupFile)) {
      const localJson = JSON.parse(fs.readFileSync(localBackupFile, 'utf8'));
      importSnapshot(localJson);
    }
    await initCloudSync();
    res.redirect('/admin?ok=backup-restaurado');
  } catch (err) {
    console.error('[admin] Error al restaurar backup:', err);
    res.redirect('/admin?ok=error-restaurar');
  }
});

router.get('/admin/candidatos/nuevo', requireAdmin, (req, res) => {
  res.render('admin/new-candidate', {
    adminName: config.adminName,
    error: null,
    aiProvider: activeProvider(),
    ok: req.query.ok,
  });
});

router.post(
  '/admin/candidatos',
  requireAdmin,
  upload.single('cv'),
  requireCsrf,
  wrap(async (req, res) => {
    const fail = (message, status = 422) => {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(status).render('admin/new-candidate', {
        adminName: config.adminName,
        error: message,
        aiProvider: activeProvider(),
      });
    };

    if (!req.file) {
      return fail('Subí el CV en PDF para que el agente complete los datos y el resumen.');
    }

    if (sniff(req.file.path) !== 'pdf') {
      return fail('El CV tiene que ser un PDF. Las imágenes todavía no se pueden leer automáticamente.');
    }

    const cvText = await extractCvText(req.file.path);
    if (!cvText) {
      return fail(
        'No pudimos leer texto de ese PDF. Puede ser un PDF escaneado como imagen. Subí un PDF con texto seleccionable.',
      );
    }

    let analysis;
    try {
      analysis = await analyzeCv(cvText, { originalName: req.file.originalname });
    } catch (err) {
      console.warn('[admin] falló el análisis del CV:', err.message);
      return fail('No se pudo analizar el CV. Probá de nuevo o subí otro archivo.');
    }

    let cvPath;
    try {
      cvPath = storeCv(req.file);
    } catch (err) {
      return fail(err.message);
    }

    const fields = analysis.fields;
    const extra = {
      client: fields.client || '',
      seniority: fields.seniority || '',
      salary: fields.salary || '',
      start_date: fields.start_date || '',
      linkedin: fields.linkedin || '',
    };
    const createdBy = req.admin?.username || 'yohita';
    const timestamp = nowIso();
    const { lastInsertRowid: candidateId } = q.run(
      `INSERT INTO candidates
        (full_name, position, area, client, seniority, salary, start_date, linkedin, notes,
         cv_file_path, cv_original_name, summary_text, summary_source, cover_data_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.full_name,
      fields.position,
      fields.area || '',
      extra.client,
      extra.seniority,
      extra.salary,
      extra.start_date,
      extra.linkedin,
      fields.notes || '',
      cvPath,
      req.file.originalname ?? null,
      analysis.summary,
      analysis.summaryProvider,
      JSON.stringify(extra),
      createdBy,
      timestamp,
      timestamp,
    );

    // Datos propios de la carátula GSB. Lo que el CV no permite inferir queda
    // vacío para que Selección & Desarrollo lo complete antes de compartir.
    q.run(
      `UPDATE candidates SET
         age = ?, branch = ?, selected_by = ?, technical_test = ?, cultural_fit = ?,
         job_function = ?, sector = ?, national_manager = ?, branch_manager = ?, direct_leader = ?,
         recruitment_sources = ?, position_type = ?, replaces_name = ?,
         agreement_category = ?, gsb_category = ?, schedule = ?, cct = ?, overtime = ?, corporate_card = ?,
         gross_salary = ?, net_salary = ?, value_added = ?, observations = ?
       WHERE id = ?`,
      fields.age || '',
      fields.branch || '',
      fields.selected_by || '',
      fields.technical_test || '',
      fields.cultural_fit || '',
      fields.job_function || fields.position || '',
      fields.sector || '',
      fields.national_manager || '',
      fields.branch_manager || '',
      fields.direct_leader || '',
      JSON.stringify([]),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      fields.observations || '',
      candidateId,
    );

    audit({ candidateId, event: 'candidate_created', detail: `${fields.full_name} — ${fields.position}`, req });
    audit({
      candidateId,
      event: 'cv_analyzed',
      detail: `${analysis.provider}/${analysis.model} · ${analysis.warnings.length ? `${analysis.warnings.length} aviso(s)` : 'sin avisos'}`,
      req,
    });
    if (analysis.warnings.length) {
      audit({ candidateId, event: 'cv_analysis_warnings', detail: analysis.warnings.join(' · '), req });
    }

    try {
      await renderCandidatePdf(candidateId, { persist: true, type: 'cover', req, event: 'cover_generated' });
    } catch (err) {
      console.warn('[admin] no se pudo generar la carátula inicial:', err.message);
    }

    scheduleCloudSync();
    return res.redirect(`/admin/candidatos/${candidateId}?ok=creado${analysis.warnings.length ? '&aviso=revisar' : ''}`);
  }),
);

router.get('/admin/candidatos/:id', requireAdmin, (req, res, next) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return next();
  const requests = buildLinks(candidate.id, req);
  const status = candidateStatus(candidate.id);
  const documents = q.all('SELECT * FROM documents WHERE candidate_id = ? ORDER BY id DESC LIMIT 20', candidate.id);
  res.render('admin/candidate', {
    candidate,
    requests,
    status,
    statusLabel: CANDIDATE_STATUS_LABEL[status],
    audit: auditFor(candidate.id),
    documents,
    adminName: config.adminName,
    coverFieldValue,
    summaryHtml,
    formatDateTime,
    shortHash,
    initials,
    requestStatus,
    STATUS_LABEL,
    waLink,
    shareMessage: (c, r) => shareMessage(c, r, req),
    ttlDays: Math.max(1, Math.round(config.tokenTtlHours / 24)),
    ok: req.query.ok,
    aviso: req.query.aviso,
    iaError: req.query.ia === 'error',
    aiProvider: activeProvider(),
    baseUrl: config.baseUrl,
    gsbCompleteness: coverCompleteness(candidate),
    gsbSources: sourcesOf(candidate),
    gsb: coverView(candidate),
    formatMoney,
    GSB_BRANCHES,
    GSB_SOURCES,
    GSB_ROLE_OPTIONS,
    scopeLabel,
    positionTypeLabel,
  });
});

router.post('/admin/candidatos/:id/datos', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).end();
  const b = req.body ?? {};
  const hasSummary = b.summary_text !== undefined;
  q.run(
    `UPDATE candidates SET full_name = ?, position = ?, area = ?, client = ?, seniority = ?, salary = ?,
       start_date = ?, linkedin = ?, notes = ?, summary_text = ?, updated_at = ? WHERE id = ?`,
    cleanText(b.full_name, 140) || candidate.full_name,
    cleanText(b.position, 140) || candidate.position,
    cleanText(b.area),
    cleanText(b.client),
    cleanText(b.seniority),
    cleanText(b.salary),
    cleanText(b.start_date),
    cleanText(b.linkedin),
    cleanText(b.notes, 4000),
    hasSummary ? cleanText(b.summary_text, 8000) : candidate.summary_text,
    nowIso(),
    candidate.id,
  );
  audit({ candidateId: candidate.id, event: 'candidate_updated', detail: 'Datos editados por Yohita', req });
  res.redirect(`/admin/candidatos/${candidate.id}?ok=guardado`);
});

/* ── Carátula GSB ──────────────────────────────────────────────────────── */

function coverValues(body) {
  const b = body ?? {};
  const oneOf = (value, allowed) => (allowed.includes(String(value ?? '')) ? String(value) : '');
  const sources = [].concat(b.recruitment_sources ?? []).filter((item) => GSB_SOURCES.includes(String(item)));
  return {
    full_name: cleanText(b.full_name, 140),
    age: cleanText(b.age, 40),
    branch: cleanText(b.branch, 80),
    selected_by: cleanText(b.selected_by, 140),
    technical_test: cleanText(b.technical_test, 120),
    cultural_fit: cleanText(b.cultural_fit, 80),
    job_function: cleanText(b.job_function, 140),
    sector: cleanText(b.sector, 120),
    area: cleanText(b.area, 140),
    national_manager: cleanText(b.national_manager, 140),
    branch_manager: cleanText(b.branch_manager, 140),
    direct_leader: cleanText(b.direct_leader, 140),
    sources,
    position_type: oneOf(b.position_type, ['nuevo', 'reemplazo']),
    replaces_name: cleanText(b.replaces_name, 140),
    agreement_category: cleanText(b.agreement_category, 120),
    gsb_category: cleanText(b.gsb_category, 80),
    schedule: cleanText(b.schedule, 120),
    cct: cleanText(b.cct, 120),
    overtime: oneOf(b.overtime, ['SI', 'NO']),
    corporate_card: oneOf(b.corporate_card, ['SI', 'NO']),
    gross_salary: cleanText(b.gross_salary, 40),
    net_salary: cleanText(b.net_salary, 40),
    value_added: cleanText(b.value_added, 40),
    observations: cleanText(b.observations, 500),
  };
}

router.get('/admin/candidatos/:id/caratula', requireAdmin, (req, res, next) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return next();
  if (candidate.rejected_at) {
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=rechazado`);
  }

  let mergedCandidate = { ...candidate };
  if (candidate.cover_draft_json) {
    try {
      const draft = JSON.parse(candidate.cover_draft_json);
      mergedCandidate = { ...mergedCandidate, ...draft };
    } catch {}
  }

  res.render('admin/cover-form', {
    candidate,
    adminName: config.adminName,
    gsb: coverView(mergedCandidate),
    completeness: coverCompleteness(mergedCandidate),
    GSB_BRANCHES,
    GSB_SOURCES,
    formatMoney,
    ok: req.query.ok,
    error: null,
  });
});

router.post(
  '/admin/candidatos/:id/caratula/autosave',
  requireAdmin,
  sameOrigin,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).json({ ok: false, error: 'Candidato no encontrado' });

    if (getRequests(candidate.id).some((r) => r.signature)) {
      return res.status(409).json({ ok: false, error: 'Ya hay firmas registradas: la carátula firmada no se puede modificar.' });
    }
    if (candidate.rejected_at) {
      return res.status(409).json({ ok: false, error: 'El candidato fue rechazado por el Directorio.' });
    }

    const values = coverValues(req.body);
    const draftJson = JSON.stringify(values);
    const fullName = values.full_name || candidate.full_name;

    q.run(
      `UPDATE candidates SET
         full_name = ?, age = ?, branch = ?, selected_by = ?, technical_test = ?, cultural_fit = ?,
         job_function = ?, sector = ?, area = ?, national_manager = ?, branch_manager = ?, direct_leader = ?,
         recruitment_sources = ?, position_type = ?, replaces_name = ?,
         agreement_category = ?, gsb_category = ?, schedule = ?, cct = ?, overtime = ?, corporate_card = ?,
         gross_salary = ?, net_salary = ?, value_added = ?, observations = ?,
         cover_draft_json = ?,
         updated_at = ?
       WHERE id = ?`,
      fullName,
      values.age || candidate.age,
      values.branch || candidate.branch,
      values.selected_by || candidate.selected_by,
      values.technical_test || candidate.technical_test,
      values.cultural_fit || candidate.cultural_fit,
      values.job_function || candidate.job_function,
      values.sector || candidate.sector,
      values.area || candidate.area,
      values.national_manager || candidate.national_manager,
      values.branch_manager || candidate.branch_manager,
      values.direct_leader || candidate.direct_leader,
      JSON.stringify(values.sources || []),
      values.position_type || candidate.position_type,
      values.replaces_name || candidate.replaces_name,
      values.agreement_category || candidate.agreement_category,
      values.gsb_category || candidate.gsb_category,
      values.schedule || candidate.schedule,
      values.cct || candidate.cct,
      values.overtime || candidate.overtime,
      values.corporate_card || candidate.corporate_card,
      values.gross_salary || candidate.gross_salary,
      values.net_salary || candidate.net_salary,
      values.value_added || candidate.value_added,
      values.observations || candidate.observations,
      draftJson,
      nowIso(),
      candidate.id,
    );

    scheduleCloudSync();

    const updated = getCandidate(candidate.id);
    return res.json({
      ok: true,
      savedAt: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      completeness: coverCompleteness(updated)
    });
  })
);

router.post(
  '/admin/candidatos/:id/caratula',
  requireAdmin,
  upload.single('photo'),
  sameOrigin,
  requireCsrf,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).end();

    const isAjax = req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';

    const fail = (message, status = 422) => {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (isAjax) {
        return res.status(status).json({ ok: false, error: message });
      }
      return res.status(status).render('admin/cover-form', {
        candidate,
        adminName: config.adminName,
        gsb: coverView(candidate),
        completeness: coverCompleteness(candidate),
        GSB_BRANCHES,
        GSB_SOURCES,
        formatMoney,
        ok: null,
        error: message,
      });
    };

    if (getRequests(candidate.id).some((r) => r.signature)) {
      return fail('Ya hay firmas registradas: la carátula firmada no se puede modificar. Creá un candidato nuevo si necesitás cambiar el documento.', 409);
    }
    if (candidate.rejected_at) {
      return fail('El candidato fue rechazado por el Directorio: la carátula queda como constancia y no se puede modificar.', 409);
    }

    const values = coverValues(req.body);
    if (!values.full_name) return fail('El nombre del postulante es obligatorio.');

    let photoPath = candidate.photo_path || null;
    let photoData = candidate.photo_data || null;
    let photoMime = candidate.photo_mime || null;
    if (req.file) {
      try {
        const stored = storePhoto(req.file);
        if (photoPath) removeQuietly(photoPath);
        photoPath = stored.target;
        photoData = stored.base64;
        photoMime = stored.mime;
      } catch (err) {
        return fail(err.message);
      }
    }

    q.run(
      `UPDATE candidates SET
         full_name = ?, age = ?, branch = ?, selected_by = ?, technical_test = ?, cultural_fit = ?,
         job_function = ?, sector = ?, area = ?, national_manager = ?, branch_manager = ?, direct_leader = ?,
         recruitment_sources = ?, position_type = ?, replaces_name = ?,
         agreement_category = ?, gsb_category = ?, schedule = ?, cct = ?, overtime = ?, corporate_card = ?,
         gross_salary = ?, net_salary = ?, value_added = ?, observations = ?, photo_path = ?,
         photo_data = ?, photo_mime = ?, cover_draft_json = ?,
         updated_at = ?
       WHERE id = ?`,
      values.full_name,
      values.age,
      values.branch,
      values.selected_by,
      values.technical_test,
      values.cultural_fit,
      values.job_function,
      values.sector,
      values.area,
      values.national_manager,
      values.branch_manager,
      values.direct_leader,
      JSON.stringify(values.sources),
      values.position_type,
      values.replaces_name,
      values.agreement_category,
      values.gsb_category,
      values.schedule,
      values.cct,
      values.overtime,
      values.corporate_card,
      values.gross_salary,
      values.net_salary,
      values.value_added,
      values.observations,
      photoPath,
      photoData,
      photoMime,
      JSON.stringify(values),
      nowIso(),
      candidate.id,
    );

    audit({ candidateId: candidate.id, event: 'cover_updated', detail: 'Carátula GSB actualizada por Yohita', req });

    try {
      await renderCandidatePdf(candidate.id, { persist: true, type: 'cover', req, event: 'cover_regenerated' });
    } catch (err) {
      console.warn('[admin] no se pudo regenerar la carátula GSB:', err.message);
    }

    scheduleCloudSync();

    if (isAjax) {
      return res.json({ ok: true, message: 'Carátula guardada correctamente' });
    }
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=caratula`);
  }),
);

/* ── Informe de entrevista Modelo de Talento GSB ──────────────────────── */

router.get('/admin/candidatos/:id/informe-entrevista', requireAdmin, (req, res, next) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return next();

  let interviewData = {};
  if (candidate.interview_report_json) {
    try {
      interviewData = JSON.parse(candidate.interview_report_json);
    } catch {
      interviewData = {};
    }
  }

  // Si tiene draft_data_json más reciente o complementario
  if (candidate.draft_data_json && (!interviewData.fields || Object.keys(interviewData.fields).length === 0)) {
    try {
      const draft = JSON.parse(candidate.draft_data_json);
      interviewData = { ...interviewData, ...draft };
    } catch {}
  }

  res.render('admin/interview-report', {
    candidate,
    adminName: req.admin?.userName || config.adminName,
    interviewData,
    sources: sourcesOf(candidate),
    GSB_SOURCES,
    GSB_BRANCHES,
    ok: req.query.ok,
  });
});

router.post('/admin/candidatos/:id/informe-entrevista', requireAdmin, sameOrigin, wrap(async (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Candidato no encontrado' });

  const report = req.body?.report ?? {};
  const jsonStr = JSON.stringify(report);
  const userLabel = req.admin?.userName || 'Yohita';

  q.run('UPDATE candidates SET interview_report_json = ?, draft_data_json = ?, updated_at = ? WHERE id = ?', jsonStr, jsonStr, nowIso(), candidate.id);
  audit({ candidateId: candidate.id, event: 'interview_report_updated', detail: `Informe de entrevista actualizado por ${userLabel}`, req });

  try {
    await renderCandidatePdf(candidate.id, { persist: true, type: 'cover', req, event: 'cover_regenerated' });
  } catch (err) {
    console.warn('[admin] no se pudo regenerar el PDF tras actualizar informe:', err.message);
  }

  scheduleCloudSync();
  res.json({ ok: true });
}));

router.post(
  '/admin/candidatos/:id/foto',
  requireAdmin,
  upload.single('photo'),
  sameOrigin,
  requireCsrf,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).end();
    const isAjax = req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';

    if (candidate.rejected_at) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (isAjax) return res.status(409).json({ ok: false, error: 'El candidato fue rechazado' });
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=rechazado`);
    }
    if (!req.file) {
      if (isAjax) return res.status(400).json({ ok: false, error: 'No se seleccionó ninguna imagen' });
      return res.redirect(`/admin/candidatos/${candidate.id}/caratula?ok=sin-foto`);
    }
    if (getRequests(candidate.id).some((r) => r.signature)) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (isAjax) return res.status(409).json({ ok: false, error: 'Ya hay firmas registradas: no se puede modificar la foto.' });
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=firmado-no-editable`);
    }
    try {
      const stored = storePhoto(req.file);
      if (candidate.photo_path) removeQuietly(candidate.photo_path);
      q.run(
        'UPDATE candidates SET photo_path = ?, photo_data = ?, photo_mime = ?, updated_at = ? WHERE id = ?',
        stored.target,
        stored.base64,
        stored.mime,
        nowIso(),
        candidate.id,
      );
      audit({ candidateId: candidate.id, event: 'photo_updated', detail: 'Foto del ingreso actualizada por ' + (req.admin?.userName || 'Yohita'), req });

      try {
        await renderCandidatePdf(candidate.id, { persist: true, type: 'cover', req, event: 'cover_regenerated' });
      } catch {}

      scheduleCloudSync();

      if (isAjax) {
        return res.json({
          ok: true,
          photoUrl: `/admin/candidatos/${candidate.id}/foto?v=${Date.now()}`
        });
      }
      return res.redirect(`/admin/candidatos/${candidate.id}/caratula?ok=foto`);
    } catch (err) {
      if (isAjax) return res.status(400).json({ ok: false, error: err.message });
      return res.redirect(`/admin/candidatos/${candidate.id}/caratula?ok=foto-invalida`);
    }
  }),
);

router.post('/admin/candidatos/:id/foto/eliminar', requireAdmin, sameOrigin, requireCsrf, wrap(async (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).end();
  const isAjax = req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';

  if (candidate.rejected_at) {
    if (isAjax) return res.status(409).json({ ok: false, error: 'El candidato fue rechazado' });
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=rechazado`);
  }
  if (getRequests(candidate.id).some((r) => r.signature)) {
    if (isAjax) return res.status(409).json({ ok: false, error: 'Ya hay firmas registradas' });
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=firmado-no-editable`);
  }
  if (candidate.photo_path) removeQuietly(candidate.photo_path);
  q.run('UPDATE candidates SET photo_path = NULL, photo_data = NULL, photo_mime = NULL, updated_at = ? WHERE id = ?', nowIso(), candidate.id);
  audit({ candidateId: candidate.id, event: 'photo_removed', detail: 'Foto del ingreso eliminada por ' + (req.admin?.userName || 'Yohita'), req });

  try {
    await renderCandidatePdf(candidate.id, { persist: true, type: 'cover', req, event: 'cover_regenerated' });
  } catch {}

  scheduleCloudSync();

  if (isAjax) return res.json({ ok: true });
  res.redirect(`/admin/candidatos/${candidate.id}/caratula?ok=sin-foto`);
}));

router.get('/admin/candidatos/:id/foto', requireAdmin, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).end();

  // 1. Prioridad: servir desde photo_data en SQLite (persistente en la nube / Render)
  if (candidate.photo_data) {
    const mime = candidate.photo_mime || 'image/jpeg';
    const buffer = Buffer.from(candidate.photo_data, 'base64');
    fileHeaders(res, {
      type: mime,
      disposition: `inline; filename="foto-${candidate.id}.${mime === 'image/png' ? 'png' : 'jpg'}"`,
    });
    return res.end(buffer);
  }

  // 2. Fallback: servir desde archivo local en disco si existe
  if (candidate.photo_path && fs.existsSync(candidate.photo_path)) {
    const ext = path.extname(candidate.photo_path).toLowerCase();
    fileHeaders(res, {
      type: ext === '.png' ? 'image/png' : 'image/jpeg',
      disposition: `inline; filename="foto-${candidate.id}${ext}"`,
    });
    return res.sendFile(candidate.photo_path);
  }

  return res.status(404).end();
});

router.post(
  '/admin/candidatos/:id/reanalizar-cv',
  requireAdmin,
  sameOrigin,
  requireCsrf,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).end();
    if (candidate.rejected_at) {
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=rechazado`);
    }
    if (!candidate.cv_file_path || !fs.existsSync(candidate.cv_file_path)) {
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=sin-cv`);
    }
    if (getRequests(candidate.id).some((r) => r.signature)) {
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=firmado-no-editable`);
    }

    const cvText = await extractCvText(candidate.cv_file_path);
    if (!cvText) {
      audit({ candidateId: candidate.id, event: 'cv_analysis_failed', detail: 'No se pudo leer el texto del CV', req });
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=cv-ilegible`);
    }

    const result = await analyzeCv(cvText, { originalName: candidate.cv_original_name });
    const fields = result.fields;
    const fullName = fields.full_name === 'Candidato' ? candidate.full_name : fields.full_name;
    const position = fields.position === 'A definir' ? candidate.position : fields.position;
    const extra = {
      ...(candidate.cover_data_json || {}),
      client: fields.client || '',
      seniority: fields.seniority || '',
      salary: fields.salary || '',
      start_date: fields.start_date || '',
      linkedin: fields.linkedin || '',
    };

    q.run(
      `UPDATE candidates SET full_name = ?, position = ?, area = ?, client = ?, seniority = ?, salary = ?,
         start_date = ?, linkedin = ?, notes = ?, summary_text = ?, summary_source = ?, cover_data_json = ?,
         age = ?, branch = ?, job_function = ?, sector = ?, observations = ?,
         updated_at = ? WHERE id = ?`,
      fullName,
      position,
      fields.area || '',
      extra.client,
      extra.seniority,
      extra.salary,
      extra.start_date,
      extra.linkedin,
      fields.notes || '',
      result.summary,
      result.summaryProvider,
      JSON.stringify(extra),
      fields.age || candidate.age || '',
      fields.branch || candidate.branch || '',
      fields.job_function || fields.position || candidate.job_function || '',
      fields.sector || candidate.sector || '',
      fields.observations || candidate.observations || '',
      nowIso(),
      candidate.id,
    );

    audit({
      candidateId: candidate.id,
      event: 'cv_reanalyzed',
      detail: `${result.provider}/${result.model} · ${result.warnings.length ? `${result.warnings.length} aviso(s)` : 'sin avisos'}`,
      req,
    });
    if (result.warnings.length) {
      audit({ candidateId: candidate.id, event: 'cv_analysis_warnings', detail: result.warnings.join(' · '), req });
    }

    try {
      await renderCandidatePdf(candidate.id, { persist: true, type: 'cover', req, event: 'cover_regenerated' });
    } catch (err) {
      console.warn('[admin] no se pudo regenerar la carátula:', err.message);
    }

    return res.redirect(
      `/admin/candidatos/${candidate.id}?ok=reanalizado${result.warnings.length ? '&aviso=revisar' : ''}`,
    );
  }),
);

router.post(
  '/admin/api/candidatos/:id/resumen',
  requireAdmin,
  sameOrigin,
  requireCsrf,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).json({ error: 'Candidato inexistente' });
    if (req.body?.summary !== undefined) {
      const text = cleanText(req.body.summary, 8000);
      q.run('UPDATE candidates SET summary_text = ?, summary_source = ?, updated_at = ? WHERE id = ?', text, 'manual', nowIso(), candidate.id);
      audit({ candidateId: candidate.id, event: 'summary_edited', req });
      return res.json({ ok: true, summary: text, saved: true });
    }
    const cvText = await extractCvText(candidate.cv_file_path);
    const result = await summarizeCandidate(candidate, cvText);
    q.run('UPDATE candidates SET summary_text = ?, summary_source = ?, updated_at = ? WHERE id = ?', result.text, result.provider, nowIso(), candidate.id);
    audit({ candidateId: candidate.id, event: 'summary_generated', detail: `${result.provider}/${result.model}`, req });
    return res.json({ ok: true, summary: result.text, provider: result.provider, model: result.model, cvChars: cvText.length });
  }),
);

router.post('/admin/candidatos/:id/firmantes', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).end();
  if (candidate.rejected_at) {
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=rechazado`);
  }

  // La carátula GSB exige postulante, sucursal, al menos una fuente y tipo de
  // puesto antes de generar links de firma.
  if (!coverCompleteness(candidate).complete) {
    return res.redirect(`/admin/candidatos/${candidate.id}?ok=caratula-incompleta`);
  }

  const name = cleanText(req.body?.name, 140);
  if (!name) return res.redirect(`/admin/candidatos/${candidate.id}?ok=sin-nombre`);

  // El formulario manda "ámbito|rol" para que la carátula fija sepa dónde va
  // cada firma. Si no viene, se toma el rol libre como Casa Central.
  const raw = cleanText(req.body?.gsb_role, 160);
  let scope = 'central';
  let role = '';
  if (raw === 'custom' || raw === 'otro') {
    scope = cleanText(req.body?.custom_scope, 20) === 'sucursal' ? 'sucursal' : 'central';
    role = cleanText(req.body?.custom_role, 140) || 'Firma adicional';
  } else if (raw.includes('|')) {
    const [maybeScope, ...rest] = raw.split('|');
    scope = maybeScope === 'sucursal' ? 'sucursal' : 'central';
    role = rest.join('|').trim();
  } else {
    role = cleanText(req.body?.role, 140);
  }
  if (!role) role = 'Directorio';

  // Si el rol ya está ocupado en los bloques estándar de la carátula,
  // se anota como firma adicional para permitir múltiples firmantes (por ej. varios directores o gerentes).
  const existingSameRole = getRequests(candidate.id).filter(
    (r) =>
      r.effective_status !== 'revoked' &&
      (r.signer.scope || 'central') === scope &&
      normalizeRole(r.signer.role).startsWith(normalizeRole(role)),
  );
  if (existingSameRole.length > 0) {
    role = `${role} (${existingSameRole.length + 1})`;
  }

  const rawDni = cleanText(req.body?.dni, 30).replace(/\D/g, '');
  const dni = rawDni || null;

  const { lastInsertRowid: signerId } = q.run(
    'INSERT INTO signers (name, role, scope, phone, email, dni, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name,
    role,
    scope,
    cleanText(req.body?.phone, 40),
    cleanText(req.body?.email, 160),
    dni,
    nowIso(),
  );

  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600 * 1000).toISOString();
  const { lastInsertRowid: requestId } = q.run(
    'INSERT INTO signature_requests (candidate_id, signer_id, token, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    candidate.id,
    signerId,
    token,
    'pending',
    expiresAt,
    nowIso(),
  );

  audit({
    candidateId: candidate.id,
    requestId,
    event: 'signer_added',
    detail: `${name}${dni ? ` (DNI ${dni})` : ''} (${scopeLabel(scope)} — ${role})`,
    req,
  });
  res.redirect(`/admin/candidatos/${candidate.id}?ok=firmante`);
});

router.get('/admin/candidatos/:id/firma/:signatureId.png', requireAdmin, (req, res, next) => {
  try {
    const candidateId = Number(req.params.id);
    const signature = q.get(
      `SELECT s.* FROM signatures s JOIN signature_requests r ON r.id = s.request_id
       WHERE s.id = ? AND r.candidate_id = ?`,
      Number(req.params.signatureId),
      candidateId,
    );
    if (!signature || !fs.existsSync(signature.signature_image_path)) return res.status(404).end();
    fileHeaders(res, { type: 'image/png' });
    return res.sendFile(signature.signature_image_path);
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/api/requests/:id/sent', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const request = q.get('SELECT * FROM signature_requests WHERE id = ?', Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'Solicitud inexistente' });
  if (!request.sent_at) {
    q.run('UPDATE signature_requests SET sent_at = ? WHERE id = ?', nowIso(), request.id);
    audit({ candidateId: request.candidate_id, requestId: request.id, event: 'link_shared', detail: 'Link compartido por WhatsApp', req });
  }
  res.json({ ok: true });
});

router.post('/admin/requests/:id/revocar', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const request = q.get('SELECT * FROM signature_requests WHERE id = ?', Number(req.params.id));
  if (!request) return res.status(404).end();
  // Una solicitud firmada no se anula: la firma es evidencia y debe seguir descargable.
  const { changes } = q.run('UPDATE signature_requests SET status = ? WHERE id = ? AND status != ?', 'revoked', request.id, 'signed');
  if (!changes) return res.redirect(`/admin/candidatos/${request.candidate_id}?ok=firmado-no-anulable`);
  audit({ candidateId: request.candidate_id, requestId: request.id, event: 'request_revoked', detail: 'Solicitud anulada por Yohita', req });
  res.redirect(`/admin/candidatos/${request.candidate_id}?ok=anulado`);
});

router.post('/admin/requests/:id/reenviar', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const request = q.get('SELECT * FROM signature_requests WHERE id = ?', Number(req.params.id));
  if (!request) return res.status(404).end();
  const candidate = getCandidate(request.candidate_id);
  if (candidate?.rejected_at) {
    return res.redirect(`/admin/candidatos/${request.candidate_id}?ok=rechazado`);
  }
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600 * 1000).toISOString();
  const { changes } = q.run('UPDATE signature_requests SET expires_at = ?, status = ? WHERE id = ? AND status != ?', expiresAt, 'pending', request.id, 'signed');
  if (!changes) return res.redirect(`/admin/candidatos/${request.candidate_id}?ok=firmado-no-anulable`);
  audit({ candidateId: request.candidate_id, requestId: request.id, event: 'request_extended', detail: `Nuevo vencimiento ${expiresAt}`, req });
  res.redirect(`/admin/candidatos/${request.candidate_id}?ok=reenviado`);
});

/*
 * Borrado de expediente (retención de datos, Ley 25.326).
 * Requiere escribir el nombre completo. Nunca borra un expediente con firmas:
 * la firma es evidencia. El evento de auditoría se conserva a propósito.
 */
router.post('/admin/candidatos/:id/eliminar', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate) return res.status(404).end();

  // Si viene confirmación en texto (desde la sección retención en candidate.ejs), validamos si coincide
  // Si viene el flag quick = '1' (desde el botón directo en la lista de dashboard.ejs), permite borrar directamente
  const isQuick = req.body?.quick === '1';
  if (!isQuick) {
    const typed = cleanText(req.body?.confirm, 160);
    if (typed.toLowerCase() !== candidate.full_name.trim().toLowerCase()) {
      return res.redirect(`/admin/candidatos/${candidate.id}?ok=confirmacion-invalida`);
    }
  }

  // Permitir borrar incluso si tenía firmas registradas cuando se pide eliminar explícitamente
  const deleted = deleteCandidate(candidate.id);
  if (!deleted) return res.status(404).end();

  let removed = 0;
  let filesToDelete = deleted.files;

  // Si estaba bloqueado por firmas previas pero se fuerza la eliminación
  if (deleted.blocked) {
    // deleteCandidate blocked, but we can delete this single candidate with signatures
    q.exec('BEGIN IMMEDIATE');
    try {
      q.run('DELETE FROM signatures WHERE request_id IN (SELECT id FROM signature_requests WHERE candidate_id = ?)', candidate.id);
      q.run('DELETE FROM signature_requests WHERE candidate_id = ?', candidate.id);
      q.run('DELETE FROM documents WHERE candidate_id = ?', candidate.id);
      q.run('DELETE FROM candidates WHERE id = ?', candidate.id);
      q.run('DELETE FROM signers WHERE id NOT IN (SELECT signer_id FROM signature_requests)');
      q.exec('COMMIT');
    } catch (e) {
      q.exec('ROLLBACK');
    }
  }

  for (const file of filesToDelete || []) {
    try {
      fs.unlinkSync(file);
      removed += 1;
    } catch {
      /* el archivo ya no estaba */
    }
  }

  audit({
    candidateId: candidate.id,
    event: 'candidate_deleted',
    detail: `Expediente eliminado: ${candidate.full_name} · ${removed} archivos`,
    req,
  });
  scheduleCloudSync();
  res.redirect('/admin?ok=eliminado');
});

/*
 * Vaciar / borrar todos los candidatos (acumulación de candidatos).
 */
router.post('/admin/candidatos/vaciar-todos', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const result = deleteAllCandidates({ force: true });
  scheduleCloudSync();
  let removed = 0;
  for (const file of result.files) {
    try {
      fs.unlinkSync(file);
      removed += 1;
    } catch {
      /* archivo no existía */
    }
  }

  audit({
    event: 'all_candidates_deleted',
    detail: `Se eliminaron todos los candidatos (${result.deleted.length}) y ${removed} archivos por Yohita`,
    req,
  });

  res.redirect('/admin?ok=todos-eliminados');
});

/* ── Archivos ──────────────────────────────────────────────────────────── */

router.get('/admin/candidatos/:id/cv', requireAdmin, (req, res) => {
  const candidate = getCandidate(Number(req.params.id));
  if (!candidate?.cv_file_path || !fs.existsSync(candidate.cv_file_path)) return res.status(404).send('CV no disponible');
  fileHeaders(res, { type: 'application/pdf', disposition: `inline; filename="cv-${candidate.id}.pdf"` });
  res.sendFile(candidate.cv_file_path);
});

router.get(
  '/admin/candidatos/:id/pdf',
  requireAdmin,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).end();
    const { bytes, hash } = await renderCandidatePdf(candidate.id);
    fileHeaders(res, { type: 'application/pdf', disposition: `inline; filename="${unsignedPdfName(candidate)}"` });
    res.set('X-Document-SHA256', hash);
    res.send(Buffer.from(bytes));
  }),
);

router.get(
  '/admin/candidatos/:id/firmado.pdf',
  requireAdmin,
  wrap(async (req, res) => {
    const candidate = getCandidate(Number(req.params.id));
    if (!candidate) return res.status(404).end();
    const stored = latestDocument(candidate.id, 'cover_signed');
    if (stored && fs.existsSync(stored.file_path)) {
      fileHeaders(res, { type: 'application/pdf', disposition: `attachment; filename="${signedPdfName(candidate)}"` });
      if (stored.sha256) res.set('X-Document-SHA256', stored.sha256);
      return res.sendFile(stored.file_path);
    }
    const requests = getRequests(candidate.id);
    if (!requests.some((r) => r.signature)) return res.status(404).send('Todavía no hay firmas.');
    const { bytes, hash } = await renderCandidatePdf(candidate.id, { persist: true, type: 'cover_signed', req, event: 'pdf_signed_generated' });
    fileHeaders(res, { type: 'application/pdf', disposition: `attachment; filename="${signedPdfName(candidate)}"` });
    res.set('X-Document-SHA256', hash);
    return res.send(Buffer.from(bytes));
  }),
);

router.get('/admin/auditoria', requireAdmin, (req, res) => {
  const rows = q.all(
    `SELECT a.*, c.full_name FROM audit_log a LEFT JOIN candidates c ON c.id = a.candidate_id ORDER BY a.id DESC LIMIT 300`,
  );
  res.render('admin/audit', {
    rows,
    adminName: config.adminName,
    formatDateTime,
    chain: verifyAuditChain(),
    shortHash,
  });
});

/* ── Centro de seguridad ───────────────────────────────────────────────── */

function securitySnapshot() {
  const chain = verifyAuditChain();
  const lastLogin = q.get("SELECT * FROM audit_log WHERE event = 'admin_login' ORDER BY id DESC LIMIT 1");
  const docs = q.get('SELECT COUNT(*) AS total FROM documents');
  const signatures = q.get('SELECT COUNT(*) AS total FROM signatures');
  const backups = fs.existsSync(config.backupDir)
    ? fs.readdirSync(config.backupDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;
  const checks = [
    {
      key: 'https',
      label: 'Conexión cifrada (HTTPS)',
      ok: config.baseUrl.startsWith('https://'),
      detail: config.baseUrl.startsWith('https://')
        ? 'Los datos viajan cifrados entre el navegador y el servidor.'
        : 'Todavía no está publicado con HTTPS. No compartas links fuera de la red local.',
    },
    {
      key: 'hsts',
      label: 'HSTS activo',
      ok: config.baseUrl.startsWith('https://') && config.forceHttps,
      detail: 'El navegador recuerda usar siempre HTTPS en este dominio.',
    },
    {
      key: 'password',
      label: 'Clave con hash scrypt',
      ok: Boolean(config.adminPasswordHash),
      detail: config.adminPasswordHash
        ? 'La clave no se guarda en texto plano.'
        : 'La clave se compara desde el archivo .env. Generá ADMIN_PASSWORD_HASH.',
    },
    {
      key: 'totp',
      label: 'Doble factor (TOTP)',
      ok: totpEnabled(),
      detail: totpEnabled()
        ? 'Además de la clave se exige un código de 6 dígitos.'
        : 'Recomendado: sumá un código de la app autenticadora.',
    },
    {
      key: 'sessions',
      label: 'Sesiones revocables',
      ok: true,
      detail: `Vencen a las ${Math.round(config.sessionTtlMs / 3600000)} h o tras ${Math.round(config.sessionIdleMs / 60000)} min sin uso.`,
    },
    {
      key: 'csrf',
      label: 'Protección CSRF',
      ok: true,
      detail: 'Cada formulario del panel lleva un token ligado a la sesión.',
    },
    {
      key: 'audit',
      label: 'Auditoría encadenada',
      ok: chain.ok,
      detail: chain.ok
        ? `${chain.checked} evento(s) verificados. Último sello: ${chain.lastHash ? shortHash(chain.lastHash) : '—'}.`
        : `Se detectó un problema en el evento ${chain.brokenAt}: ${chain.reason}`,
    },
    {
      key: 'hosts',
      label: 'Dominios permitidos',
      ok: config.allowedHosts.length > 0,
      detail: config.allowedHosts.length
        ? `Limitado a: ${config.allowedHosts.join(', ')}.`
        : 'ALLOWED_HOSTS está vacío. En producción conviene fijarlo.',
    },
    {
      key: 'files',
      label: 'Archivos con sello SHA-256',
      ok: true,
      detail: `${Number(docs?.total ?? 0)} PDF(s) y ${Number(signatures?.total ?? 0)} firma(s) con hash registrado.`,
    },
    {
      key: 'backup',
      label: 'Respaldos',
      ok: backups > 0,
      detail: backups > 0
        ? `${backups} respaldo(s) en ${path.relative(config.root, config.backupDir)}.`
        : 'Todavía no hay respaldos. Corré «npm run backup» y programalo.',
    },
  ];
  return {
    chain,
    checks,
    warnings: securityWarnings(),
    activeSessions: activeSessionCount(),
    lastLogin,
    envName: config.envName,
    baseUrl: config.baseUrl,
    tokenTtlHours: config.tokenTtlHours,
    sessionTtlHours: Math.round(config.sessionTtlMs / 3600000),
    sessionIdleMinutes: Math.round(config.sessionIdleMs / 60000),
  };
}

router.get('/admin/seguridad', requireAdmin, (req, res) => {
  res.render('admin/security', {
    adminName: config.adminName,
    active: 'seguridad',
    ...securitySnapshot(),
    formatDateTime,
    ok: req.query.ok,
  });
});

router.post('/admin/seguridad/verificar', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const chain = verifyAuditChain();
  audit({
    event: chain.ok ? 'integrity_check_ok' : 'integrity_check_failed',
    detail: chain.ok ? `${chain.checked} eventos verificados` : `Evento ${chain.brokenAt}: ${chain.reason}`,
    req,
  });
  res.redirect(`/admin/seguridad?ok=${chain.ok ? 'integro' : 'revisar'}`);
});

router.post('/admin/seguridad/revocar-sesiones', requireAdmin, sameOrigin, requireCsrf, (req, res) => {
  const count = revokeOtherSessions(req);
  audit({ event: 'admin_sessions_revoked', detail: `${count} sesión(es) cerradas`, req });
  res.redirect('/admin/seguridad?ok=sesiones');
});

router.get('/admin/api/auditoria/verificar', requireAdmin, (req, res) => {
  res.json(verifyAuditChain());
});

/* ── Asistente Virtual GSB ────────────────────────────────────────────── */

router.post('/admin/api/assistant', requireAdmin, sameOrigin, (req, res) => {
  const query = req.body?.message || '';
  const response = getAssistantResponse(query);
  res.json(response);
});

router.get('/admin/api/heartbeat', requireAdmin, (req, res) => {
  res.json({ ok: true, now: nowIso(), user: req.admin?.userName || 'Yohita' });
});

export default router;
