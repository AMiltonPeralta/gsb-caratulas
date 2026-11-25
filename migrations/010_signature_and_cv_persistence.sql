-- Persistencia en base de datos (para sobrevivir reinicios en la nube) de firmas e imágenes/PDF de CV.
ALTER TABLE signatures ADD COLUMN signature_image_data TEXT;
ALTER TABLE candidates ADD COLUMN cv_file_data TEXT;
ALTER TABLE candidates ADD COLUMN cv_mime TEXT;
