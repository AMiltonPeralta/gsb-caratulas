-- 007_signer_dni.sql — DNI para firmantes y firmas registradas
ALTER TABLE signers ADD COLUMN dni TEXT;
ALTER TABLE signatures ADD COLUMN dni TEXT;
