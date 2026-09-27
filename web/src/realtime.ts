// Conexión WebSocket con el Worker para enterarse de mensajes nuevos al instante.
// Si se cae, se reconecta sola; mientras tanto, las pantallas vuelven al polling.

import { useEffect, useRef, useState } from "react";

export type RealtimeEvent =
  | { type: "message"; conversationId: number }
  | { type: "conversation"; conversationId: number | null }
  | { type: "templates" }
  | { type: "resync" };

type Listener = (e: RealtimeEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let socket: WebSocket | null = null;
let connected = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function setConnected(v: boolean) {
  connected = v;
  statusListeners.forEach(l => l(v));
}

function emit(e: RealtimeEvent) {
  listeners.forEach(l => l(e));
}

function open() {
  clearTimeout(retryTimer);
  if (socket || listeners.size === 0) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  socket = ws;
  ws.onopen = () => {
    retries = 0;
    setConnected(true);
    // Pudo haber cambios mientras no había conexión.
    emit({ type: "resync" });
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
  };
  ws.onmessage = e => {
    if (e.data === "pong") return;
    try {
      emit(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = () => {
    if (socket !== ws) return; // conexión vieja que ya se reemplazó
    clearInterval(pingTimer);
    socket = null;
    setConnected(false);
    if (listeners.size > 0) {
      retryTimer = setTimeout(open, Math.min(30000, 1000 * 2 ** retries++));
    }
  };
}

function close() {
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  const ws = socket;
  socket = null;
  ws?.close();
  setConnected(false);
}

// Al volver a la app (iPad suspende las pestañas), reconecta sin esperar el reintento.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket && listeners.size > 0) {
      retries = 0;
      open();
    }
  });
}

// La conexión se abre al montar y se cierra al salir; cambiar `listener` no reconecta.
export function useRealtime(listener: Listener): boolean {
  const [isConnected, setIsConnected] = useState(connected);
  const current = useRef(listener);
  current.current = listener;
  useEffect(() => {
    const l: Listener = e => current.current(e);
    listeners.add(l);
    statusListeners.add(setIsConnected);
    open();
    return () => {
      listeners.delete(l);
      statusListeners.delete(setIsConnected);
      if (listeners.size === 0) close();
    };
  }, []);
  return isConnected;
}
