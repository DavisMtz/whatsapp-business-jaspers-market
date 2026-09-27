import type { RealtimeHub } from "./realtime";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // Multimedia recibida y enviada (bucket agente-logidma-media).
  MEDIA: R2Bucket;
  // Durable Object con los WebSocket del panel.
  HUB: DurableObjectNamespace<RealtimeHub>;

  // Variables (wrangler.jsonc)
  PHONE_NUMBER_ID: string;
  GRAPH_API_VERSION: string;

  // Secretos (wrangler secret put)
  ACCESS_TOKEN: string;
  APP_SECRET: string;
  VERIFY_TOKEN: string;
  ADMIN_EMAIL: string;
  // Contraseña inicial: solo se usa para crear el usuario la primera vez.
  DASHBOARD_PASSWORD: string;
}

export type Session = { userId: number; email: string; sessionId: string };

export type AppEnv = { Bindings: Env; Variables: { session: Session } };
