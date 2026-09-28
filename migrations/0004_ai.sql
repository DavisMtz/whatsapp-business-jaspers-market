-- Fase 4: asistente de IA (respuesta automática, sugerencias y resúmenes).
-- La configuración global vive en settings (key = 'ai_config').

-- ai_mode: auto (sigue la configuración global) | on (activa en este chat) | off (apagada).
ALTER TABLE conversations ADD COLUMN ai_mode           TEXT NOT NULL DEFAULT 'auto';
-- Traspaso a humano: la IA deja de responder hasta que se devuelve el chat.
ALTER TABLE conversations ADD COLUMN ai_handoff_at     INTEGER;
ALTER TABLE conversations ADD COLUMN ai_handoff_reason TEXT;     -- cliente | ia | limite
-- Pausa tras una respuesta manual (la persona tomó la conversación).
ALTER TABLE conversations ADD COLUMN ai_paused_until   INTEGER;
-- Último mensaje entrante que la IA ya atendió (evita responder dos veces).
ALTER TABLE conversations ADD COLUMN ai_replied_to     INTEGER;
ALTER TABLE conversations ADD COLUMN ai_summary        TEXT;
ALTER TABLE conversations ADD COLUMN ai_summary_at     INTEGER;

-- 1 si el mensaje lo escribió y envió la IA.
ALTER TABLE messages ADD COLUMN ai INTEGER NOT NULL DEFAULT 0;

-- Cada llamada al modelo: sirve para límites, costo y métricas (Fase 5).
CREATE TABLE ai_runs (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER,                         -- NULL en pruebas desde Configuración
  kind            TEXT    NOT NULL,                -- reply | suggest | summary | test
  provider        TEXT    NOT NULL,                -- workers-ai | claude
  model           TEXT    NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT,                            -- sent | handoff | skipped | error
  error           TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX ai_runs_recent ON ai_runs(created_at);
