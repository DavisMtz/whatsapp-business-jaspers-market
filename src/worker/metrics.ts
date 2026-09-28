// Métricas: volumen de mensajes, tiempo de respuesta y gasto estimado.
// Todo se calcula al pedirlo, a partir de messages y ai_runs (no hay tablas de resumen).

import { Hono } from "hono";
import { CLAUDE_MODELS } from "./ai";
import type { AppEnv } from "./env";
import { getRates } from "./templates";

const DAY_MS = 24 * 60 * 60 * 1000;
// Tope de filas por consulta: sobra para una bandeja de una persona y protege al Worker.
const MAX_ROWS = 50000;

// Desde el 1 de octubre de 2026 Meta cobra las respuestas de servicio a la tarifa de
// utilidad, con 1,000 gratis al mes por número. Medianoche en la Ciudad de México (UTC-6).
export const SERVICE_BILLING_FROM = Date.UTC(2026, 9, 1, 6);
export const SERVICE_FREE_PER_MONTH = 1000;

type Row = { conversation_id: number; direction: "in" | "out"; ai: number; type: string; created_at: number };

// offset: minutos al oeste de UTC, como Date.getTimezoneOffset() del navegador (México: 360).
function localDay(ms: number, offset: number) {
  return new Date(ms - offset * 60000).toISOString().slice(0, 10);
}

function monthStart(ms: number, offset: number, back: number) {
  const d = new Date(ms - offset * 60000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) + offset * 60000;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarize(times: number[]) {
  const s = [...times].sort((a, b) => a - b);
  return {
    count: s.length,
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    within5m: s.length ? s.filter(t => t <= 5 * 60000).length / s.length : null
  };
}

async function spendForMonth(db: D1Database, from: number, to: number, rates: Record<string, any>) {
  // Meta cobra lo entregado: se cuentan los mensajes en delivered o read.
  const { results: templates } = await db
    .prepare(
      `SELECT COALESCE(t.category, 'UTILITY') AS category, count(*) AS n
       FROM messages m
       LEFT JOIN templates t ON t.name = json_extract(m.payload, '$.template.name')
                            AND t.language = json_extract(m.payload, '$.template.language.code')
       WHERE m.direction = 'out' AND m.type = 'template' AND m.status IN ('delivered', 'read')
         AND m.created_at >= ?1 AND m.created_at < ?2
       GROUP BY 1`
    )
    .bind(from, to)
    .all<{ category: string; n: number }>();

  const service = await db
    .prepare(
      `SELECT count(*) AS n FROM messages
       WHERE direction = 'out' AND type != 'template' AND status IN ('delivered', 'read')
         AND created_at >= ?1 AND created_at < ?2`
    )
    .bind(Math.max(from, SERVICE_BILLING_FROM), to)
    .first<{ n: number }>();

  const { results: runs } = await db
    .prepare(
      `SELECT model, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
       FROM ai_runs WHERE provider = 'claude' AND created_at >= ?1 AND created_at < ?2 GROUP BY model`
    )
    .bind(from, to)
    .all<{ model: string; input_tokens: number; output_tokens: number }>();

  const byCategory = templates.map(t => ({ category: t.category, count: t.n, cost: t.n * (Number(rates[t.category]) || 0) }));
  const serviceBilled = to > SERVICE_BILLING_FROM;
  const serviceCount = serviceBilled ? service?.n ?? 0 : 0;
  const billable = Math.max(0, serviceCount - SERVICE_FREE_PER_MONTH);
  const serviceCost = billable * (Number(rates.UTILITY) || 0);
  const aiUsd = runs.reduce((sum, r) => {
    const price = CLAUDE_MODELS.find(m => m.id === r.model);
    return sum + (price ? (r.input_tokens * price.input + r.output_tokens * price.output) / 1e6 : 0);
  }, 0);

  return {
    templates: byCategory,
    service: { billed: serviceBilled, count: serviceCount, free: SERVICE_FREE_PER_MONTH, billable, cost: serviceCost },
    whatsappTotal: byCategory.reduce((s, t) => s + t.cost, 0) + serviceCost,
    aiUsd
  };
}

export const metricsRoutes = new Hono<AppEnv>();

// GET /api/metrics?days=7|30|90&tz=<minutos al oeste de UTC>
metricsRoutes.get("/", async c => {
  const db = c.env.DB;
  const days = [7, 30, 90].includes(Number(c.req.query("days"))) ? Number(c.req.query("days")) : 30;
  const tz = Number(c.req.query("tz"));
  const offset = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 360;
  const now = Date.now();
  // El periodo empieza a medianoche local: "7 días" son hoy y los 6 anteriores.
  const today = Date.parse(localDay(now, offset)) + offset * 60000;
  const from = today - (days - 1) * DAY_MS;

  const [{ results: rows }, newContacts, waiting, rates] = await Promise.all([
    db
      .prepare(
        `SELECT conversation_id, direction, ai, type, created_at FROM messages
         WHERE created_at >= ? ORDER BY conversation_id, created_at, id LIMIT ${MAX_ROWS}`
      )
      .bind(from)
      .all<Row>(),
    db.prepare("SELECT count(*) AS n FROM contacts WHERE created_at >= ?").bind(from).first<{ n: number }>(),
    db
      .prepare(
        `SELECT count(*) AS n, min(last_message_at) AS oldest FROM conversations
         WHERE status = 'open' AND last_direction = 'in'`
      )
      .first<{ n: number; oldest: number | null }>(),
    getRates(db)
  ]);

  // Volumen por día (todos los días del periodo, aunque no haya mensajes).
  const daily = new Map<string, { day: string; inbound: number; outbound: number; ai: number }>();
  for (let i = 0; i < days; i++) {
    const day = localDay(from + i * DAY_MS + 12 * 3600000, offset);
    daily.set(day, { day, inbound: 0, outbound: 0, ai: 0 });
  }
  const totals = { inbound: 0, outbound: 0, ai: 0, templates: 0, conversations: 0 };
  const human: number[] = [];
  const bot: number[] = [];
  let conv = -1;
  let waitingSince: number | null = null;
  for (const m of rows) {
    if (m.conversation_id !== conv) {
      conv = m.conversation_id;
      waitingSince = null;
      totals.conversations++;
    }
    const d = daily.get(localDay(m.created_at, offset));
    if (m.direction === "in") {
      totals.inbound++;
      if (d) d.inbound++;
      // El tiempo de respuesta se mide desde el primer mensaje sin contestar.
      waitingSince ??= m.created_at;
    } else {
      totals.outbound++;
      if (d) d.outbound++;
      if (m.ai) {
        totals.ai++;
        if (d) d.ai++;
      }
      if (m.type === "template") totals.templates++;
      if (waitingSince !== null) {
        (m.ai ? bot : human).push(m.created_at - waitingSince);
        waitingSince = null;
      }
    }
  }

  const months = await Promise.all(
    [0, 1].map(async back => {
      const start = monthStart(now, offset, back);
      const end = back === 0 ? now + 1 : monthStart(now, offset, back - 1);
      return { month: localDay(start, offset).slice(0, 7), ...(await spendForMonth(db, start, end, rates)) };
    })
  );

  return c.json({
    days,
    from,
    truncated: rows.length >= MAX_ROWS,
    totals: { ...totals, newContacts: newContacts?.n ?? 0 },
    daily: [...daily.values()],
    response: { all: summarize([...human, ...bot]), human: summarize(human), ai: summarize(bot) },
    waiting: { count: waiting?.n ?? 0, oldest: waiting?.oldest ?? null },
    spend: { currency: rates.currency, rates, months }
  });
});
