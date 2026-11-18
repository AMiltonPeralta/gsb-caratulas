import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { q, audit } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { nowIso, randomToken, formatDateTime } from '../src/util.js';
import { renderCandidatePdf } from '../src/documents.js';
import { buildSampleCvPdf, demoCandidate, makeAvatarPng } from './lib/sample.js';

runMigrations();

const existing = q.get('SELECT * FROM candidates WHERE full_name = ?', demoCandidate.full_name);

function printLinks(candidateId) {
  const requests = q.all(
    `SELECT r.*, s.name, s.role, s.phone FROM signature_requests r
     JOIN signers s ON s.id = r.signer_id WHERE r.candidate_id = ? ORDER BY r.id`,
    candidateId,
  );
  console.log('');
  console.log('  Panel:      ' + config.baseUrl + '/admin');
  console.log('  Clave:      ' + config.adminPassword);
  console.log('  Candidato:  ' + config.baseUrl + '/admin/candidatos/' + candidateId);
  console.log('');
  for (const r of requests) {
    console.log(`  ${r.name} (${r.role || 'Director'}):`);
    console.log(`  ${config.baseUrl}/f/${r.token}`);
    console.log(`  vence ${formatDateTime(r.expires_at)}`);
    console.log('');
  }
}

if (existing) {
  console.log(`[seed] El candidato de demo ya existe (id ${existing.id}). No se duplica.`);
  audit({ candidateId: existing.id, event: 'demo_seed_reused' });
  printLinks(existing.id);
} else {
  const cvDir = path.join(config.uploadDir, 'cv');
  fs.mkdirSync(cvDir, { recursive: true });
  const cvPath = path.join(cvDir, 'cv-demo-lucia-fernandez.pdf');
  fs.writeFileSync(cvPath, await buildSampleCvPdf());

  const photoDir = path.join(config.uploadDir, 'photos');
  fs.mkdirSync(photoDir, { recursive: true });
  const photoPath = path.join(photoDir, 'foto-demo-lucia.png');
  fs.writeFileSync(photoPath, makeAvatarPng());

  const timestamp = nowIso();
  const { lastInsertRowid: candidateId } = q.run(
    `INSERT INTO candidates
      (full_name, position, area, client, seniority, salary, start_date, linkedin, notes,
       cv_file_path, cv_original_name, photo_path, summary_text, summary_source, cover_data_json, created_at, updated_at,
       age, branch, selected_by, technical_test, cultural_fit, job_function, sector,
       national_manager, branch_manager, direct_leader, recruitment_sources,
       position_type, replaces_name, agreement_category, gsb_category, schedule, cct,
       overtime, corporate_card, gross_salary, net_salary, value_added, observations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    demoCandidate.full_name,
    demoCandidate.position,
    demoCandidate.area,
    demoCandidate.client,
    demoCandidate.seniority,
    demoCandidate.salary,
    demoCandidate.start_date,
    demoCandidate.linkedin,
    demoCandidate.notes,
    cvPath,
    'cv-lucia-fernandez.pdf',
    photoPath,
    demoCandidate.summary_text,
    'demo',
    JSON.stringify({
      client: demoCandidate.client,
      seniority: demoCandidate.seniority,
      salary: demoCandidate.salary,
      start_date: demoCandidate.start_date,
      linkedin: demoCandidate.linkedin,
    }),
    timestamp,
    timestamp,
    demoCandidate.age,
    demoCandidate.branch,
    demoCandidate.selected_by,
    demoCandidate.technical_test,
    demoCandidate.cultural_fit,
    demoCandidate.job_function,
    demoCandidate.sector,
    demoCandidate.national_manager,
    demoCandidate.branch_manager,
    demoCandidate.direct_leader,
    demoCandidate.recruitment_sources,
    demoCandidate.position_type,
    demoCandidate.replaces_name,
    demoCandidate.agreement_category,
    demoCandidate.gsb_category,
    demoCandidate.schedule,
    demoCandidate.cct,
    demoCandidate.overtime,
    demoCandidate.corporate_card,
    demoCandidate.gross_salary,
    demoCandidate.net_salary,
    demoCandidate.value_added,
    demoCandidate.observations,
  );

  audit({ candidateId, event: 'candidate_created', detail: 'Candidato de demo' });

  const signers = [
    { name: 'Martín Sosa', role: 'Gerente', scope: 'central', phone: '+54 9 11 5555 0101', email: 'martin.sosa@demo.com' },
    { name: 'Carolina Pérez', role: 'Recursos Humanos', scope: 'central', phone: '+54 9 11 5555 0102', email: 'carolina.perez@demo.com' },
  ];

  for (const signer of signers) {
    const { lastInsertRowid: signerId } = q.run(
      'INSERT INTO signers (name, role, scope, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      signer.name,
      signer.role,
      signer.scope,
      signer.phone,
      signer.email,
      nowIso(),
    );
    const { lastInsertRowid: requestId } = q.run(
      'INSERT INTO signature_requests (candidate_id, signer_id, token, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      candidateId,
      signerId,
      randomToken(),
      'pending',
      new Date(Date.now() + config.tokenTtlHours * 3600 * 1000).toISOString(),
      nowIso(),
    );
    audit({ candidateId, requestId, event: 'signer_added', detail: `${signer.name} (${signer.role})` });
  }

  await renderCandidatePdf(candidateId, { persist: true, type: 'cover', event: 'cover_generated' });

  console.log('[seed] Candidato de demo creado.');
  printLinks(candidateId);
}
