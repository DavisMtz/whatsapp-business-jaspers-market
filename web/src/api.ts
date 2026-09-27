export class AuthError extends Error {}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/login")) throw new AuthError(data.error);
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

export type Conversation = {
  id: number;
  wa_id: string;
  status: "open" | "archived";
  unread_count: number;
  last_message_at: number | null;
  last_preview: string | null;
  last_direction: "in" | "out" | null;
  last_inbound_at: number | null;
  profile_name: string | null;
  custom_name: string | null;
  tags: Tag[];
};

export type Tag = { id: number; name: string; color: string };

export type Contact = {
  wa_id: string;
  profile_name: string | null;
  custom_name: string | null;
  notes: string | null;
  created_at: number;
};

export type Message = {
  id: number;
  wamid: string | null;
  direction: "in" | "out";
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  created_at: number;
  caption: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_name: string | null;
  has_media: number;
};

// Envía un formulario multipart (archivos).
export async function upload<T = any>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", body: form });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(data.error);
  if (res.status === 413) throw new Error("El archivo es demasiado grande");
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}
