import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { useRealtime } from "../realtime";

type Summary = { count: number; median: number | null; p90: number | null; within5m: number | null };

type MonthSpend = {
  month: string;
  templates: { category: string; count: number; cost: number }[];
  service: { billed: boolean; count: number; free: number; billable: number; cost: number };
  whatsappTotal: number;
  aiUsd: number;
};

type Data = {
  days: number;
  truncated: boolean;
  totals: { inbound: number; outbound: number; ai: number; templates: number; conversations: number; newContacts: number };
  daily: { day: string; inbound: number; outbound: number; ai: number }[];
  response: { all: Summary; human: Summary; ai: Summary };
  waiting: { count: number; oldest: number | null };
  spend: { currency: string; months: MonthSpend[] };
};

const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidad", AUTHENTICATION: "Autenticación" };

const num = (n: number) => n.toLocaleString("es-MX");

function money(v: number, currency: string) {
  const symbol = currency === "USD" ? "US$" : currency === "MXN" ? "MX$" : `${currency} `;
  return `${symbol}${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: v && v < 0.1 ? 4 : 2 })}`;
}

function duration(ms: number | null) {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shortDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function Metrics({ onError }: { onError: (e: unknown) => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(() => {
    const tz = new Date().getTimezoneOffset();
    api<Data>(`/metrics?days=${days}&tz=${tz}`).then(setData).catch(onError);
  }, [days, onError]);

  useEffect(load, [load]);

  // Los mensajes nuevos cambian los números: se recarga, como mucho, cada 10 s.
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useRealtime(e => {
    if (e.type !== "message" || pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      load();
    }, 10000);
  });
  useEffect(() => () => clearTimeout(pending.current), []);

  return (
    <div className="page metrics">
      <header className="page-header">
        <h2>Métricas</h2>
        <div className="segmented">
          {[7, 30, 90].map(d => (
            <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>
              {d} días
            </button>
          ))}
        </div>
      </header>

      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          {data.truncated && (
            <div className="alert error">Hay demasiados mensajes en el periodo: los números están incompletos. Elige menos días.</div>
          )}
          <div className="stat-grid">
            <Stat label="Mensajes recibidos" value={num(data.totals.inbound)} />
            <Stat
              label="Mensajes enviados"
              value={num(data.totals.outbound)}
              detail={`${num(data.totals.ai)} por la IA · ${num(data.totals.templates)} plantillas`}
            />
            <Stat label="Chats con actividad" value={num(data.totals.conversations)} detail={`${num(data.totals.newContacts)} contactos nuevos`} />
            <Stat
              label="Esperando respuesta"
              value={num(data.waiting.count)}
              detail={data.waiting.oldest ? `El más antiguo, hace ${duration(Date.now() - data.waiting.oldest)}` : "Ninguno pendiente"}
            />
          </div>

          <section className="card">
            <h3>Mensajes por día</h3>
            <VolumeChart daily={data.daily} />
          </section>

          <ResponseCard response={data.response} />
          <SpendCard spend={data.spend} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

// ── Gráfica de barras apiladas: recibidos (abajo) y enviados (arriba) ─────

const H = 200;
const PAD = { top: 8, right: 8, bottom: 22, left: 34 };
const GAP = 2;

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  const n = [1, 2, 2.5, 5, 10].find(f => f * step >= v)!;
  return n * step;
}

// Rectángulo con las esquinas de arriba redondeadas (extremo libre de la barra).
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function VolumeChart({ daily }: { daily: Data["daily"] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const max = niceMax(Math.max(1, ...daily.map(d => d.inbound + d.outbound)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / daily.length;
  const barW = Math.max(1, slot - GAP);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelIdx = new Set([0, Math.floor((daily.length - 1) / 2), daily.length - 1]);
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <div className="viz">
      <div className="viz-top">
        <div className="legend">
          <span><i className="swatch s1" /> Recibidos</span>
          <span><i className="swatch s2" /> Enviados</span>
        </div>
        <button className="btn small" onClick={() => setTable(t => !t)}>
          {table ? "Ver gráfica" : "Ver tabla"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Recibidos</th>
                <th>Enviados</th>
                <th>De ellos, IA</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map(d => (
                <tr key={d.day}>
                  <td>{shortDay(d.day)}</td>
                  <td>{num(d.inbound)}</td>
                  <td>{num(d.outbound)}</td>
                  <td>{num(d.ai)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box" ref={box} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label="Mensajes recibidos y enviados por día">
            {ticks.map(t => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
                  {num(t)}
                </text>
              </g>
            ))}
            {daily.map((d, i) => {
              const x = PAD.left + i * slot + GAP / 2;
              const inH = (d.inbound / max) * plotH;
              const outH = (d.outbound / max) * plotH;
              // 2 px de separación entre segmentos, solo si ambos existen.
              const sep = inH > 0 && outH > 0 ? GAP : 0;
              const base = PAD.top + plotH;
              return (
                <g key={d.day} className={hover !== null && hover !== i ? "dim" : ""}>
                  {inH > 0 &&
                    (outH > 0 ? (
                      <rect className="s1" x={x} y={base - inH} width={barW} height={Math.max(0, inH - sep / 2)} />
                    ) : (
                      <path className="s1" d={topRounded(x, base - inH, barW, inH, 4)} />
                    ))}
                  {outH > 0 && <path className="s2" d={topRounded(x, base - inH - outH, barW, Math.max(0.5, outH - sep / 2), 4)} />}
                  {labelIdx.has(i) && (
                    <text
                      className="axis"
                      x={x + barW / 2}
                      y={H - 6}
                      textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"}
                    >
                      {shortDay(d.day)}
                    </text>
                  )}
                  <rect
                    className="hit"
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    onMouseEnter={() => setHover(i)}
                    onClick={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: Math.min(width - 150, Math.max(0, PAD.left + hover * slot + slot / 2 - 75)),
                top: 0
              }}
            >
              <strong>{shortDay(hovered.day)}</strong>
              <span><i className="swatch s1" /> Recibidos <b>{num(hovered.inbound)}</b></span>
              <span><i className="swatch s2" /> Enviados <b>{num(hovered.outbound)}</b></span>
              {hovered.ai > 0 && <span className="muted">De ellos, IA: {num(hovered.ai)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResponseCard({ response }: { response: Data["response"] }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const rows: [string, Summary][] = [
    ["Tú", response.human],
    ["IA", response.ai]
  ];
  return (
    <section className="card">
      <h3>Tiempo de respuesta</h3>
      <p className="muted">
        Desde el primer mensaje del cliente sin contestar hasta la siguiente respuesta (tuya, de la IA o una plantilla).
      </p>
      <div className="stat-grid">
        <Stat label="Mediana" value={duration(response.all.median)} detail="La mitad se contestó en menos" />
        <Stat label="9 de cada 10" value={duration(response.all.p90)} detail="se contestaron en menos de esto" />
        <Stat label="En menos de 5 min" value={pct(response.all.within5m)} detail={`de ${num(response.all.count)} respuestas`} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Quién respondió</th>
              <th>Respuestas</th>
              <th>Mediana</th>
              <th>9 de cada 10</th>
              <th>En menos de 5 min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{num(s.count)}</td>
                <td>{duration(s.median)}</td>
                <td>{duration(s.p90)}</td>
                <td>{pct(s.within5m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SpendCard({ spend }: { spend: Data["spend"] }) {
  const cur = spend.currency;
  return (
    <section className="card">
      <h3>Gasto estimado</h3>
      <p className="muted">
        Por mes calendario, con las tarifas de <a href="#/templates">Plantillas → Tarifas</a>. Solo cuenta mensajes
        entregados. Es una estimación: el cobro real está en la facturación de Meta.
      </p>
      <div className="spend-grid">
        {spend.months.map(m => (
          <div key={m.month} className="spend-month">
            <h4>{monthName(m.month)}</h4>
            <table className="data-table">
              <tbody>
                {m.templates.length === 0 && (
                  <tr>
                    <td>Plantillas</td>
                    <td className="num">0</td>
                    <td className="num">{money(0, cur)}</td>
                  </tr>
                )}
                {m.templates.map(t => (
                  <tr key={t.category}>
                    <td>Plantillas · {CATEGORY[t.category] ?? t.category}</td>
                    <td className="num">{num(t.count)}</td>
                    <td className="num">{money(t.cost, cur)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    Respuestas de servicio
                    <div className="muted small">
                      {m.service.billed
                        ? `${num(m.service.free)} gratis al mes · ${num(m.service.billable)} con costo`
                        : "Gratis hasta el 30 de septiembre de 2026"}
                    </div>
                  </td>
                  <td className="num">{m.service.billed ? num(m.service.count) : "—"}</td>
                  <td className="num">{money(m.service.cost, cur)}</td>
                </tr>
                <tr className="total">
                  <td>Total WhatsApp</td>
                  <td />
                  <td className="num">{money(m.whatsappTotal, cur)}</td>
                </tr>
                <tr>
                  <td>IA · Claude API</td>
                  <td />
                  <td className="num">{money(m.aiUsd, "USD")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="muted small">
        Workers AI no aparece: entra en el plan de Cloudflare mientras no pases las neuronas gratis del día.
      </p>
    </section>
  );
}
