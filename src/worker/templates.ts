// Plantillas: listar, crear, editar y borrar en Meta (/{waba-id}/message_templates),
// con copia en D1 que el webhook mantiene al día (aprobación, categoría y calidad).

import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { graphRequest, uploadHandle } from "./graph";
import { checkOutbound } from "./media";
import { notify } from "./realtime";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const FIELDS = "id,name,language,category,status,components,rejected_reason,quality_score,parameter_format";

// Tarifa aproximada por mensaje entregado a un número de México (US$). Se pueden
// cambiar desde Plantillas → Tarifas; Meta publica las vigentes en su tabla de precios.
export const DEFAULT_RATES = { currency: "USD", MARKETING: 0.0436, UTILITY: 0.008, AUTHENTICATION: 0.0207 };

type Row = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameter_format: string;
  components: string;
  rejected_reason: string | null;
  quality: string | null;
  updated_at: number;
};

function toRow(t: any, now: number): Row {
  return {
    id: String(t.id),
    name: String(t.name),
    language: String(t.language),
    category: String(t.category ?? "UTILITY"),
    status: String(t.status ?? "PENDING"),
    parameter_format: String(t.parameter_format ?? "POSITIONAL"),
    components: JSON.stringify(t.components ?? []),
    rejected_reason: t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : null,
    quality: t.quality_score?.score ?? null,
    updated_at: now
  };
}

function upsert(db: D1Database, r: Row) {
  return db
    .prepare(
      `INSERT INTO templates (id, name, language, category, status, parameter_format, components,
                              rejected_reason, quality, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET
         category = ?4, status = ?5, parameter_format = ?6, components = ?7,
         rejected_reason = ?8, quality = COALESCE(?9, quality), updated_at = ?10`
    )
    .bind(r.id, r.name, r.language, r.category, r.status, r.parameter_format, r.components,
      r.rejected_reason, r.quality, r.updated_at);
}

// Trae todas las plantillas de Meta y deja D1 igual (borra las que ya no existen).
export async function syncTemplates(env: Env): Promise<{ error: string } | null> {
  if (!env.WABA_ID) return { error: "Falta WABA_ID en el Worker" };
  const all: any[] = [];
  let url: string | null = `/${env.WABA_ID}/message_templates?fields=${FIELDS}&limit=100`;
  for (let page = 0; url && page < 20; page++) {
    const res = await graphRequest(env, url);
    if ("error" in res) return res;
    all.push(...(res.data.data ?? []));
    url = res.data.paging?.next ?? null;
  }
  const now = Date.now();
  const db = env.DB;
  const ids = all.map(t => String(t.id));
  await db.batch([
    ...all.map(t => upsert(db, toRow(t, now))),
    db.prepare(`DELETE FROM templates WHERE id NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids))
  ]);
  return null;
}

function parse(r: Row) {
  return { ...r, components: JSON.parse(r.components || "[]") };
}

async function getRates(db: D1Database) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'template_rates'").first<{ value: string }>();
  return row ? { ...DEFAULT_RATES, ...JSON.parse(row.value) } : DEFAULT_RATES;
}

// Valida lo que llega del panel. Meta revisa el contenido a fondo; aquí solo la forma.
function cleanTemplate(body: any, editing: boolean): { error: string } | { data: Record<string, unknown> } {
  if (!Array.isArray(body.components) || !body.components.length) return { error: "Falta el contenido de la plantilla" };
  if (!body.components.some((c: any) => c?.type === "BODY" && typeof c.text === "string" && c.text.trim())) {
    return { error: "El cuerpo del mensaje es obligatorio" };
  }
  const data: Record<string, unknown> = { components: body.components };
  if (body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) return { error: "Categoría no válida" };
    data.category = body.category;
  }
  if (!editing) {
    const name = String(body.name ?? "");
    if (!/^[a-z0-9_]{1,512}$/.test(name)) {
      return { error: "El nombre solo admite minúsculas, números y guiones bajos (_)" };
    }
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(String(body.language ?? ""))) return { error: "Idioma no válido" };
    if (!data.category) return { error: "Elige una categoría" };
    data.name = name;
    data.language = body.language;
    data.parameter_format = body.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
  }
  return { data };
}

export const templateRoutes = new Hono<AppEnv>();

// GET /api/templates[?sync=1] — con sync, primero se trae la lista de Meta.
templateRoutes.get("/", async c => {
  let syncError: string | null = null;
  if (c.req.query("sync")) syncError = (await syncTemplates(c.env))?.error ?? null;
  const { results } = await c.env.DB.prepare("SELECT * FROM templates ORDER BY name, language").all<Row>();
  return c.json({ templates: results.map(parse), rates: await getRates(c.env.DB), syncError });
});

templateRoutes.put("/rates", async c => {
  const body = await c.req.json().catch(() => ({}));
  const rates: Record<string, unknown> = { currency: String(body.currency || "USD").slice(0, 3).toUpperCase() };
  for (const k of CATEGORIES) {
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < 0 || v > 10) return c.json({ error: "Tarifa no válida" }, 400);
    rates[k] = v;
  }
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('template_rates', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`
  )
    .bind(JSON.stringify(rates), Date.now())
    .run();
  return c.json({ rates });
});

// POST /api/templates/example (multipart): file — ejemplo de encabezado multimedia para Meta.
templateRoutes.post("/example", async c => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return c.json({ error: "Elige un archivo" }, 400);
  const checked = checkOutbound(file);
  if ("error" in checked) return c.json({ error: checked.error }, 400);
  if (checked.kind === "audio") return c.json({ error: "El encabezado no puede ser audio" }, 400);
  const res = await uploadHandle(c.env, file, checked.mime, checked.name);
  if ("error" in res) return c.json({ error: res.error }, 502);
  return c.json({ handle: res.handle, kind: checked.kind });
});

