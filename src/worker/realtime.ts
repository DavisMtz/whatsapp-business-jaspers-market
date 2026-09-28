// Tiempo real: un solo Durable Object mantiene los WebSocket abiertos del panel
// (con hibernación, así no cobra mientras nadie escribe) y les avisa de cambios.
// Los avisos solo llevan ids: el navegador vuelve a pedir los datos por la API con su sesión.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// inbound: llegó un mensaje del cliente (el panel puede mostrar una notificación).
export type RealtimeEvent =
  | { type: "message"; conversationId: number; inbound?: boolean }
  | { type: "conversation"; conversationId: number | null }
  | { type: "templates" };

export class RealtimeHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Responde el "ping" del navegador sin despertar al objeto.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se esperaba un WebSocket", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(event: RealtimeEvent): Promise<void> {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // Conexión cerrada: la limpia el runtime.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, "Adiós");
    } catch {}
  }
}

function hub(env: Env) {
  return env.HUB.get(env.HUB.idFromName("inbox"));
}

// Avisa a los paneles abiertos. Nunca debe tumbar la petición que lo llama.
export async function notify(env: Env, event: RealtimeEvent): Promise<void> {
  try {
    await hub(env).broadcast(event);
  } catch (e) {
    console.error("No se pudo avisar en tiempo real", e);
  }
}

export function connect(env: Env, request: Request): Promise<Response> {
  return hub(env).fetch(request);
}
