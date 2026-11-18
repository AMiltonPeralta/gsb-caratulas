-- 003_security.sql — sesiones revocables y auditoría encadenada

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash    TEXT PRIMARY KEY,
  csrf_token    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  ip            TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Cada evento se encadena al anterior. Si alguien edita o borra una fila,
-- la verificación deja de cerrar. Es tamper-evident, no inmutable.
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_entry_hash ON audit_log(entry_hash);
