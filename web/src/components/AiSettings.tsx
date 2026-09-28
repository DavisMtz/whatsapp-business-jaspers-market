import { useEffect, useState, type FormEvent } from "react";
import { api, type AiConfig } from "../api";
import Icon from "./Icon";

type Model = { id: string; label: string; input?: number; output?: number };
type Usage = {
  kind: string;
  provider: string;
  model: string;
  runs: number;
  input_tokens: number;
  output_tokens: number;
  sent: number;
  handoffs: number;
  errors: number;
  cost: number;
};
type ConfigResponse = {
  config: AiConfig;
  providers: Record<AiConfig["provider"], boolean>;
  models: Record<AiConfig["provider"], Model[]>;
  usage: Usage[];
};

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const KIND_LABEL: Record<string, string> = {
  reply: "Respuestas automáticas",
  suggest: "Sugerencias",
  summary: "Resúmenes",
  test: "Pruebas"
};

// Configuración → IA: proveedor, respuesta automática, instrucciones, horario, límites y traspaso.
export default function AiSettings({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [keywords, setKeywords] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<ConfigResponse>("/ai/config")
      .then(r => {
        setData(r);
        setCfg(r.config);
        setKeywords(r.config.handoffKeywords.join(", "));
      })
      .catch(onError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data || !cfg) {
    return (
      <section className="card">
        <h3>Asistente de IA</h3>
        <p className="muted">Cargando…</p>
      </section>
    );
  }

  const set = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => setCfg({ ...cfg, [key]: value });
  const setSchedule = (patch: Partial<AiConfig["schedule"]>) => setCfg({ ...cfg, schedule: { ...cfg.schedule, ...patch } });
  const current = { ...cfg, handoffKeywords: keywords.split(",").map(k => k.trim()).filter(Boolean) };
  const ready = data.providers[cfg.provider];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ config: AiConfig }>("/ai/config", { method: "PUT", body: current });
      setCfg(r.config);
      setKeywords(r.config.handoffKeywords.join(", "));
      setMsg({ type: "success", text: "Configuración de IA guardada." });
    } catch (err) {
      onError(err);
      setMsg({ type: "error", text: err instanceof Error ? err.message : "No se pudo guardar" });
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (d: number) =>
    setSchedule({ days: cfg.schedule.days.includes(d) ? cfg.schedule.days.filter(x => x !== d) : [...cfg.schedule.days, d].sort() });

  return (
    <section className="card ai-settings">
      <h3>Asistente de IA</h3>
      <p className="muted">
        Contesta por el negocio solo dentro de la ventana de 24 h, con tus instrucciones y tu base de conocimiento.
        WhatsApp no permite asistentes de propósito general: la IA solo habla de temas de {cfg.businessName || "tu negocio"}.
      </p>

      <form className="ai-form" onSubmit={save}>
        <fieldset>
          <legend>Proveedor</legend>
          <div className="segmented">
            <button type="button" className={cfg.provider === "workers-ai" ? "active" : ""} onClick={() => set("provider", "workers-ai")}>
              Workers AI
            </button>
            <button type="button" className={cfg.provider === "claude" ? "active" : ""} onClick={() => set("provider", "claude")}>
              Claude API
            </button>
          </div>
          {cfg.provider === "workers-ai" ? (
            <label>
              Modelo
              <select value={cfg.workersModel} onChange={e => set("workersModel", e.target.value)}>
                {data.models["workers-ai"].map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="hint">Incluido en Cloudflare: 10,000 neuronas gratis al día.</span>
            </label>
          ) : (
            <label>
              Modelo
              <select value={cfg.claudeModel} onChange={e => set("claudeModel", e.target.value)}>
                {data.models.claude.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} · US${m.input} / US${m.output} por millón de tokens
                  </option>
                ))}
              </select>
              <span className="hint">Se cobra en tu cuenta de Anthropic.</span>
            </label>
          )}
          {!ready && (
            <div className="alert error">
              {cfg.provider === "claude"
                ? "Falta el secreto ANTHROPIC_API_KEY en el Worker. Cárgalo en Cloudflare (no aquí)."
                : "Falta el binding AI de Workers AI en el Worker."}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Respuesta automática</legend>
          <label className="check">
            <input type="checkbox" checked={cfg.autoReply} onChange={e => set("autoReply", e.target.checked)} />
            Responder automáticamente en todos los chats
          </label>
          <span className="hint">
            También puedes activarla o apagarla en un chat en particular desde el botón <Icon name="info" size={15} className="inline-icon" /> del chat.
          </span>
        </fieldset>

        <fieldset>
          <legend>Negocio</legend>
          <label>
            Nombre del negocio
            <input value={cfg.businessName} onChange={e => set("businessName", e.target.value)} maxLength={80} />
          </label>
          <label>
            Instrucciones
            <textarea
              rows={5}
              value={cfg.instructions}
              onChange={e => set("instructions", e.target.value)}
              maxLength={4000}
              placeholder="Tono, qué puede ofrecer, qué datos pedir al cliente (nombre, dirección, pedido), cuándo pasar el chat a una persona…"
            />
          </label>
          <label>
            Base de conocimiento
            <textarea
              rows={10}
              value={cfg.knowledge}
              onChange={e => set("knowledge", e.target.value)}
              maxLength={30000}
              placeholder="Servicios, precios, horarios, zonas de cobertura, formas de pago, preguntas frecuentes…"
            />
            <span className="hint">{cfg.knowledge.length.toLocaleString("es-MX")} / 30,000 caracteres</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Horario de respuesta automática</legend>
          <select value={cfg.schedule.mode} onChange={e => setSchedule({ mode: e.target.value as AiConfig["schedule"]["mode"] })}>
            <option value="always">Siempre</option>
            <option value="inside">Solo en el horario de abajo</option>
            <option value="outside">Solo fuera del horario de abajo (cuando no hay nadie)</option>
          </select>
          {cfg.schedule.mode !== "always" && (
            <>
              <div className="day-picker">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} className={cfg.schedule.days.includes(i) ? "active" : ""} onClick={() => toggleDay(i)}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="row">
                <label>
                  De
                  <input type="time" value={cfg.schedule.start} onChange={e => setSchedule({ start: e.target.value })} />
                </label>
                <label>
                  A
                  <input type="time" value={cfg.schedule.end} onChange={e => setSchedule({ end: e.target.value })} />
                </label>
              </div>
              <span className="hint">Hora de {cfg.schedule.timezone.replace("_", " ")}.</span>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Límites y traspaso a humano</legend>
          <div className="row">
            <label>
              Respuestas por chat en 24 h
              <input type="number" min={1} max={100} value={cfg.maxPerChat} onChange={e => set("maxPerChat", Number(e.target.value))} />
            </label>
            <label>
              Pausa tras responder tú (min)
              <input
                type="number"
                min={0}
                max={1440}
                value={cfg.humanPauseMinutes}
                onChange={e => set("humanPauseMinutes", Number(e.target.value))}
              />
            </label>
          </div>
          <span className="hint">
            Al llegar al límite, el chat pasa a ti. Si respondes a mano, la IA se calla en ese chat el tiempo indicado (0 = no se pausa).
          </span>
          <label>
            Palabras que piden a una persona (separadas por coma)
            <input value={keywords} onChange={e => setKeywords(e.target.value)} />
          </label>
          <label>
            Mensaje al pasar el chat a una persona
            <textarea rows={2} value={cfg.handoffMessage} onChange={e => set("handoffMessage", e.target.value)} maxLength={500} />
            <span className="hint">
              La IA también pasa el chat cuando no sabe la respuesta, hay una queja o un pago. Déjalo vacío para no avisar al cliente.
            </span>
          </label>
        </fieldset>

        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </form>

      <AiTester config={current} ready={ready} onError={onError} onDone={load} />
      <AiUsage usage={data.usage} />
    </section>
  );
}

type TestTurn = { role: "user" | "assistant"; content: string; handoff?: boolean };

// Conversación de prueba con la configuración que está en pantalla (aunque no se haya guardado).
function AiTester({ config, ready, onError, onDone }: { config: AiConfig; ready: boolean; onError: (e: unknown) => void; onDone: () => void }) {
  const [turns, setTurns] = useState<TestTurn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const next: TestTurn[] = [...turns, { role: "user", content: text.trim() }];
    setTurns(next);
    setText("");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ text: string; handoff: string | null }>("/ai/test", {
        body: { config, messages: next.map(({ role, content }) => ({ role, content })) }
      });
      setTurns([...next, { role: "assistant", content: r.text || "(sin mensaje)", handoff: !!r.handoff }]);
      onDone();
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "No se pudo probar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-tester">
      <h4>Probar el asistente</h4>
      <p className="muted small">Escribe como si fueras un cliente. No se envía nada por WhatsApp.</p>
      {turns.length > 0 && (
        <div className="ai-tester-log">
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role === "user" ? "in" : "out"}`}>
              <div className="bubble-text">{t.content}</div>
              {t.handoff && <div className="bubble-meta">Pasaría el chat a una persona</div>}
            </div>
          ))}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <form className="composer-row" onSubmit={send}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Ej. ¿Cuánto cuesta un envío a Morelia?" disabled={!ready} />
        <button className="btn primary" disabled={busy || !ready || !text.trim()}>
          {busy ? "…" : "Probar"}
        </button>
        {turns.length > 0 && (
          <button type="button" className="btn" onClick={() => setTurns([])}>
            Reiniciar
          </button>
        )}
      </form>
    </div>
  );
}

function AiUsage({ usage }: { usage: Usage[] }) {
  if (!usage.length) return null;
  const total = usage.reduce((s, u) => s + u.cost, 0);
  const n = (v: number) => (v ?? 0).toLocaleString("es-MX");
  return (
    <div className="ai-usage">
      <h4>Uso de los últimos 30 días</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Uso</th>
              <th>Modelo</th>
              <th>Llamadas</th>
              <th>Tokens (entrada / salida)</th>
              <th>Costo estimado</th>
            </tr>
          </thead>
          <tbody>
            {usage.map(u => (
              <tr key={`${u.kind}-${u.model}`}>
                <td>
                  {KIND_LABEL[u.kind] ?? u.kind}
                  {u.kind === "reply" && (
                    <span className="muted small">
                      {" "}
                      · {n(u.sent)} enviadas, {n(u.handoffs)} traspasos
                    </span>
                  )}
                  {u.errors > 0 && <span className="muted small"> · {n(u.errors)} con error</span>}
                </td>
                <td className="mono small">{u.model.replace("@cf/", "")}</td>
                <td>{n(u.runs)}</td>
                <td>
                  {n(u.input_tokens)} / {n(u.output_tokens)}
                </td>
                <td>{u.provider === "claude" ? `US$${u.cost.toFixed(4)}` : "Incluido"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 0 && <p className="muted small">Total estimado en Claude: US${total.toFixed(2)} (sin descuentos de caché).</p>}
    </div>
  );
}
