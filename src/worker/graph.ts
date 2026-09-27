// Llamadas a la Graph API de Meta (envío y multimedia).

import type { Env } from "./env";

function base(env: Env) {
  return `https://graph.facebook.com/${env.GRAPH_API_VERSION}`;
}

function metaError(data: any, status: number): string {
  const e = data?.error ?? {};
  return e.error_data?.details || e.message || `Error de Meta (${status})`;
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
