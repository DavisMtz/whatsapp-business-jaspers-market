import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { reloadQuickReplies, useQuickReplies, type QuickReply } from "./QuickReplies";

export default function QuickReplySettings({ onError }: { onError: (e: unknown) => void }) {
  const list = useQuickReplies();
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    reloadQuickReplies().catch(onError);
  }, [onError]);

  const reset = () => {
    setEditing(null);
    setShortcut("");
    setText("");
  };

  const edit = (r: QuickReply) => {
    setEditing(r);
    setShortcut(r.shortcut);
    setText(r.text);
    setMsg("");
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const body = { shortcut, text };
      if (editing) await api(`/quick-replies/${editing.id}`, { method: "PUT", body });
      else await api("/quick-replies", { body });
      reset();
      await reloadQuickReplies();
    } catch (err) {
      onError(err);
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: QuickReply) => {
    if (!confirm(`¿Borrar la respuesta /${r.shortcut}?`)) return;
    try {
      await api(`/quick-replies/${r.id}`, { method: "DELETE" });
      if (editing?.id === r.id) reset();
      await reloadQuickReplies();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="card">
      <h3>Respuestas rápidas</h3>
      <p className="muted">
        En un chat, escribe <strong>/</strong> y el atajo para insertar el texto. Puedes revisarlo antes de enviarlo.
        Usa <code>{"{nombre}"}</code> para poner el primer nombre del contacto.
      </p>
      {list.length > 0 && (
        <ul className="quick-admin">
          {list.map(r => (
            <li key={r.id}>
              <div className="quick-admin-body">
                <strong>/{r.shortcut}</strong>
                <span className="quick-text">{r.text}</span>
                <span className="muted small">{r.uses === 1 ? "1 uso" : `${r.uses} usos`}</span>
              </div>
              <button className="btn small" onClick={() => edit(r)}>
                Editar
              </button>
              <button className="btn small danger" onClick={() => remove(r)}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="form-grid" onSubmit={save}>
        <label>
          Atajo
          <div className="shortcut-input">
            <span>/</span>
            <input
              value={shortcut}
              onChange={e => setShortcut(e.target.value.replace(/\s/g, ""))}
              placeholder="horario"
              maxLength={30}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </label>
        <label>
          Texto
          <textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="¡Hola {nombre}! Nuestro horario es de lunes a viernes de 9:00 a 18:00."
            maxLength={4096}
          />
        </label>
        {msg && <div className="alert error">{msg}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy || !shortcut.trim() || !text.trim()}>
            {busy ? "Guardando…" : editing ? "Guardar cambios" : "Agregar respuesta"}
          </button>
          {editing && (
            <button type="button" className="btn" onClick={reset}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
