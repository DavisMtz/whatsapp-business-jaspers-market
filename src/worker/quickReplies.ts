// Respuestas rápidas: textos guardados que se insertan escribiendo /atajo en el chat.

import { Hono } from "hono";
import type { AppEnv } from "./env";

export type QuickReply = { id: number; shortcut: string; text: string; uses: number };

// Atajo: letras, números, guion y guion bajo (sin la diagonal inicial).
function clean(body: any): { error: string } | { shortcut: string; text: string } {
  const shortcut = String(body.shortcut ?? "").trim().replace(/^\/+/, "").toLowerCase();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!/^[\p{L}\p{N}_-]{1,30}$/u.test(shortcut)) {
    return { error: "El atajo solo admite letras, números, - y _ (máximo 30, sin espacios)" };
  }
  if (!text) return { error: "Escribe el texto de la respuesta" };
  if (text.length > 4096) return { error: "WhatsApp admite hasta 4,096 caracteres por mensaje" };
  return { shortcut, text };
}

function isDuplicate(e: unknown) {
  return e instanceof Error && e.message.includes("UNIQUE");
}

export const quickReplyRoutes = new Hono<AppEnv>();

// Las más usadas primero: es el orden en que aparecen al escribir /.
quickReplyRoutes.get("/", async c => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, shortcut, text, uses FROM quick_replies ORDER BY uses DESC, shortcut"
  ).all<QuickReply>();
  return c.json({ quickReplies: results });
});

quickReplyRoutes.post("/", async c => {
  const v = clean(await c.req.json().catch(() => ({})));
  if ("error" in v) return c.json({ error: v.error }, 400);
  const now = Date.now();
  try {
    const row = await c.env.DB.prepare(
      "INSERT INTO quick_replies (shortcut, text, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id"
    )
      .bind(v.shortcut, v.text, now, now)
      .first<{ id: number }>();
    return c.json({ ok: true, id: row!.id });
  } catch (e) {
    if (isDuplicate(e)) return c.json({ error: `Ya existe /${v.shortcut}` }, 409);
    throw e;
  }
});

quickReplyRoutes.put("/:id", async c => {
  const v = clean(await c.req.json().catch(() => ({})));
  if ("error" in v) return c.json({ error: v.error }, 400);
  try {
    const r = await c.env.DB.prepare("UPDATE quick_replies SET shortcut = ?, text = ?, updated_at = ? WHERE id = ?")
      .bind(v.shortcut, v.text, Date.now(), Number(c.req.param("id")))
      .run();
    if (!r.meta.changes) return c.json({ error: "Respuesta no encontrada" }, 404);
    return c.json({ ok: true });
  } catch (e) {
    if (isDuplicate(e)) return c.json({ error: `Ya existe /${v.shortcut}` }, 409);
    throw e;
  }
});

quickReplyRoutes.delete("/:id", async c => {
  await c.env.DB.prepare("DELETE FROM quick_replies WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// Se llama al insertarla en el chat, para ordenar por uso.
quickReplyRoutes.post("/:id/used", async c => {
  await c.env.DB.prepare("UPDATE quick_replies SET uses = uses + 1 WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
