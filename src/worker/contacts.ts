// Contactos: nombre personalizado, notas y etiquetas.

import { Hono } from "hono";
import type { AppEnv } from "./env";
import { notify } from "./realtime";

export const TAG_COLORS = ["green", "teal", "blue", "purple", "pink", "red", "orange", "yellow", "gray"];

export type Tag = { id: number; name: string; color: string };

function cleanName(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export const contactRoutes = new Hono<AppEnv>();

contactRoutes.get("/:waId", async c => {
  const waId = c.req.param("waId");
  const contact = await c.env.DB.prepare(
    "SELECT wa_id, profile_name, custom_name, notes, created_at FROM contacts WHERE wa_id = ?"
  )
    .bind(waId)
    .first();
  if (!contact) return c.json({ error: "Contacto no encontrado" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.color FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.wa_id = ? ORDER BY t.name`
  )
    .bind(waId)
    .all<Tag>();
  return c.json({ contact, tags: results });
});

// body: { custom_name?, notes? } — solo cambia los campos presentes.
contactRoutes.patch("/:waId", async c => {
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if ("custom_name" in body) {
    sets.push("custom_name = ?");
    values.push(cleanName(body.custom_name, 80));
  }
  if ("notes" in body) {
    sets.push("notes = ?");
    values.push(typeof body.notes === "string" && body.notes.trim() ? body.notes.slice(0, 5000) : null);
  }
  if (!sets.length) return c.json({ error: "Nada que actualizar" }, 400);
  await c.env.DB.prepare(`UPDATE contacts SET ${sets.join(", ")}, updated_at = ? WHERE wa_id = ?`)
    .bind(...values, Date.now(), c.req.param("waId"))
    .run();
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: null }));
  return c.json({ ok: true });
});

// body: { tagIds: number[] } — reemplaza las etiquetas del contacto.
contactRoutes.put("/:waId/tags", async c => {
  const body = await c.req.json().catch(() => ({}));
  const waId = c.req.param("waId");
  const ids: number[] = Array.isArray(body.tagIds)
    ? [...new Set<number>(body.tagIds.map(Number).filter(Number.isInteger))].slice(0, 50)
    : [];
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM contact_tags WHERE wa_id = ?").bind(waId),
    ...ids.map(id =>
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (wa_id, tag_id)
           SELECT ?1, id FROM tags WHERE id = ?2 AND EXISTS (SELECT 1 FROM contacts WHERE wa_id = ?1)`
        )
        .bind(waId, id)
    )
  ]);
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: null }));
  return c.json({ ok: true });
});

export const tagRoutes = new Hono<AppEnv>();

tagRoutes.get("/", async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.color, count(ct.wa_id) AS contacts
     FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
     GROUP BY t.id ORDER BY t.name`
  ).all();
  return c.json({ tags: results, colors: TAG_COLORS });
});

tagRoutes.post("/", async c => {
  const body = await c.req.json().catch(() => ({}));
  const name = cleanName(body.name, 30);
  if (!name) return c.json({ error: "Escribe un nombre para la etiqueta" }, 400);
  const color = TAG_COLORS.includes(body.color) ? body.color : TAG_COLORS[0];
  const tag = await c.env.DB.prepare(
    "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING RETURNING id, name, color"
  )
    .bind(name, color, Date.now())
    .first<Tag>();
  if (!tag) return c.json({ error: "Ya existe una etiqueta con ese nombre" }, 409);
  return c.json({ tag });
});

tagRoutes.patch("/:id", async c => {
  const body = await c.req.json().catch(() => ({}));
  const name = cleanName(body.name, 30);
  const color = TAG_COLORS.includes(body.color) ? body.color : null;
  try {
    await c.env.DB.prepare("UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?")
      .bind(name, color, Number(c.req.param("id")))
      .run();
  } catch {
    return c.json({ error: "Ya existe una etiqueta con ese nombre" }, 409);
  }
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: null }));
  return c.json({ ok: true });
});

tagRoutes.delete("/:id", async c => {
  const id = Number(c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM contact_tags WHERE tag_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(id)
  ]);
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: null }));
  return c.json({ ok: true });
});
