// Avisos de mensajes nuevos: notificación del navegador y contador en el título de la pestaña.
// La preferencia se guarda por dispositivo (localStorage): en el iPad puede estar activa y en la
// computadora no, o al revés.

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { displayName } from "./format";
import { useRealtime, type RealtimeEvent } from "./realtime";

const PREF_KEY = "agente-logidma.notificaciones";
const BASE_TITLE = "Agente Logidma";

// Chat abierto en pantalla: si llega un mensaje suyo y la ventana tiene el foco, no se avisa.
let activeConversation: number | null = null;
export function setActiveConversation(id: number | null) {
  activeConversation = id;
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled() {
  try {
    return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return false;
  }
}

export function setNotificationsPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {}
}

type InboxSummary = {
  unread: number;
  conversation: {
    id: number;
    wa_id: string;
    last_preview: string | null;
    last_direction: "in" | "out" | null;
    profile_name: string | null;
    custom_name: string | null;
  } | null;
};

function show(c: NonNullable<InboxSummary["conversation"]>) {
  try {
    const n = new Notification(displayName(c), {
      body: c.last_preview ?? "Mensaje nuevo",
      tag: `chat-${c.id}`, // un aviso por chat: los mensajes seguidos lo reemplazan
      icon: "/icon.svg"
    });
    n.onclick = () => {
      window.focus();
      location.hash = `#/chats/${c.id}`;
      n.close();
    };
  } catch {
    // Safari en iPad solo permite notificaciones en la app agregada a la pantalla de inicio.
  }
}

// Se monta una vez en App: mantiene el WebSocket abierto en cualquier página.
export function useInboxAlerts(onError: (e: unknown) => void) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(
    async (notifyId?: number) => {
      try {
        const r = await api<InboxSummary>(`/inbox${notifyId ? `?id=${notifyId}` : ""}`);
        setUnread(r.unread);
        const c = r.conversation;
        const focused = document.visibilityState === "visible" && document.hasFocus();
        if (c && c.last_direction === "in" && notificationsEnabled() && !(focused && activeConversation === c.id)) {
          show(c);
        }
      } catch (e) {
        onError(e);
      }
    },
    [onError]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const live = useRealtime((e: RealtimeEvent) => {
    if (e.type === "message" && e.inbound) refresh(e.conversationId);
    else if (e.type !== "templates") refresh();
  });

  // Sin WebSocket, el contador se actualiza cada minuto.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 60000);
    return () => clearInterval(t);
  }, [live, refresh]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unread]);
}
