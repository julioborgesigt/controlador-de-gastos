CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cpf TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE sessions ADD COLUMN user_id TEXT;
