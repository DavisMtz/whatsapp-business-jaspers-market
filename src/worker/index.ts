// Agente Logidma — Worker (API + webhook). El frontend (React) se sirve desde /dist.
//
//   GET/POST /webhook          Meta (público; POST firmado con APP_SECRET)
//   POST     /api/auth/login   Inicio de sesión
//   GET      /api/ws           WebSocket de avisos en tiempo real
//   *        /api/*            Requiere sesión

import { Hono } from "hono";
import { aiRoutes, getAiConfig, pauseAfterHuman } from "./ai";
import { accountRoutes, authRoutes, requireSession, sameOrigin } from "./auth";
import { contactRoutes, tagRoutes } from "./contacts";
import type { AppEnv } from "./env";
import { graphSend } from "./graph";
import { mediaRoutes } from "./media";
import { metricsRoutes } from "./metrics";
import { quickReplyRoutes } from "./quickReplies";
import { connect, notify } from "./realtime";
import { saveMessage, WINDOW_MS } from "./store";
import { templatePreview, templateRoutes } from "./templates";
import { receiveWebhook, verifyWebhook } from "./webhook";

export { RealtimeHub } from "./realtime";

const app = new Hono<AppEnv>();

app.get("/webhook", verifyWebhook);
app.post("/webhook", receiveWebhook);

const api = new Hono<AppEnv>();
api.use("*", sameOrigin);
api.route("/auth", authRoutes);
api.use("*", requireSession);
api.route("/account", accountRoutes);
api.route("/contacts", contactRoutes);
api.route("/tags", tagRoutes);
api.route("/media", mediaRoutes);
api.route("/templates", templateRoutes);
api.route("/ai", aiRoutes);
api.route("/metrics", metricsRoutes);
api.route("/quick-replies", quickReplyRoutes);

// El navegador no manda Origin falso en un WebSocket: se exige el del propio sitio.
api.get("/ws", async c => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Se esperaba un WebSocket" }, 426);
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "Origen no permitido" }, 403);
  return connect(c.env, c.req.raw);
});

// ── Conversaciones ───────────────────────────────────────────

api.get("/conversations", async c => {
  const status = c.req.query("status") === "archived" ? "archived" : "open";
  const q = (c.req.query("q") ?? "").trim();
  const like = `%${q}%`;
  const tag = Number(c.req.query("tag")) || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT cv.id, cv.wa_id, cv.status, cv.unread_count, cv.last_message_at, cv.last_preview,
            cv.last_direction, cv.last_inbound_at, ct.profile_name, ct.custom_name,
            cv.ai_mode, cv.ai_handoff_at, cv.ai_handoff_reason, cv.ai_paused_until, cv.ai_summary, cv.ai_summary_at,
            (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM contact_tags x JOIN tags t ON t.id = x.tag_id WHERE x.wa_id = cv.wa_id) AS tags
     FROM conversations cv JOIN contacts ct ON ct.wa_id = cv.wa_id
     WHERE cv.status = ?1
       AND (?2 = '' OR cv.wa_id LIKE ?3 OR ct.profile_name LIKE ?3 OR ct.custom_name LIKE ?3 OR ct.notes LIKE ?3)
       AND (?4 = 0 OR EXISTS (SELECT 1 FROM contact_tags x WHERE x.wa_id = cv.wa_id AND x.tag_id = ?4))
     ORDER BY cv.last_message_at DESC LIMIT 200`
  )
    .bind(status, q, like, tag)
    .all<Record<string, unknown> & { tags: string }>();
  const conversations = results.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]") }));
  const ai = await getAiConfig(c.env.DB);
  return c.json({ conversations, windowMs: WINDOW_MS, aiAutoReply: ai.autoReply });
});

// Resumen para notificaciones y el contador del título: no leídos en total y, con ?id, ese chat.
api.get("/inbox", async c => {
  const id = Number(c.req.query("id")) || 0;
  const [unread, conv] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(sum(unread_count), 0) AS n FROM conversations WHERE status = 'open'").first<{ n: number }>(),
    id
      ? c.env.DB.prepare(
          `SELECT cv.id, cv.wa_id, cv.last_preview, cv.last_direction, cv.unread_count, ct.profile_name, ct.custom_name
           FROM conversations cv JOIN contacts ct ON ct.wa_id = cv.wa_id WHERE cv.id = ?`
        )
          .bind(id)
          .first()
      : null
  ]);
  return c.json({ unread: unread?.n ?? 0, conversation: conv ?? null });
});

api.get("/conversations/:id/messages", async c => {
  const id = Number(c.req.param("id"));
  const before = Number(c.req.query("before")) || Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(
    `SELECT id, wamid, direction, type, body, status, error, created_at, caption,
            media_mime, media_size, media_name, ai, (media_key IS NOT NULL OR media_id IS NOT NULL) AS has_media
     FROM messages WHERE conversation_id = ? AND created_at < ?
     ORDER BY created_at DESC, id DESC LIMIT 100`
  )
    .bind(id, before)
    .all();
  return c.json({ messages: results.reverse() });
});

api.post("/conversations/:id/read", async c => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE conversations SET unread_count = 0 WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: id }));
  return c.json({ ok: true });
});

api.patch("/conversations/:id", async c => {
  const body = await c.req.json().catch(() => ({}));
  if (body.status !== "open" && body.status !== "archived") {
    return c.json({ error: "Estado no válido" }, 400);
  }
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("UPDATE conversations SET status = ? WHERE id = ?").bind(body.status, id).run();
  c.executionCtx.waitUntil(notify(c.env, { type: "conversation", conversationId: id }));
  return c.json({ ok: true });
});

// ── Envío ────────────────────────────────────────────────────

// body: { to, text } o { to, template: { name, language, components? } }
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
    const name = String(body.template.name);
    const language = String(body.template.language || "es_MX");
    const components = Array.isArray(body.template.components) ? body.template.components : [];
    preview = await templatePreview(c.env.DB, name, language, components);
    payload = { type: "template", template: { name, language: { code: language }, components } };
  } else {
    return c.json({ error: "Escribe un mensaje o elige una plantilla" }, 400);
  }

  const result = await graphSend(c.env, { to, ...payload });
  if ("error" in result) return c.json({ error: result.error }, 502);

  const saved = await saveMessage(c.env.DB, {
    waId: result.waId ?? to,
    wamid: result.wamid,
    direction: "out",
    type,
    body: preview,
    payload,
    status: "accepted",
    createdAt: Date.now()
  });
  if (saved) {
    c.executionCtx.waitUntil(
      Promise.all([
        pauseAfterHuman(c.env, saved.conversationId),
        notify(c.env, { type: "message", conversationId: saved.conversationId })
      ])
    );
  }
  return c.json({ ok: true, conversationId: saved?.conversationId ?? null });
});

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
