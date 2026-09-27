-- Fase 1: usuario, sesiones, chats y mensajes.
-- Fechas en milisegundos desde epoch (UTC).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- id = SHA-256 del token de la cookie (el token nunca se guarda en claro).
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Intentos fallidos de login por IP y por correo.
CREATE TABLE login_attempts (
  key          TEXT    PRIMARY KEY,
  failures     INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE contacts (
  wa_id        TEXT PRIMARY KEY,
  profile_name TEXT,
  custom_name  TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY,
  wa_id           TEXT    NOT NULL UNIQUE REFERENCES contacts(wa_id),
  status          TEXT    NOT NULL DEFAULT 'open',  -- open | archived
  unread_count    INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  last_preview    TEXT,
  last_direction  TEXT,
  last_inbound_at INTEGER,                          -- abre la ventana de 24 h
  created_at      INTEGER NOT NULL
);
CREATE INDEX conversations_recent ON conversations(status, last_message_at DESC);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  wamid           TEXT    UNIQUE,
  direction       TEXT    NOT NULL,                 -- in | out
  type            TEXT    NOT NULL,
  body            TEXT,
  payload         TEXT,                             -- JSON original de Meta
  status          TEXT    NOT NULL,                 -- received | accepted | sent | delivered | read | failed
  error           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at DESC);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                         -- JSON
  updated_at INTEGER NOT NULL
);
