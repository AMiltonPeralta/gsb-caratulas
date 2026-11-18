-- 004_gsb_cover.sql — carátula oficial de Grúas San Blas (GSB)
-- La carátula deja de ser una plantilla genérica y pasa a ser el formulario
-- fijo de ingreso de GSB: datos del postulante, fuentes, condiciones y firmas.
-- Los campos que no vienen del CV quedan vacíos para que Selección & Desarrollo
-- los complete desde el panel.

ALTER TABLE candidates ADD COLUMN age TEXT;
ALTER TABLE candidates ADD COLUMN branch TEXT;
ALTER TABLE candidates ADD COLUMN selected_by TEXT;
ALTER TABLE candidates ADD COLUMN technical_test TEXT;
ALTER TABLE candidates ADD COLUMN cultural_fit TEXT;
ALTER TABLE candidates ADD COLUMN job_function TEXT;
ALTER TABLE candidates ADD COLUMN sector TEXT;
ALTER TABLE candidates ADD COLUMN national_manager TEXT;
ALTER TABLE candidates ADD COLUMN branch_manager TEXT;
ALTER TABLE candidates ADD COLUMN direct_leader TEXT;

-- Fuentes de reclutamiento elegidas, guardadas como JSON (array de strings).
ALTER TABLE candidates ADD COLUMN recruitment_sources TEXT;
-- 'nuevo' | 'reemplazo'
ALTER TABLE candidates ADD COLUMN position_type TEXT;
ALTER TABLE candidates ADD COLUMN replaces_name TEXT;

ALTER TABLE candidates ADD COLUMN agreement_category TEXT;
ALTER TABLE candidates ADD COLUMN gsb_category TEXT;
ALTER TABLE candidates ADD COLUMN schedule TEXT;
ALTER TABLE candidates ADD COLUMN cct TEXT;
-- 'SI' | 'NO'
ALTER TABLE candidates ADD COLUMN overtime TEXT;
ALTER TABLE candidates ADD COLUMN corporate_card TEXT;
ALTER TABLE candidates ADD COLUMN gross_salary TEXT;
ALTER TABLE candidates ADD COLUMN net_salary TEXT;
ALTER TABLE candidates ADD COLUMN value_added TEXT;
ALTER TABLE candidates ADD COLUMN observations TEXT;

-- Foto del ingreso (JPG/PNG). Se sirve sólo con link o sesión del panel.
ALTER TABLE candidates ADD COLUMN photo_path TEXT;

-- Ámbito de la firma dentro de la carátula: sucursal | central.
ALTER TABLE signers ADD COLUMN scope TEXT DEFAULT 'central';

CREATE INDEX IF NOT EXISTS idx_signers_scope ON signers(scope);
