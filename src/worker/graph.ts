// Llamadas a la Graph API de Meta (envío, multimedia y plantillas).

import type { Env } from "./env";

export function base(env: Env) {
  return `https://graph.facebook.com/${env.GRAPH_API_VERSION}`;
}

export function metaError(data: any, status: number): string {
  const e = data?.error ?? {};
  return e.error_user_msg || e.error_data?.details || e.message || `Error de Meta (${status})`;
}

function missingConfig(env: Env): string | null {
  return !env.ACCESS_TOKEN || !env.PHONE_NUMBER_ID ? "Faltan ACCESS_TOKEN o PHONE_NUMBER_ID en el Worker" : null;
}

export async function graphSend(
  env: Env,
  payload: Record<string, unknown>
): Promise<{ wamid: string; waId: string | null } | { error: string }> {
  const missing = missingConfig(env);
  if (missing) return { error: missing };
  const res = await fetch(`${base(env)}/${env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload })
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) return { error: metaError(data, res.status) };
  return { wamid: data.messages?.[0]?.id ?? null, waId: data.contacts?.[0]?.wa_id ?? null };
}

// Sube un archivo a Meta y devuelve su media_id para enviarlo.
export async function uploadMedia(env: Env, file: Blob, mime: string, name: string): Promise<{ id: string } | { error: string }> {
  const missing = missingConfig(env);
  if (missing) return { error: missing };
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new File([file], name, { type: mime }));
  const res = await fetch(`${base(env)}/${env.PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ACCESS_TOKEN}` },
    body: form
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) return { error: metaError(data, res.status) };
  return { id: String(data.id) };
}

// Descarga un archivo de Meta por su media_id (la URL que da Meta caduca en 5 min).
export async function downloadMedia(
  env: Env,
  mediaId: string
): Promise<{ bytes: ArrayBuffer; mime: string } | { error: string }> {
  const missing = missingConfig(env);
  if (missing) return { error: missing };
  const auth = { Authorization: `Bearer ${env.ACCESS_TOKEN}` };
  const info = await fetch(
    `${base(env)}/${encodeURIComponent(mediaId)}?phone_number_id=${env.PHONE_NUMBER_ID}`,
    { headers: auth }
  );
  const meta: any = await info.json().catch(() => ({}));
  if (!info.ok || !meta.url) return { error: metaError(meta, info.status) };

  const file = await fetch(meta.url, { headers: auth });
  if (!file.ok) return { error: `No se pudo descargar el archivo de Meta (${file.status})` };
  return {
    bytes: await file.arrayBuffer(),
    mime: meta.mime_type || file.headers.get("Content-Type") || "application/octet-stream"
  };
}

// Petición genérica con el token del Worker. `path` empieza con "/".
export async function graphRequest(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ data: any } | { error: string }> {
  if (!env.ACCESS_TOKEN) return { error: "Falta ACCESS_TOKEN en el Worker" };
  const res = await fetch(path.startsWith("https://") ? path : `${base(env)}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${env.ACCESS_TOKEN}`,
      ...(init.body ? { "Content-Type": "application/json" } : {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) return { error: metaError(data, res.status) };
  return { data };
}

// Subida reanudable a la app (sirve para el ejemplo multimedia del encabezado de una plantilla).
// Devuelve el "handle" que Meta pide en example.header_handle.
export async function uploadHandle(env: Env, file: Blob, mime: string, name: string): Promise<{ handle: string } | { error: string }> {
  if (!env.ACCESS_TOKEN || !env.APP_ID) return { error: "Faltan ACCESS_TOKEN o APP_ID en el Worker" };
  const qs = new URLSearchParams({ file_name: name, file_length: String(file.size), file_type: mime });
  const session = await graphRequest(env, `/${env.APP_ID}/uploads?${qs}`, { method: "POST" });
  if ("error" in session) return session;
  const res = await fetch(`${base(env)}/${session.data.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${env.ACCESS_TOKEN}`, file_offset: "0" },
    body: file
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.h) return { error: metaError(data, res.status) };
  return { handle: String(data.h) };
}