templateRoutes.post("/", async c => {
  const clean = cleanTemplate(await c.req.json().catch(() => ({})), false);
  if ("error" in clean) return c.json({ error: clean.error }, 400);
  const res = await graphRequest(c.env, `/${c.env.WABA_ID}/message_templates`, { body: clean.data });
  if ("error" in res) return c.json({ error: res.error }, 502);
  const d = clean.data;
  await upsert(
    c.env.DB,
    toRow({ ...d, id: res.data.id, status: res.data.status, category: res.data.category ?? d.category }, Date.now())
  ).run();
  c.executionCtx.waitUntil(notify(c.env, { type: "templates" }));
  return c.json({ ok: true, id: res.data.id, status: res.data.status });
});

// PUT /api/templates/:id — Meta no deja cambiar nombre ni idioma; la categoría solo si no está aprobada.
templateRoutes.put("/:id", async c => {
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "Plantilla no válida" }, 400);
  const clean = cleanTemplate(await c.req.json().catch(() => ({})), true);
  if ("error" in clean) return c.json({ error: clean.error }, 400);
  const res = await graphRequest(c.env, `/${id}`, { body: clean.data });
  if ("error" in res) return c.json({ error: res.error }, 502);
  // Tras editarla, vuelve a revisión. Se trae el estado real de Meta.
  const fresh = await graphRequest(c.env, `/${id}?fields=${FIELDS}`);
  if (!("error" in fresh)) await upsert(c.env.DB, toRow(fresh.data, Date.now())).run();
  c.executionCtx.waitUntil(notify(c.env, { type: "templates" }));
  return c.json({ ok: true });
});

templateRoutes.delete("/:id", async c => {
  const row = await c.env.DB.prepare("SELECT id, name FROM templates WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: "Plantilla no encontrada" }, 404);
  const qs = new URLSearchParams({ hsm_id: row.id, name: row.name });
  const res = await graphRequest(c.env, `/${c.env.WABA_ID}/message_templates?${qs}`, { method: "DELETE" });
  if ("error" in res) return c.json({ error: res.error }, 502);
  await c.env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(row.id).run();
  c.executionCtx.waitUntil(notify(c.env, { type: "templates" }));
  return c.json({ ok: true });
});

// ── Webhook ──────────────────────────────────────────────────

export const TEMPLATE_FIELDS = [
  "message_template_status_update",
  "template_category_update",
  "message_template_quality_update"
];

// Aplica un cambio del webhook. Si la plantilla no está en D1 (se creó en otro lado), sincroniza todo.
export async function applyTemplateChange(env: Env, field: string, v: any): Promise<void> {
  const id = String(v.message_template_id ?? "");
  if (!id) return;
  const db = env.DB;
  const now = Date.now();
  let changes = 0;
  if (field === "message_template_status_update") {
    if (v.event === "DELETED") {
      await db.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
      return;
    }
    const reason = v.event === "REJECTED" && v.reason && v.reason !== "NONE" ? String(v.reason) : null;
    const r = await db.prepare("UPDATE templates SET status = ?, rejected_reason = ?, updated_at = ? WHERE id = ?")
      .bind(String(v.event), reason, now, id)
      .run();
    changes = r.meta.changes;
  } else if (field === "template_category_update" && v.new_category) {
    const r = await db.prepare("UPDATE templates SET category = ?, updated_at = ? WHERE id = ?")
      .bind(String(v.new_category), now, id)
      .run();
    changes = r.meta.changes;
  } else if (field === "message_template_quality_update" && v.new_quality_score) {
    const r = await db.prepare("UPDATE templates SET quality = ?, updated_at = ? WHERE id = ?")
      .bind(String(v.new_quality_score), now, id)
      .run();
    changes = r.meta.changes;
  }
  if (!changes) {
    const err = await syncTemplates(env);
    if (err) console.error("No se pudieron sincronizar las plantillas:", err.error);
  }
}

// ── Envío ────────────────────────────────────────────────────

// Texto legible de una plantilla enviada, con las variables ya sustituidas.
export async function templatePreview(db: D1Database, name: string, language: string, components: any[]): Promise<string> {
  const row = await db.prepare("SELECT components FROM templates WHERE name = ? AND language = ?")
    .bind(name, language)
    .first<{ components: string }>();
  const body = row ? JSON.parse(row.components).find((c: any) => c.type === "BODY")?.text : null;
  if (typeof body !== "string") return `📋 Plantilla: ${name}`;
  const params: any[] = components.find(c => c?.type === "body")?.parameters ?? [];
  const text = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, key: string) => {
    const p = /^\d+$/.test(key) ? params[Number(key) - 1] : params.find(x => x?.parameter_name === key);
    return typeof p?.text === "string" ? p.text : m;
  });
  return `📋 ${text}`;
}
