-- Fase 5: respuestas rápidas (se insertan escribiendo / en el chat).

CREATE TABLE quick_replies (
  id         INTEGER PRIMARY KEY,
  shortcut   TEXT    NOT NULL UNIQUE COLLATE NOCASE,  -- sin la diagonal: "horario"
  text       TEXT    NOT NULL,                        -- admite {nombre}
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Métricas: mensajes por fecha sin recorrer toda la tabla.
CREATE INDEX messages_recent ON messages(created_at);
