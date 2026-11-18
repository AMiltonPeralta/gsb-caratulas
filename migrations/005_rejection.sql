-- 005_rejection.sql — rechazo del candidato por parte del Directorio
-- El rechazo cierra el proceso: queda registrado quién lo decidió, cuándo y
-- por qué. Las solicitudes pendientes se anulan, pero las firmas ya emitidas
-- se conservan como evidencia.

ALTER TABLE candidates ADD COLUMN rejected_at TEXT;
ALTER TABLE candidates ADD COLUMN rejected_by TEXT;
ALTER TABLE candidates ADD COLUMN rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_candidates_rejected ON candidates(rejected_at);
