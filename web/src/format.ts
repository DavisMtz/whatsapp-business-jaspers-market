import type { Conversation } from "./api";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function displayName(c: Pick<Conversation, "custom_name" | "profile_name" | "wa_id">): string {
  return c.custom_name || c.profile_name || formatPhone(c.wa_id);
}

export function formatPhone(waId: string): string {
  // 521XXXXXXXXXX (México) → +52 1 XXX XXX XXXX
  const m = waId.match(/^(52)(1?)(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+${m[1]}${m[2] ? " " + m[2] : ""} ${m[3]} ${m[4]} ${m[5]}`;
  return `+${waId}`;
}

export function formatListTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

// Tiempo restante de la ventana de 24 h (null si está cerrada).
export function windowRemaining(lastInboundAt: number | null, now = Date.now()): number | null {
  if (!lastInboundAt) return null;
  const left = lastInboundAt + WINDOW_MS - now;
  return left > 0 ? left : null;
}

export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
