-- Fase 3: copia local de las plantillas de Meta.
-- La fuente de verdad es Meta; esta tabla se sincroniza al abrir Plantillas
-- y el webhook la actualiza en vivo (aprobación, categoría y calidad).

CREATE TABLE templates (
  id               TEXT    PRIMARY KEY,               -- id de Meta
  name             TEXT    NOT NULL,
  language         TEXT    NOT NULL,
  category         TEXT    NOT NULL,                  -- MARKETING | UTILITY | AUTHENTICATION
  status           TEXT    NOT NULL,                  -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED | ...
  parameter_format TEXT    NOT NULL DEFAULT 'POSITIONAL',
  components       TEXT    NOT NULL,                  -- JSON de Meta
  rejected_reason  TEXT,
  quality          TEXT,                              -- GREEN | YELLOW | RED | UNKNOWN
  updated_at       INTEGER NOT NULL,
  UNIQUE (name, language)
);
CREATE INDEX templates_status ON templates(status, name);
