// Acceso a D1 para contactos, conversaciones y mensajes.

export const WINDOW_MS = 24 * 60 * 60 * 1000;

const STATUS_RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

export type NewMessage = {
  waId: string;
  profileName?: string | null;
  wamid: string | null;
  direction: "in" | "out";
  type: string;
  body: string;
  payload: unknown;
  status: string;
  createdAt: number;
  caption?: string | null;
  media?: { id: string | null; key?: string | null; mime: string; size?: number | null; name?: string | null } | null;
  // Escrito y enviado por la IA.
  ai?: boolean;
};

export type Saved = { conversationId: number; messageId: number };

// Guarda un mensaje y actualiza su contacto y conversación. Ignora duplicados (mismo wamid).
export async function saveMessage(db: D1Database, m: NewMessage): Promise<Saved | null> {
  const now = Date.now();
  const preview = m.body.slice(0, 120);
  const inbound = m.direction === "in";

  if (m.wamid) {
    const dup = await db.prepare("SELECT id FROM messages WHERE wamid = ?").bind(m.wamid).first();
    if (dup) return null;
  }

  const [, conv] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO contacts (wa_id, profile_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(wa_id) DO UPDATE SET
           profile_name = COALESCE(?2, profile_name), updated_at = ?3`
      )
      .bind(m.waId, m.profileName ?? null, now),
    db
      .prepare(
        `INSERT INTO conversations
           (wa_id, status, unread_count, last_message_at, last_preview, last_direction, last_inbound_at, created_at)
         VALUES (?1, 'open', ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(wa_id) DO UPDATE SET
           status          = CASE WHEN ?5 = 'in' THEN 'open' ELSE status END,
           unread_count    = unread_count + ?2,
           last_message_at = max(COALESCE(last_message_at, 0), ?3),
           last_preview    = CASE WHEN ?3 >= COALESCE(last_message_at, 0) THEN ?4 ELSE last_preview END,
           last_direction  = CASE WHEN ?3 >= COALESCE(last_message_at, 0) THEN ?5 ELSE last_direction END,
           last_inbound_at = max(COALESCE(last_inbound_at, 0), COALESCE(?6, 0))
         RETURNING id`
      )
      .bind(m.waId, inbound ? 1 : 0, m.createdAt, preview, m.direction, inbound ? m.createdAt : null, now)
  ]);

  const conversationId = conv.results[0].id;
  const row = await db
    .prepare(
      `INSERT INTO messages (conversation_id, wamid, direction, type, body, payload, status, created_at,
                             caption, media_id, media_key, media_mime, media_size, media_name, ai)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    )
    .bind(
      conversationId,
      m.wamid,
      m.direction,
      m.type,
      m.body,
      JSON.stringify(m.payload ?? null),
      m.status,
      m.createdAt,
      m.caption ?? null,
      m.media?.id ?? null,
      m.media?.key ?? null,
      m.media?.mime ?? null,
      m.media?.size ?? null,
      m.media?.name ?? null,
      m.ai ? 1 : 0
    )
    .first<{ id: number }>();
  return { conversationId, messageId: row!.id };
}

// Actualiza el estado de un mensaje saliente sin retroceder (p. ej. "read" no vuelve a "delivered").
// Devuelve la conversación si hubo cambio.
export async function updateStatus(
  db: D1Database,
  wamid: string,
  status: string,
  error: string | null
): Promise<number | null> {
  if (status === "failed") {
    const row = await db
      .prepare("UPDATE messages SET status = 'failed', error = ? WHERE wamid = ? RETURNING conversation_id")
      .bind(error, wamid)
      .first<{ conversation_id: number }>();
    return row?.conversation_id ?? null;
  }
  const rank = STATUS_RANK[status];
  if (rank === undefined) return null;
  const row = await db
    .prepare(
      `UPDATE messages SET status = ?1 WHERE wamid = ?2 AND status != 'failed' AND
         (CASE status WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
                      WHEN 'read' THEN 3 ELSE -1 END) < ?3
       RETURNING conversation_id`
    )
    .bind(status, wamid, rank)
    .first<{ conversation_id: number }>();
  return row?.conversation_id ?? null;
}
