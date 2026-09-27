// Agente Logidma — Cloudflare Worker
//
// Rutas:
//   GET  /webhook            Handshake de verificación de Meta (público)
//   POST /webhook            Mensajes entrantes de WhatsApp (público, firmado por Meta)
//   GET  /api/messages       Historial para el panel          (protegido)
//   POST /api/send           Enviar texto                     (protegido)
//   POST /api/send-template  Enviar plantilla aprobada        (protegido)
//   GET  /api/config         Estado de la configuración       (protegido)
//   GET  /privacidad, /terminos, /eliminacion-datos  Páginas legales (públicas)
//   *                        Panel estático en /public        (protegido)
//
// Variables (wrangler.jsonc / panel de Cloudflare):
//   PHONE_NUMBER_ID, GRAPH_API_VERSION
// Secretos (wrangler secret put / panel de Cloudflare):
//   ACCESS_TOKEN, APP_SECRET, VERIFY_TOKEN, DASHBOARD_PASSWORD

import { DurableObject } from "cloudflare:workers";

const MAX_MESSAGES = 200;
const PUBLIC_PAGES = new Set(["/privacidad", "/terminos", "/eliminacion-datos"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook") {
      if (request.method === "GET") return verifyWebhook(url, env);
      if (request.method === "POST") return receiveWebhook(request, env);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Páginas legales que Meta exige para publicar la app: sin contraseña.
    if (PUBLIC_PAGES.has(url.pathname.replace(/\.html$/, ""))) {
      return env.ASSETS.fetch(request);
    }

    const denied = checkDashboardAuth(request, env);
    if (denied) return denied;

    if (url.pathname.startsWith("/api/")) return handleApi(request, url, env);

    return env.ASSETS.fetch(request);
  }
};

// ── Webhook ──────────────────────────────────────────────────

function verifyWebhook(url, env) {
  const params = url.searchParams;
  if (
    !env.VERIFY_TOKEN ||
    params.get("hub.mode") !== "subscribe" ||
    params.get("hub.verify_token") !== env.VERIFY_TOKEN
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(params.get("hub.challenge") || "", { status: 200 });
}

async function receiveWebhook(request, env) {
  const raw = await request.text();

  if (!env.APP_SECRET) {
    console.error("APP_SECRET no configurado: se rechaza el webhook");
    return new Response("Server not configured", { status: 500 });
  }
  const signature = request.headers.get("X-Hub-Signature-256") || "";
  if (!(await isValidSignature(raw, signature, env.APP_SECRET))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (body.object === "whatsapp_business_account") {
    const incoming = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const msg of change.value?.messages || []) {
          incoming.push({
            direction: "incoming",
            from: msg.from,
            text: msg.text?.body || `[${msg.type}]`,
            timestamp: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
          });
        }
      }
    }
    if (incoming.length) await store(env).add(incoming);
  }

  return new Response("OK", { status: 200 });
}

async function isValidSignature(payload, header, secret) {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = new TextEncoder().encode(
    "sha256=" + [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("")
  );
  const received = new TextEncoder().encode(header);
  if (expected.byteLength !== received.byteLength) return false;
  return crypto.subtle.timingSafeEqual(expected, received);
}

// ── Panel ────────────────────────────────────────────────────

function checkDashboardAuth(request, env) {
  if (!env.DASHBOARD_PASSWORD) {
    return new Response("Configura el secreto DASHBOARD_PASSWORD para usar el panel.", {
      status: 503
    });
  }
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {}
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(password, env.DASHBOARD_PASSWORD)) return null;
  }
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Agente Logidma", charset="UTF-8"' }
  });
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

async function handleApi(request, url, env) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/messages") {
    return Response.json(await store(env).list());
  }

  if (route === "GET /api/config") {
    const token = env.ACCESS_TOKEN;
    return Response.json({
      "Phone Number ID": env.PHONE_NUMBER_ID || "–",
      "Verify Token": env.VERIFY_TOKEN || "No configurado",
      "Token de acceso": token ? `...${token.slice(-6)}` : "No configurado",
      "App Secret": env.APP_SECRET ? "Configurado" : "No configurado",
      "Versión Graph API": env.GRAPH_API_VERSION
    });
  }

  if (route === "POST /api/send") {
    const { to, message } = await request.json().catch(() => ({}));
    if (!to || !message) return jsonError("Faltan campos: to, message", 400);
    return sendAndRecord(env, to, message, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message }
    });
  }

  if (route === "POST /api/send-template") {
    const { to, templateName, languageCode, components } = await request
      .json()
      .catch(() => ({}));
    if (!to || !templateName) return jsonError("Faltan campos: to, templateName", 400);
    return sendAndRecord(env, to, `[Template: ${templateName}]`, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode || "es_MX" },
        components: components || []
      }
    });
  }

  return jsonError("Not Found", 404);
}

async function sendAndRecord(env, to, text, payload) {
  if (!env.ACCESS_TOKEN || !env.PHONE_NUMBER_ID) {
    return jsonError("Faltan ACCESS_TOKEN o PHONE_NUMBER_ID en el Worker", 500);
  }
  const res = await fetch(
    `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return jsonError(data.error?.message || `API error ${res.status}`, 502);
  }
  await store(env).add([
    { direction: "outgoing", to, text, timestamp: new Date().toISOString() }
  ]);
  return Response.json({ success: true, result: data });
}

function jsonError(error, status) {
  return Response.json({ error }, { status });
}

// ── Almacenamiento (Durable Object con SQLite) ───────────────

function store(env) {
  return env.MESSAGES.get(env.MESSAGES.idFromName("default"));
}

export class MessageStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL
    )`);
  }

  add(messages) {
    for (const m of messages) {
      this.sql.exec("INSERT INTO messages (data) VALUES (?)", JSON.stringify(m));
    }
    this.sql.exec(
      "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)",
      MAX_MESSAGES
    );
  }

  list() {
    return this.sql
      .exec("SELECT data FROM messages ORDER BY id DESC")
      .toArray()
      .map(row => JSON.parse(row.data));
  }
}
