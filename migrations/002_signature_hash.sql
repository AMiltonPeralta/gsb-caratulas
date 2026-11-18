-- 002_signature_hash.sql — código de verificación estable por firma
-- El SHA-256 del PDF firmado se guarda en signatures.document_hash.
-- Este hash es sobre los datos de la firma (no sobre el PDF), para poder
-- estamparlo dentro del documento sin la referencia circular del hash del PDF.
ALTER TABLE signatures ADD COLUMN signature_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_signatures_hash ON signatures(signature_hash);
