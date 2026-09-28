// Respuestas rápidas: menú que aparece al escribir / en el chat.

import { useEffect, useState } from "react";
import { api } from "../api";

export type QuickReply = { id: number; shortcut: string; text: string; uses: number };

// Copia compartida: se pide una vez y se refresca al editarlas en Configuración.
let cache: QuickReply[] | null = null;
const subscribers = new Set<(r: QuickReply[]) => void>();

export async function reloadQuickReplies(): Promise<QuickReply[]> {
  const r = await api<{ quickReplies: QuickReply[] }>("/quick-replies");
  cache = r.quickReplies;
  subscribers.forEach(s => s(r.quickReplies));
  return r.quickReplies;
}

export function useQuickReplies(): QuickReply[] {
  const [list, setList] = useState<QuickReply[]>(cache ?? []);
  useEffect(() => {
    subscribers.add(setList);
    if (!cache) reloadQuickReplies().catch(() => {});
    return () => {
      subscribers.delete(setList);
    };
  }, []);
  return list;
}

// "/hor" → "hor"; null si el texto no es un atajo en curso.
export function quickReplyQuery(text: string): string | null {
  const m = text.match(/^\/([\p{L}\p{N}_-]*)$/u);
  return m ? m[1].toLowerCase() : null;
}

export function filterQuickReplies(list: QuickReply[], query: string): QuickReply[] {
  if (!query) return list.slice(0, 8);
  const starts = list.filter(r => r.shortcut.toLowerCase().startsWith(query));
  const rest = list.filter(r => !starts.includes(r) && (r.shortcut.includes(query) || r.text.toLowerCase().includes(query)));
  return [...starts, ...rest].slice(0, 8);
}

// Sustituye {nombre} por el primer nombre del contacto (o lo quita si no hay).
export function applyQuickReply(text: string, name: string | null): string {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  return text
    .replace(/\{nombre\}/gi, first)
    .replace(/ +([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .replace(/¡ +/g, "¡")
    .replace(/¿ +/g, "¿");
}

export function markUsed(id: number) {
  api(`/quick-replies/${id}/used`, { body: {} }).catch(() => {});
}

export function QuickReplyMenu({
  items,
  active,
  empty,
  onPick,
  onHover
}: {
  items: QuickReply[];
  active: number;
  empty: boolean;
  onPick: (r: QuickReply) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div className="quick-menu" role="listbox" aria-label="Respuestas rápidas">
      {empty ? (
        <div className="quick-empty muted small">
          Aún no tienes respuestas rápidas. Créalas en <a href="#/settings">Configuración</a>.
        </div>
      ) : items.length === 0 ? (
        <div className="quick-empty muted small">Ningún atajo coincide.</div>
      ) : (
        items.map((r, i) => (
          <button
            type="button"
            key={r.id}
            role="option"
            aria-selected={i === active}
            className={`quick-item ${i === active ? "active" : ""}`}
            onMouseEnter={() => onHover(i)}
            // mousedown: evita que el textarea pierda el foco antes de elegir.
            onMouseDown={e => {
              e.preventDefault();
              onPick(r);
            }}
          >
            <strong>/{r.shortcut}</strong>
            <span className="quick-text">{r.text}</span>
          </button>
        ))
      )}
      <div className="quick-hint muted small">↑↓ para moverte · Enter o Tab para usar · Esc para cerrar</div>
    </div>
  );
}
