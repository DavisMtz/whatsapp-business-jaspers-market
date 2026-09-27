import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, upload } from "../api";
import TemplatePreview from "../components/TemplatePreview";
import { useRealtime } from "../realtime";
import {
  buildTemplate,
  CATEGORY_LABEL,
  draftFrom,
  draftPreview,
  EMPTY_DRAFT,
  estimatedCost,
  languageLabel,
  LANGUAGES,
  part,
  QUALITY,
  REJECTION,
  STATUS,
  varsIn,
  type Draft,
  type HeaderFormat,
  type Rates,
  type Template
} from "../templates";

const EDITABLE = ["APPROVED", "REJECTED", "PAUSED"];

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "off" };
  return <span className={`status-badge ${s.tone}`}>{s.label}</span>;
}

export default function Templates({ onError }: { onError: (e: unknown) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "APPROVED" | "PENDING" | "REJECTED">("all");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (sync = false) => {
      if (sync) setSyncing(true);
      try {
        const r = await api<{ templates: Template[]; rates: Rates; syncError: string | null }>(
          `/templates${sync ? "?sync=1" : ""}`
        );
        setTemplates(r.templates);
        setRates(r.rates);
        setError(r.syncError ? `No se pudo actualizar desde Meta: ${r.syncError}` : "");
      } catch (e) {
        onError(e);
        setError(e instanceof Error ? e.message : "No se pudieron cargar las plantillas");
      } finally {
        setSyncing(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const connected = useRealtime(e => {
    if (e.type === "templates" || e.type === "resync") load();
  });

  // Sin tiempo real, se consulta a Meta cada minuto mientras haya plantillas en revisión.
  const pending = templates?.some(t => t.status === "PENDING" || t.status === "IN_APPEAL");
  useEffect(() => {
    if (connected || !pending) return;
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [connected, pending, load]);

  const shown = useMemo(
    () =>
      (templates ?? []).filter(t =>
        filter === "all" ? true : filter === "PENDING" ? t.status === "PENDING" || t.status === "IN_APPEAL" : t.status === filter
      ),
    [templates, filter]
  );

  const remove = async (t: Template) => {
    if (!confirm(`¿Borrar la plantilla "${t.name}" (${languageLabel(t.language)})? No se puede deshacer y Meta no deja reutilizar el nombre durante 30 días.`)) return;
    try {
      await api(`/templates/${t.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      onError(e);
      setError(e instanceof Error ? e.message : "No se pudo borrar");
    }
  };

  if (editing) {
    return (
      <Editor
        template={editing === "new" ? null : editing}
        rates={rates}
        onClose={saved => {
          setEditing(null);
          if (saved) load();
        }}
        onError={onError}
      />
    );
  }

  return (
    <div className="page wide">
      <header className="page-header row-between">
        <h2>Plantillas</h2>
        <div className="row">
          <button className="btn" onClick={() => load(true)} disabled={syncing}>
            {syncing ? "Actualizando…" : "Actualizar"}
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            Nueva plantilla
          </button>
        </div>
      </header>
      {error && <div className="alert error">{error}</div>}

      <div className="segmented">
        {(
          [
            ["all", "Todas"],
            ["APPROVED", "Aprobadas"],
            ["PENDING", "En revisión"],
            ["REJECTED", "Rechazadas"]
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {templates === null ? (
        <p className="muted">Cargando…</p>
      ) : shown.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📋</div>
          <h3>{templates.length ? "Nada en este filtro" : "Aún no tienes plantillas"}</h3>
          <p className="muted">
            Las plantillas son mensajes aprobados por Meta. Son la única forma de escribirle a alguien que no te ha
            mandado mensaje en las últimas 24 h.
          </p>
          {!templates.length && (
            <button className="btn primary" onClick={() => setEditing("new")}>
              Crear la primera
            </button>
          )}
        </div>
      ) : (
        <div className="tpl-grid">
          {shown.map(t => (
            <article key={t.id} className="card tpl-card">
              <div className="tpl-card-top">
                <div>
                  <strong className="mono">{t.name}</strong>
                  <div className="muted small">
                    {languageLabel(t.language)} · {CATEGORY_LABEL[t.category] ?? t.category}
                    {t.quality && t.quality !== "UNKNOWN" && ` · Calidad ${QUALITY[t.quality] ?? t.quality}`}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </div>
              {t.status === "REJECTED" && (
                <div className="alert error small">
                  {REJECTION[t.rejected_reason ?? ""] ?? t.rejected_reason ?? "Meta rechazó la plantilla."} Puedes editarla y
                  mandarla de nuevo a revisión.
                </div>
              )}
              <p className="tpl-snippet">{part(t, "BODY")?.text}</p>
              <div className="tpl-card-bottom">
                <span className="muted small">{estimatedCost(rates, t.category)}</span>
                <div className="row">
                  {EDITABLE.includes(t.status) && t.category !== "AUTHENTICATION" && (
                    <button className="btn small" onClick={() => setEditing(t)}>
                      Editar
                    </button>
                  )}
                  <button className="btn small danger" onClick={() => remove(t)}>
                    Borrar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {rates && <RatesCard rates={rates} onSaved={setRates} onError={onError} />}
    </div>
  );
}

function slug(v: string) {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 512);
}

const HEADER_ACCEPT: Record<string, string> = {
  IMAGE: "image/jpeg,image/png",
  VIDEO: "video/mp4",
  DOCUMENT: "application/pdf"
};

function Editor({
  template,
  rates,
  onClose,
  onError
}: {
  template: Template | null;
  rates: Rates | null;
  onClose: (saved: boolean) => void;
  onError: (e: unknown) => void;
}) {
  const [d, setD] = useState<Draft>(() => (template ? draftFrom(template) : EMPTY_DRAFT));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; name: string } | null>(null);
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));
  const approved = template?.status === "APPROVED";

  useEffect(() => () => { if (mediaPreview) URL.revokeObjectURL(mediaPreview.url); }, [mediaPreview]);

  const headerVars = d.headerFormat === "TEXT" ? varsIn(d.headerText) : [];
  const bodyVars = varsIn(d.body);
  const nextVar = () => {
    const all = [...headerVars, ...bodyVars];
    if (all.length && all.every(k => !/^\d+$/.test(k))) return "{{variable}}";
    return `{{${bodyVars.filter(k => /^\d+$/.test(k)).length + 1}}}`;
  };

  const pickMedia = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const r = await upload<{ handle: string }>("/templates/example", form);
      set({ headerHandle: r.handle });
      setMediaPreview({ url: URL.createObjectURL(file), name: file.name });
    } catch (e) {
      onError(e);
      setError(e instanceof Error ? e.message : "No se pudo subir el ejemplo");
    } finally {
      setUploading(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const built = buildTemplate(d);
    if ("error" in built) return setError(built.error);
    setBusy(true);
    try {
      if (template) {
        const { components, category } = built.body as { components: unknown; category: string };
        await api(`/templates/${template.id}`, {
          method: "PUT",
          body: approved ? { components } : { components, category }
        });
      } else {
        await api("/templates", { body: built.body });
      }
      onClose(true);
    } catch (err) {
      onError(err);
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      setBusy(false);
    }
  };

  const updateButton = (i: number, patch: Partial<Draft["buttons"][number]>) =>
    set({ buttons: d.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const count = (type: string) => d.buttons.filter(b => b.type === type).length;

  return (
    <div className="page wide">
      <header className="page-header row-between">
        <h2>{template ? `Editar ${template.name}` : "Nueva plantilla"}</h2>
        <button className="btn" onClick={() => onClose(false)} disabled={busy}>
          Cancelar
        </button>
      </header>
      <div className="tpl-editor">
        <form className="card tpl-form" onSubmit={save}>
          {template && (
            <p className="muted small">
              Al guardar, la plantilla vuelve a revisión de Meta. Las aprobadas se pueden editar una vez al día y hasta 10
              veces al mes; el nombre y el idioma no cambian.
            </p>
          )}
          <div className="form-row">
            <label>
              Nombre
              <input
                value={d.name}
                onChange={e => set({ name: slug(e.target.value) })}
                placeholder="confirmacion_pedido"
                disabled={!!template}
                required
              />
            </label>
            <label>
              Idioma
              <select value={d.language} onChange={e => set({ language: e.target.value })} disabled={!!template}>
                {LANGUAGES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Categoría
            <select
              value={d.category}
              onChange={e => set({ category: e.target.value as Draft["category"] })}
              disabled={approved}
            >
              <option value="UTILITY">Utilidad — avisos de un pedido, cita o cuenta</option>
              <option value="MARKETING">Marketing — promociones, ofertas, novedades</option>
            </select>
            <span className="hint">
              {estimatedCost(rates, d.category)}. Si el contenido es promocional, Meta la cambia a Marketing.
            </span>
          </label>

          <fieldset>
            <legend>Encabezado (opcional)</legend>
            <select
              value={d.headerFormat}
              onChange={e => {
                set({ headerFormat: e.target.value as HeaderFormat, headerHandle: null, headerExample: null });
                setMediaPreview(null);
              }}
            >
              <option value="NONE">Sin encabezado</option>
              <option value="TEXT">Texto</option>
              <option value="IMAGE">Imagen</option>
              <option value="VIDEO">Video</option>
              <option value="DOCUMENT">Documento PDF</option>
            </select>
            {d.headerFormat === "TEXT" && (
              <input
                value={d.headerText}
                onChange={e => set({ headerText: e.target.value })}
                maxLength={60}
                placeholder="Tu pedido está listo"
              />
            )}
            {d.headerFormat !== "NONE" && d.headerFormat !== "TEXT" && (
              <label className="file-pick">
                <span className="hint">
                  {d.headerHandle
                    ? `Ejemplo listo: ${mediaPreview?.name ?? "archivo"}`
                    : d.headerExample
                      ? "Se conserva el ejemplo actual. Sube otro si quieres cambiarlo."
                      : "Sube un archivo de ejemplo para que Meta lo revise. Al enviar podrás usar otro."}
                </span>
                <input
                  type="file"
                  accept={HEADER_ACCEPT[d.headerFormat]}
                  disabled={uploading}
                  onChange={e => {
                    pickMedia(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {uploading && <span className="hint">Subiendo…</span>}
              </label>
            )}
            {headerVars.map(k => (
              <label key={k}>
                Ejemplo para {`{{${k}}}`} del encabezado
                <input
                  value={d.headerExamples[k] ?? ""}
                  onChange={e => set({ headerExamples: { ...d.headerExamples, [k]: e.target.value } })}
                />
              </label>
            ))}
          </fieldset>

          <label>
            Mensaje
            <textarea
              className="tpl-body-input"
              value={d.body}
              onChange={e => set({ body: e.target.value })}
              maxLength={1024}
              placeholder={"Hola {{1}}, tu pedido {{2}} ya va en camino."}
              required
            />
            <span className="hint row-between">
              <span>
                Usa *negritas*, _cursivas_ y variables como {"{{1}}"} o {"{{nombre}}"}.{" "}
                <button type="button" className="link" onClick={() => set({ body: `${d.body}${nextVar()}` })}>
                  Agregar variable
                </button>
              </span>
              <span>{d.body.length}/1024</span>
            </span>
          </label>
          {bodyVars.length > 0 && (
            <fieldset>
              <legend>Ejemplos de las variables</legend>
              <p className="hint">Meta los usa para revisar la plantilla; no se envían a nadie.</p>
              {bodyVars.map(k => (
                <label key={k}>
                  {`{{${k}}}`}
                  <input
                    value={d.examples[k] ?? ""}
                    onChange={e => set({ examples: { ...d.examples, [k]: e.target.value } })}
                    placeholder={k === "1" ? "Ej. María" : "Ej."}
                  />
                </label>
              ))}
            </fieldset>
          )}

          <label>
            Pie de página (opcional)
            <input value={d.footer} onChange={e => set({ footer: e.target.value })} maxLength={60} placeholder="Logidma" />
          </label>

          <fieldset>
            <legend>Botones (opcional)</legend>
            {d.buttons.map((b, i) => (
              <div key={i} className="tpl-button-edit">
                <div className="form-row">
                  <select
                    value={b.type}
                    onChange={e => updateButton(i, { type: e.target.value as typeof b.type })}
                  >
                    <option value="QUICK_REPLY">Respuesta rápida</option>
                    <option value="URL" disabled={b.type !== "URL" && count("URL") >= 2}>
                      Abrir enlace
                    </option>
                    <option value="PHONE_NUMBER" disabled={b.type !== "PHONE_NUMBER" && count("PHONE_NUMBER") >= 1}>
                      Llamar
                    </option>
                  </select>
                  <input
                    value={b.text}
                    onChange={e => updateButton(i, { text: e.target.value })}
                    maxLength={25}
                    placeholder="Texto del botón"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title="Quitar botón"
                    onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
                {b.type === "URL" && (
                  <div className="form-row">
                    <input
                      value={b.url}
                      onChange={e => updateButton(i, { url: e.target.value.trim() })}
                      placeholder="https://logidma.com/pedido/{{1}}"
                      inputMode="url"
                    />
                    {varsIn(b.url).length > 0 && (
                      <input
                        value={b.example}
                        onChange={e => updateButton(i, { example: e.target.value })}
                        placeholder="Ejemplo de {{1}}"
                      />
                    )}
                  </div>
                )}
                {b.type === "PHONE_NUMBER" && (
                  <input
                    value={b.phone}
                    onChange={e => updateButton(i, { phone: e.target.value })}
                    placeholder="+52 443 848 0153"
                    inputMode="tel"
                  />
                )}
              </div>
            ))}
            {d.buttons.length < 10 && (
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  set({ buttons: [...d.buttons, { type: "QUICK_REPLY", text: "", url: "", phone: "", example: "" }] })
                }
              >
                Agregar botón
              </button>
            )}
          </fieldset>

          {error && <div className="alert error">{error}</div>}
          <button className="btn primary" disabled={busy || uploading}>
            {busy ? "Enviando a revisión…" : template ? "Guardar y mandar a revisión" : "Mandar a revisión"}
          </button>
        </form>

        <aside className="tpl-side">
          <h3 className="small muted">Vista previa</h3>
          <div className="tpl-phone">
            <TemplatePreview
              template={draftPreview(d)}
              values={d.examples}
              headerValues={d.headerExamples}
              mediaUrl={mediaPreview?.url}
              mediaName={mediaPreview?.name}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function RatesCard({ rates, onSaved, onError }: { rates: Rates; onSaved: (r: Rates) => void; onError: (e: unknown) => void }) {
  const [form, setForm] = useState(rates);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ rates: Rates }>("/templates/rates", { method: "PUT", body: form });
      onSaved(r.rates);
      setMsg({ type: "success", text: "Tarifas guardadas" });
    } catch (err) {
      onError(err);
      setMsg({ type: "error", text: err instanceof Error ? err.message : "No se pudo guardar" });
    }
  };

  return (
    <form className="card" onSubmit={save}>
      <h3>Tarifas para el costo estimado</h3>
      <p className="muted small">
        Meta cobra cada plantilla entregada según su categoría y el país del cliente. Estos valores (México) solo sirven
        para el estimado; revisa los vigentes en la{" "}
        <a href="https://developers.facebook.com/docs/whatsapp/pricing" target="_blank" rel="noreferrer">
          tabla de precios de Meta
        </a>
        .
      </p>
      <div className="form-row rates">
        {(["MARKETING", "UTILITY", "AUTHENTICATION"] as const).map(k => (
          <label key={k}>
            {CATEGORY_LABEL[k]}
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form[k]}
              onChange={e => setForm({ ...form, [k]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label>
          Moneda
          <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
          </select>
        </label>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      <div>
        <button className="btn">Guardar tarifas</button>
      </div>
    </form>
  );
}
