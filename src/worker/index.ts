// Agente Logidma — Worker (API + webhook). El frontend (React) se sirve desde /dist.
//
//   GET/POST /webhook          Meta (público; POST firmado con APP_SECRET)
//   POST     /api/auth/login   Inicio de sesión
//   *        /api/*            Requiere sesión

import { Hono } from "hono";
import { accountRoutes, authRoutes, requireSession, sameOrigin } from "./auth";
import type { AppEnv, Env } from "./env";
import { saveMessage, WINDOW_MS } from "./store";
import { receiveWebhook, verifyWebhook } from "./webhook";

const app = new Hono<AppEnv>();

app.get("/webhook", verifyWebhook);
app.post("/webhook", receiveWebhook);

const api = new Hono<AppEnv>();
api.use("*", sameOrigin);
api.route("/auth", authRoutes);
api.use("*", requireSession);
api.route("/account", accountRoutes);

// ── Conversaciones ───────────────────────────────────────────

api.get("/conversations", async c => {
  const status = c.req.query("status") === "archived" ? "archived" : "open";
  const q = (c.req.query("q") ?? "").trim();
  const like = `%${q}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT cv.id, cv.wa_id, cv.status, cv.unread_count, cv.last_message_at, cv.last_preview,
            cv.last_direction, cv.last_inbound_at, ct.profile_name, ct.custom_name
     FROM conversations cv JOIN contacts ct ON ct.wa_id = cv.wa_id
     WHERE cv.status = ?1 AND (?2 = '' OR cv.wa_id LIKE ?3 OR ct.profile_name LIKE ?3 OR ct.custom_name LIKE ?3)
     ORDER BY cv.last_message_at DESC LIMIT 200`
  )
    .bind(status, q, like)
    .all();
  return c.json({ conversations: results, windowMs: WINDOW_MS });
});

api.get("/conversations/:id/messages", async c => {
  const id = Number(c.req.param("id"));
  const before = Number(c.req.query("before")) || Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(
    `SELECT id, wamid, direction, type, body, status, error, created_at
     FROM messages WHERE conversation_id = ? AND created_at < ?
     ORDER BY created_at DESC, id DESC LIMIT 100`
  )
    .bind(id, before)
    .all();
  return c.json({ messages: results.reverse() });
});

api.post("/conversations/:id/read", async c => {
  await c.env.DB.prepare("UPDATE conversations SET unread_count = 0 WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

api.patch("/conversations/:id", async c => {
  const body = await c.req.json().catch(() => ({}));
  if (body.status !== "open" && body.status !== "archived") {
    return c.json({ error: "Estado no válido" }, 400);
  }
  await c.env.DB.prepare("UPDATE conversations SET status = ? WHERE id = ?")
    .bind(body.status, Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});

api.patch("/contacts/:waId", async c => {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.custom_name === "string" ? body.custom_name.trim().slice(0, 80) : null;
  await c.env.DB.prepare("UPDATE contacts SET custom_name = ?, updated_at = ? WHERE wa_id = ?")
    .bind(name || null, Date.now(), c.req.param("waId"))
    .run();
  return c.json({ ok: true });
});

// ── Envío ────────────────────────────────────────────────────

// body: { to, text } o { to, template: { name, language } }
api.post("/messages", async c => {
  const body = await c.req.json().catch(() => ({}));
  const to = String(body.to ?? "").replace(/\D/g, "");
  if (!to) return c.json({ error: "Falta el número destino" }, 400);

  let payload: Record<string, unknown>;
  let preview: string;
  let type: string;
  if (typeof body.text === "string" && body.text.trim()) {
    type = "text";
    preview = body.text.trim();
    payload = { type: "text", text: { body: preview, preview_url: true } };
  } else if (body.template?.name) {
    type = "template";
    preview = `📋 Plantilla: ${body.template.name}`;
    payload = {
      type: "template",
      template: {
        name: String(body.template.name),
        language: { code: String(body.template.language || "es_MX") },
        components: Array.isArray(body.template.components) ? body.template.components : []
      }
    };
  } else {
    return c.json({ error: "Escribe un mensaje o elige una plantilla" }, 400);
  }

  const result = await graphSend(c.env, { messaging_product: "whatsapp", to, ...payload });
  if ("error" in result) return c.json({ error: result.error }, 502);

  const conversationId = await saveMessage(c.env.DB, {
    waId: result.waId ?? to,
    wamid: result.wamid,
    direction: "out",
    type,
    body: preview,
    payload,
    status: "accepted",
    createdAt: Date.now()
  });
  return c.json({ ok: true, conversationId });
});

async function graphSend(
  env: Env,
  payload: Record<string, unknown>
): Promise<{ wamid: string; waId: string | null } | { error: string }> {
  if (!env.ACCESS_TOKEN || !env.PHONE_NUMBER_ID) {
    return { error: "Faltan ACCESS_TOKEN o PHONE_NUMBER_ID en el Worker" };
  }
  const res = await fetch(
    `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error ?? {};
    return { error: e.error_data?.details || e.message || `Error de Meta (${res.status})` };
  }
  return { wamid: data.messages?.[0]?.id ?? null, waId: data.contacts?.[0]?.wa_id ?? null };
}

// ── Estado de la conexión ────────────────────────────────────

api.get("/status", async c => {
  const env = c.env;
  const info: Record<string, unknown> = {
    phoneNumberId: env.PHONE_NUMBER_ID,
    webhookUrl: new URL("/webhook", c.req.url).toString(),
    graphApiVersion: env.GRAPH_API_VERSION,
    accessToken: !!env.ACCESS_TOKEN,
    appSecret: !!env.APP_SECRET,
    verifyToken: !!env.VERIFY_TOKEN
  };
  if (c.req.query("check") && env.ACCESS_TOKEN) {
    const res = await fetch(
      `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.PHONE_NUMBER_ID}` +
        "?fields=display_phone_number,verified_name,quality_rating,name_status",
      { headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}` } }
    );
    const data: any = await res.json().catch(() => ({}));
    info.phone = res.ok ? data : { error: data.error?.message ?? `Error ${res.status}` };
  }
  return c.json(info);
});

api.all("*", c => c.json({ error: "No encontrado" }, 404));

app.route("/api", api);

export default app;
