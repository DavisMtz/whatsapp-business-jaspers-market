import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Contact, type Tag } from "../api";
import { formatPhone, TAG_LABEL } from "../format";
import TagChip from "./TagChip";

// Panel lateral del chat: etiquetas y notas internas del contacto (el cliente no las ve).
export default function ContactPanel({
  waId,
  onClose,
  onChanged,
  onError
}: {
  waId: string;
  onClose: () => void;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newColor, setNewColor] = useState("green");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api<{ contact: Contact; tags: Tag[] }>(`/contacts/${waId}`)
      .then(r => {
        setContact(r.contact);
        setTags(r.tags);
        setNotes(r.contact.notes ?? "");
        setSavedNotes(r.contact.notes ?? "");
      })
      .catch(onError);
    api<{ tags: Tag[]; colors: string[] }>("/tags")
      .then(r => {
        setAllTags(r.tags);
        setColors(r.colors);
      })
      .catch(onError);
  }, [waId, onError]);

  useEffect(load, [load]);

  const saveTags = async (ids: number[]) => {
    try {
      await api(`/contacts/${waId}/tags`, { method: "PUT", body: { tagIds: ids } });
      setTags(allTags.filter(t => ids.includes(t.id)));
      onChanged();
    } catch (err) {
      onError(err);
    }
  };

  const toggle = (tag: Tag) => {
    const ids = tags.map(t => t.id);
    saveTags(ids.includes(tag.id) ? ids.filter(id => id !== tag.id) : [...ids, tag.id]);
  };

  const createTag = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    try {
      const r = await api<{ tag: Tag }>("/tags", { body: { name: newTag, color: newColor } });
      setAllTags(t => [...t, r.tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTag("");
      await api(`/contacts/${waId}/tags`, { method: "PUT", body: { tagIds: [...tags.map(t => t.id), r.tag.id] } });
      setTags(t => [...t, r.tag]);
      onChanged();
    } catch (err) {
      onError(err);
      setMsg(err instanceof Error ? err.message : "No se pudo crear");
    }
  };

  const saveNotes = async () => {
    if (notes === savedNotes) return;
    try {
      await api(`/contacts/${waId}`, { method: "PATCH", body: { notes } });
      setSavedNotes(notes);
      onChanged();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <aside className="contact-panel">
      <header className="contact-panel-header">
        <strong>Información del contacto</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </header>
      {!contact ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="contact-panel-body">
          <dl className="contact-facts">
            <dt>Número</dt>
            <dd>{formatPhone(contact.wa_id)}</dd>
            {contact.profile_name && (
              <>
                <dt>Nombre en WhatsApp</dt>
                <dd>{contact.profile_name}</dd>
              </>
            )}
            <dt>Cliente desde</dt>
            <dd>{new Date(contact.created_at).toLocaleDateString("es-MX", { dateStyle: "long" })}</dd>
          </dl>

          <section>
            <h4>Etiquetas</h4>
            <div className="tag-list">
              {allTags.length === 0 && <span className="muted small">Aún no hay etiquetas.</span>}
              {allTags.map(t => (
                <TagChip key={t.id} tag={t} active={tags.some(x => x.id === t.id)} onClick={() => toggle(t)} />
              ))}
            </div>
            <form className="new-tag" onSubmit={createTag}>
              <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Nueva etiqueta" maxLength={30} />
              <select value={newColor} onChange={e => setNewColor(e.target.value)} aria-label="Color">
                {colors.map(c => (
                  <option key={c} value={c}>
                    {TAG_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
              <button className="btn small" disabled={!newTag.trim()}>
                Crear
              </button>
            </form>
            {msg && <div className="alert error">{msg}</div>}
          </section>

          <section>
            <h4>Notas internas</h4>
            <textarea
              className="notes"
              rows={6}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Pedidos, preferencias, datos de facturación… Solo tú las ves."
              maxLength={5000}
            />
            <div className="row">
              <button className="btn small primary" onClick={saveNotes} disabled={notes === savedNotes}>
                Guardar notas
              </button>
              {notes === savedNotes && savedNotes && <span className="muted small">Guardado</span>}
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
