-- Migración 008: Tabla de usuarios, autoría de candidatos y borrador de autoguardado

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  password_plain TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO users (username, password_plain, full_name, role, created_at)
VALUES 
  ('yohita', 'yohita2026', 'Yohita', 'admin', datetime('now')),
  ('yoha', 'yohita2026', 'Yoha', 'admin', datetime('now')),
  ('admin', 'yohita2026', 'Administrador', 'admin', datetime('now')),
  ('milton', 'yohita2026', 'Milton', 'admin', datetime('now'));

-- Columnas adicionales para sesiones y candidatos
ALTER TABLE admin_sessions ADD COLUMN username TEXT;
ALTER TABLE admin_sessions ADD COLUMN user_name TEXT;
ALTER TABLE candidates ADD COLUMN created_by TEXT DEFAULT 'yohita';
ALTER TABLE candidates ADD COLUMN draft_data_json TEXT;
