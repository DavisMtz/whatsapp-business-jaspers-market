-- Fase 2: multimedia (R2) y etiquetas por contacto.

-- media_id: id de Meta (sirve ~30 días para volver a descargar).
-- media_key: llave del objeto en R2 (NULL mientras no se ha descargado).
ALTER TABLE messages ADD COLUMN media_id      TEXT;
ALTER TABLE messages ADD COLUMN media_key     TEXT;
ALTER TABLE messages ADD COLUMN media_mime    TEXT;
ALTER TABLE messages ADD COLUMN media_size    INTEGER;
ALTER TABLE messages ADD COLUMN media_name    TEXT;
ALTER TABLE messages ADD COLUMN caption       TEXT;

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE contact_tags (
  wa_id  TEXT    NOT NULL REFERENCES contacts(wa_id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (wa_id, tag_id)
);
CREATE INDEX contact_tags_tag ON contact_tags(tag_id);
