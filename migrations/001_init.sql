-- 001_init.sql — esquema inicial del MVP
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS candidates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name         TEXT NOT NULL,
  position          TEXT NOT NULL,
  area              TEXT,
  client            TEXT,
  seniority         TEXT,
  salary            TEXT,
  start_date        TEXT,
  linkedin          TEXT,
  notes             TEXT,
  cv_file_path      TEXT,
  cv_original_name  TEXT,
  summary_text      TEXT,
  summary_source    TEXT,
  cover_data_json   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT,
  phone       TEXT,
  email       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signature_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id     INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  signer_id        INTEGER NOT NULL REFERENCES signers(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending',
  expires_at       TEXT NOT NULL,
  sent_at          TEXT,
  first_viewed_at  TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_candidate ON signature_requests(candidate_id);
CREATE INDEX IF NOT EXISTS idx_requests_signer ON signature_requests(signer_id);

CREATE TABLE IF NOT EXISTS signatures (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id            INTEGER NOT NULL UNIQUE REFERENCES signature_requests(id) ON DELETE CASCADE,
  signature_image_path  TEXT NOT NULL,
  signed_at             TEXT NOT NULL,
  ip                    TEXT,
  user_agent            TEXT,
  document_hash         TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  sha256        TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_candidate ON documents(candidate_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id  INTEGER,
  request_id    INTEGER,
  event         TEXT NOT NULL,
  detail        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_candidate ON audit_log(candidate_id);
