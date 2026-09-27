import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, upload } from "../api";
import {
  CATEGORY_LABEL,
  dynamicButton,
  estimatedCost,
  languageLabel,
  missingValue,
  part,
  sendComponents,
  varsIn,
  type Rates,
  type SendValues,
  type Template
} from "../templates";
import TemplatePreview from "./TemplatePreview";

const EMPTY: SendValues = { header: {}, body: {}, buttons: {}, headerMedia: null };

const ACCEPT: Record<string, string> = { IMAGE: "image/jpeg,image/png", VIDEO: "video/mp4", DOCUMENT: "application/pdf" };

// Elige una plantilla aprobada, llena sus variables y la envía.
export default function TemplateSender({
  to,
  onSent,
  onCancel
}: {
  to: string;
  onSent: (conversationId?: number) => void;
  onCancel?: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<SendValues>(EMPTY);
  const [code, setCode] = useState("");
  const [media, setMedia] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const load = (sync: boolean) =>
      api<{ templates: Template[]; rates: Rates }>(`/templates${sync ? "?sync=1" : ""}`).then(r => {
        setRates(r.rates);
        return r.templates;
      });
    // Si D1 aún no tiene copia (nunca se abrió Plantillas), se trae de Meta.
    load(false)
      .then(list => (list.length ? list : load(true)))
      .then(list => setTemplates(list.filter(t => t.status === "APPROVED")))
      .catch(e => setError(e instanceof Error ? e.message : "No se pudieron cargar las plantillas"));
  }, []);

  useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]);

  const template = useMemo(() => templates?.find(t => t.id === selected) ?? null, [templates, selected]);
  const header = template ? part(template, "HEADER") : undefined;
  const auth = template?.category === "AUTHENTICATION";

  // En autenticación un solo código llena el mensaje y el botón de copiar.
  const effective: SendValues = useMemo(() => {
    if (!template || !auth) return values;
    const body = Object.fromEntries(varsIn(part(template, "BODY")?.text).map(k => [k, code]));
    const buttons = Object.fromEntries((part(template, "BUTTONS")?.buttons ?? []).map((_, i) => [i, code]));
    return { ...values, body, buttons };
  }, [template, auth, values, code]);

  const choose = (id: string) => {
    setSelected(id);
    setValues(EMPTY);
    setCode("");
    setMedia(null);
    setError("");
  };

  const pickMedia = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const r = await upload<{ id: string; name: string }>("/media/upload", form);
      setValues(v => ({ ...v, headerMedia: { id: r.id, name: r.name } }));
      setMedia({ url: URL.createObjectURL(file), name: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el archivo");
    } finally {
      setUploading(false);
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!template) return;
    const missing = missingValue(template, effective);
    if (missing) return setError(missing);
    setBusy(true);
    setError("");
    try {
      const r = await api<{ conversationId: number }>("/messages", {
        body: {
          to,
          template: { name: template.name, language: template.language, components: sendComponents(template, effective) }
        }
      });
      choose("");
      onSent(r.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <label key={label}>
      {label}
      <input value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );

  return (
    <form className="tpl-sender" onSubmit={send}>
      {error && <div className="alert error">{error}</div>}
      <div className="template-form">
        <select value={selected} onChange={e => choose(e.target.value)} disabled={!templates}>
          <option value="">
            {templates === null ? "Cargando plantillas…" : templates.length ? "Elige una plantilla aprobada" : "No hay plantillas aprobadas"}
          </option>
          {templates?.map(t => (
            <option key={t.id} value={t.id}>
              {t.name} · {languageLabel(t.language)}
            </option>
          ))}
        </select>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      {templates?.length === 0 && (
        <p className="muted small">
          Crea una en <a href="#/templates">Plantillas</a>; Meta suele aprobarlas en minutos.
        </p>
      )}

      {template && (
        <div className="tpl-send-grid">
          <div className="tpl-send-fields">
            {header && header.format !== "TEXT" && header.format !== "LOCATION" && (
              <label>
                Archivo del encabezado
                <input
                  type="file"
                  accept={ACCEPT[header.format]}
                  disabled={uploading}
                  onChange={e => {
                    pickMedia(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {uploading && <span className="hint">Subiendo…</span>}
              </label>
            )}
            {auth
              ? field("Código de verificación", code, setCode)
              : (
                  <>
                    {varsIn(header?.format === "TEXT" ? header.text : "").map(k =>
                      field(`Encabezado {{${k}}}`, values.header[k] ?? "", v =>
                        setValues(s => ({ ...s, header: { ...s.header, [k]: v } }))
                      )
                    )}
                    {varsIn(part(template, "BODY")?.text).map(k =>
                      field(`{{${k}}}`, values.body[k] ?? "", v => setValues(s => ({ ...s, body: { ...s.body, [k]: v } })))
                    )}
                    {(part(template, "BUTTONS")?.buttons ?? []).map((b, i) =>
                      dynamicButton(b)
                        ? field(
                            b.type === "COPY_CODE" ? `Código del botón "${b.text}"` : `Final del enlace de "${b.text}"`,
                            values.buttons[i] ?? "",
                            v => setValues(s => ({ ...s, buttons: { ...s.buttons, [i]: v } }))
                          )
                        : null
                    )}
                  </>
                )}
            <p className="muted small">
              {CATEGORY_LABEL[template.category]} · {estimatedCost(rates, template.category)}
            </p>
            <button className="btn primary" disabled={busy || uploading || !to}>
              {busy ? "Enviando…" : "Enviar plantilla"}
            </button>
          </div>
          <TemplatePreview
            template={template}
            values={effective.body}
            headerValues={effective.header}
            mediaUrl={media?.url}
            mediaName={media?.name}
          />
        </div>
      )}
    </form>
  );
}
