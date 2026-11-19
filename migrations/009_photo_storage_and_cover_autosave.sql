-- Migración 009: Persistencia de fotos en base de datos y borrador de carátula
ALTER TABLE candidates ADD COLUMN photo_data TEXT;
ALTER TABLE candidates ADD COLUMN photo_mime TEXT;
ALTER TABLE candidates ADD COLUMN cover_draft_json TEXT;
