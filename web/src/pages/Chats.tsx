import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { api, upload, type Conversation, type Message, type Tag } from "../api";
import ContactPanel from "../components/ContactPanel";
import TemplateSender from "../components/TemplateSender";
import MessageMedia from "../components/MessageMedia";
import TagChip from "../components/TagChip";
import {
  displayName,
  formatDay,
  formatDuration,
  formatListTime,
  formatPhone,
  formatSize,
  formatTime,
  aiStatus,
  windowRemaining
} from "../format";
import { useRealtime, type RealtimeEvent } from "../realtime";

type OnError = (e: unknown) => void;

// Con WebSocket conectado, el polling solo es un respaldo lento.
const FALLBACK_MS = 60000;

function usePolling(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    fn();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function Chats({ onError }: { onError: OnError }) {
  const [tab, setTab] = useState<"open" | "archived">("open");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [tagFilter, setTagFilter] = useState(0);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [chatEvent, setChatEvent] = useState<{ id: number | null; n: number }>({ id: null, n: 0 });
  const [aiAutoReply, setAiAutoReply] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status: tab, q: query, tag: String(tagFilter) });
    api<{ conversations: Conversation[]; aiAutoReply: boolean }>(`/conversations?${qs}`)
      .then(r => {
        setConversations(r.conversations);
        setAiAutoReply(r.aiAutoReply);
      })
      .catch(onError);
  }, [tab, query, tagFilter, onError]);

  const loadTags = useCallback(() => {
    api<{ tags: Tag[] }>("/tags")
      .then(r => setAllTags(r.tags))
      .catch(onError);
  }, [onError]);

  useEffect(loadTags, [loadTags]);

  // Cada aviso recarga la lista y, si es del chat abierto, sus mensajes.
  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      load();
      if (e.type === "conversation" && e.conversationId === null) loadTags();
      setChatEvent(prev => ({
        id: e.type === "message" ? e.conversationId : null,
        n: prev.n + 1
      }));
    },
    [load, loadTags]
  );
  const live = useRealtime(onEvent);

  usePolling(load, live ? FALLBACK_MS : 5000, [load, live]);

  const selected = conversations.find(c => c.id === selectedId) ?? null;

  return (
    <div className={`chats ${selected || newChat ? "has-selection" : ""}`}>
      <aside className="chat-list">
        <div className="chat-list-header">
          <h2>Chats</h2>
          <button className="btn small primary" onClick={() => { setNewChat(true); setSelectedId(null); }}>
            + Nuevo
          </button>
        </div>
        <div className="chat-list-tools">
          <input
            type="search"
            placeholder="Buscar nombre o número"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="segmented">
            <button className={tab === "open" ? "active" : ""} onClick={() => setTab("open")}>
              Abiertos
            </button>
            <button className={tab === "archived" ? "active" : ""} onClick={() => setTab("archived")}>
              Archivados
            </button>
          </div>
          {allTags.length > 0 && (
            <select value={tagFilter} onChange={e => setTagFilter(Number(e.target.value))} aria-label="Filtrar por etiqueta">
              <option value={0}>Todas las etiquetas</option>
              {allTags.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <ul className="conversations">
          {conversations.length === 0 && (
            <li className="muted empty-list">
              {tagFilter
                ? "Ningún chat tiene esa etiqueta."
                : tab === "open"
                  ? "No hay chats abiertos."
                  : "No hay chats archivados."}
            </li>
          )}
          {conversations.map(c => (
            <li
              key={c.id}
              className={`conversation ${c.id === selectedId ? "active" : ""}`}
              onClick={() => { setSelectedId(c.id); setNewChat(false); }}
            >
              <div className="avatar">{displayName(c).replace(/^\+/, "").slice(0, 1).toUpperCase()}</div>
              <div className="conversation-body">
                <div className="conversation-top">
                  <span className="conversation-name">{displayName(c)}</span>
                  <span className={`conversation-time ${c.unread_count ? "unread" : ""}`}>
                    {formatListTime(c.last_message_at)}
                  </span>
                </div>
                <div className="conversation-bottom">
                  <span className="conversation-preview">
                    {c.last_direction === "out" && "Tú: "}
                    {c.last_preview}
                  </span>
                  {c.ai_handoff_at && <span title="Pasó a una persona">🙋</span>}
                  {c.unread_count > 0 && <span className="badge">{c.unread_count}</span>}
                </div>
                {c.tags.length > 0 && (
                  <div className="tag-list">
                    {c.tags.map(t => (
                      <TagChip key={t.id} tag={t} small />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-pane">
        {newChat ? (
          <NewChat
            onClose={() => setNewChat(false)}
            onSent={id => { setNewChat(false); setSelectedId(id); setTab("open"); load(); }}
          />
        ) : selected ? (
          <ChatView
            key={selected.id}
            conversation={selected}
            onBack={() => setSelectedId(null)}
            onChanged={load}
            onTagsChanged={() => { load(); loadTags(); }}
            onError={onError}
            live={live}
            event={chatEvent}
            aiAutoReply={aiAutoReply}
          />
        ) : (
          <div className="chat-placeholder">
            <div className="empty-icon">💬</div>
            <p className="muted">Elige un chat o inicia uno nuevo.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const HANDOFF_TEXT: Record<string, string> = {
  cliente: "El cliente pidió hablar con una persona.",
  ia: "La IA no supo resolverlo y pasó el chat a una persona.",
  limite: "Se alcanzó el límite de respuestas automáticas en este chat."
};

function StatusTicks({ status, error }: { status: string; error: string | null }) {
  const map: Record<string, [string, string]> = {
    accepted: ["🕓", "Enviando"],
    sent: ["✓", "Enviado"],
    delivered: ["✓✓", "Entregado"],
    read: ["✓✓", "Leído"],
    failed: ["⚠️", `Falló${error ? ": " + error : ""}`]
  };
  const [icon, label] = map[status] ?? ["", status];
  return (
    <span className={`ticks ${status}`} title={label}>
      {icon}
    </span>
  );
}

function ChatView({
  conversation,
  onBack,
  onChanged,
  onTagsChanged,
  onError,
  live,
  event,
  aiAutoReply
}: {
  conversation: Conversation;
  onBack: () => void;
  onChanged: () => void;
  onTagsChanged: () => void;
  onError: OnError;
  live: boolean;
  event: { id: number | null; n: number };
  aiAutoReply: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(conversation.custom_name ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(() => {
    api<{ messages: Message[] }>(`/conversations/${conversation.id}/messages`)
      .then(r => setMessages(r.messages))
      .catch(onError);
  }, [conversation.id, onError]);

  usePolling(load, live ? FALLBACK_MS : 4000, [load, live]);

  // Aviso en tiempo real: mensaje de este chat, o reconexión (id null).
  useEffect(() => {
    if (event.n > 0 && (event.id === null || event.id === conversation.id)) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.n]);

  useEffect(() => {
    if (conversation.unread_count > 0) {
      api(`/conversations/${conversation.id}/read`, { method: "POST", body: {} })
        .then(onChanged)
        .catch(onError);
    }
  }, [conversation.id, conversation.unread_count, onChanged, onError]);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  const remaining = windowRemaining(conversation.last_inbound_at);
  const ai = aiStatus(conversation, aiAutoReply);

  const resumeAi = async () => {
    await api(`/ai/conversations/${conversation.id}`, { method: "PATCH", body: { resume: true } }).catch(onError);
    onChanged();
  };

  const toggleArchive = async () => {
    const status = conversation.status === "archived" ? "open" : "archived";
    await api(`/conversations/${conversation.id}`, { method: "PATCH", body: { status } }).catch(onError);
    onChanged();
    if (status === "archived") onBack();
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    await api(`/contacts/${conversation.wa_id}`, { method: "PATCH", body: { custom_name: name } }).catch(onError);
    setRenaming(false);
    onChanged();
  };

  let lastDay = "";
  return (
    <div className="chat">
      <header className="chat-header">
        <button className="icon-btn back" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <div className="avatar">{displayName(conversation).replace(/^\+/, "").slice(0, 1).toUpperCase()}</div>
        <div className="chat-title">
          {renaming ? (
            <form onSubmit={saveName} className="rename">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del contacto" autoFocus />
              <button className="btn small primary">Guardar</button>
              <button type="button" className="btn small" onClick={() => setRenaming(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <>
              <strong onClick={() => setRenaming(true)} title="Cambiar nombre" className="clickable">
                {displayName(conversation)}
              </strong>
              <span className="muted small">
                {formatPhone(conversation.wa_id)}
                {conversation.profile_name && conversation.custom_name && ` · ${conversation.profile_name}`}
              </span>
            </>
          )}
        </div>
        <span className={`window-pill ${remaining ? "open" : "closed"}`}>
          {remaining ? `Ventana abierta · ${formatDuration(remaining)}` : "Ventana cerrada"}
        </span>
        <button className={`ai-pill ${ai.className}`} onClick={() => setShowInfo(true)} title="Asistente de IA en este chat">
          {ai.label}
        </button>
        <button className="btn small" onClick={toggleArchive}>
          {conversation.status === "archived" ? "Desarchivar" : "Archivar"}
        </button>
        <button
          className={`icon-btn ${showInfo ? "active" : ""}`}
          onClick={() => setShowInfo(v => !v)}
          title="Notas y etiquetas"
          aria-label="Notas y etiquetas"
        >
          ℹ️
        </button>
      </header>

      {conversation.ai_handoff_at && (
        <div className="handoff-banner">
          <span>
            🙋 {HANDOFF_TEXT[conversation.ai_handoff_reason ?? ""] ?? "Este chat pasó a una persona."} La IA no responderá
            aquí hasta que lo devuelvas.
          </span>
          <button className="btn small" onClick={resumeAi}>
            Devolver a la IA
          </button>
        </div>
      )}

      <div className="chat-body">
        <div className="messages">
          {messages.map(m => {
            const day = formatDay(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && <div className="day-divider">{day}</div>}
                <div className={`bubble ${m.direction} ${m.has_media ? "has-media" : ""}`}>
                  {m.has_media ? (
                    <>
                      <MessageMedia message={m} />
                      {m.caption && <div className="bubble-text">{m.caption}</div>}
                    </>
                  ) : (
                    <div className="bubble-text">{m.body}</div>
                  )}
                  <div className="bubble-meta">
                    {m.ai ? <span className="ai-badge" title="Enviado por la IA">🤖 IA</span> : null}
                    {formatTime(m.created_at)}
                    {m.direction === "out" && <StatusTicks status={m.status} error={m.error} />}
                  </div>
                  {m.status === "failed" && m.error && <div className="bubble-error">{m.error}</div>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {showInfo && (
          <ContactPanel
            conversation={conversation}
            aiAutoReply={aiAutoReply}
            waId={conversation.wa_id}
            onClose={() => setShowInfo(false)}
            onChanged={onTagsChanged}
            onError={onError}
          />
        )}
      </div>

      <Composer to={conversation.wa_id} conversationId={conversation.id} windowOpen={!!remaining} onSent={() => { load(); onChanged(); }} />
    </div>
  );
}

function Composer({
  to,
  conversationId,
  windowOpen,
  onSent
}: {
  to: string;
  conversationId: number;
  windowOpen: boolean;
  onSent: () => void;
}) {
  const [mode, setMode] = useState<"text" | "template">(windowOpen ? "text" : "template");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async () => {
    setSuggesting(true);
    setError("");
    try {
      const r = await api<{ text: string }>(`/ai/conversations/${conversationId}/suggest`, { body: {} });
      setText(r.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sugerir una respuesta");
    } finally {
      setSuggesting(false);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const pasted = e.clipboardData.files[0];
    if (pasted) {
      e.preventDefault();
      setFile(pasted);
    }
  };

  useEffect(() => {
    if (!windowOpen) setMode("template");
  }, [windowOpen]);

  const sendText = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/messages", { body: { to, text } });
      setText("");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      {!windowOpen && (
        <div className="composer-note">
          Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviarle una
          plantilla aprobada.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {mode === "text" && file ? (
        <AttachmentForm
          to={to}
          file={file}
          initialCaption={text}
          onCancel={() => setFile(null)}
          onSent={() => { setFile(null); setText(""); onSent(); }}
        />
      ) : mode === "text" ? (
        <form className="composer-row" onSubmit={sendText}>
          <button type="button" className="icon-btn" title="Enviar plantilla" onClick={() => setMode("template")}>
            📋
          </button>
          <button type="button" className="icon-btn" title="Adjuntar archivo" onClick={() => fileInput.current?.click()}>
            📎
          </button>
          <button type="button" className="icon-btn" title="Sugerir respuesta con IA" onClick={suggest} disabled={suggesting}>
            {suggesting ? "…" : "✨"}
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={e => {
              if (e.target.files?.[0]) setFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
          <textarea
            rows={1}
            value={text}
            placeholder="Escribe un mensaje"
            onPaste={onPaste}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          {text.trim() || !canRecord() ? (
            <button className="btn primary" disabled={busy || !text.trim()}>
              {busy ? "…" : "Enviar"}
            </button>
          ) : (
            <VoiceRecorder onRecorded={setFile} onError={setError} />
          )}
        </form>
      ) : (
        <TemplateSender
          to={to}
          onSent={onSent}
          onCancel={windowOpen ? () => setMode("text") : undefined}
        />
      )}
    </div>
  );
}

// Vista previa de un archivo antes de enviarlo, con pie de foto opcional.
function AttachmentForm({
  to,
  file,
  initialCaption,
  onCancel,
  onSent
}: {
  to: string;
  file: File;
  initialCaption: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const isImage = /^image\/(jpeg|png|gif|webp)$/.test(file.type);
  const isAudio = file.type.startsWith("audio/");

  useEffect(() => {
    if (!isImage && !isAudio) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage, isAudio]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("to", to);
    form.append("file", file, file.name);
    if (!isAudio) form.append("caption", caption);
    try {
      await upload("/media/send", form);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
      setBusy(false);
    }
  };

  return (
    <form className="attachment" onSubmit={send}>
      {error && <div className="alert error">{error}</div>}
      <div className="attachment-file">
        {isImage && preview ? (
          <img src={preview} alt="" className="attachment-thumb" />
        ) : isAudio && preview ? (
          <audio src={preview} controls />
        ) : (
          <div className="media-doc-icon">📄</div>
        )}
        <div className="attachment-info">
          <strong>{file.name}</strong>
          <span className="muted small">{formatSize(file.size)}</span>
        </div>
      </div>
      <div className="composer-row">
        {!isAudio && (
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Agrega un comentario (opcional)" maxLength={1024} />
        )}
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? "Enviando…" : "Enviar"}
        </button>
      </div>
    </form>
  );
}

// WhatsApp acepta audio OGG (Opus) o MP4/AAC. Safari graba MP4; Firefox, OGG.
const RECORDING_TYPES: [string, string][] = [
  ["audio/ogg;codecs=opus", "ogg"],
  ["audio/mp4;codecs=mp4a.40.2", "m4a"],
  ["audio/mp4", "m4a"]
];

function recordingType(): [string, string] | null {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return RECORDING_TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function canRecord() {
  return recordingType() !== null;
}

function VoiceRecorder({ onRecorded, onError }: { onRecorded: (f: File) => void; onError: (msg: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach(t => t.stop()), []);

  const start = async () => {
    const type = recordingType();
    if (!type) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: type[0] });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (cancelled.current || !chunks.length) return;
        const mime = type[0].split(";")[0];
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        onRecorded(new File(chunks, `nota-de-voz-${stamp}.${type[1]}`, { type: mime }));
      };
      cancelled.current = false;
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      onError("No se pudo usar el micrófono. Revisa los permisos del navegador.");
    }
  };

  const stop = (cancel: boolean) => {
    cancelled.current = cancel;
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  if (!recording) {
    return (
      <button type="button" className="btn primary" title="Grabar nota de voz" onClick={start}>
        🎤
      </button>
    );
  }
  return (
    <div className="recording">
      <span className="recording-dot" />
      <span>
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <button type="button" className="btn small" onClick={() => stop(true)}>
        Cancelar
      </button>
      <button type="button" className="btn small primary" onClick={() => stop(false)}>
        Listo
      </button>
    </div>
  );
}

function NewChat({ onClose, onSent }: { onClose: () => void; onSent: (id: number) => void }) {
  const [to, setTo] = useState("");
  const digits = to.replace(/\D/g, "");

  return (
    <div className="chat">
      <header className="chat-header">
        <button className="icon-btn back" onClick={onClose} aria-label="Volver">
          ←
        </button>
        <div className="chat-title">
          <strong>Nuevo chat</strong>
          <span className="muted small">Para iniciar una conversación, WhatsApp exige una plantilla aprobada.</span>
        </div>
        <button className="btn small" onClick={onClose}>
          Cerrar
        </button>
      </header>
      <div className="new-chat">
        <label>
          Número con código de país
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="Ej. 52 443 123 4567"
            inputMode="tel"
            autoFocus
          />
        </label>
        <TemplateSender to={digits} onSent={id => id && onSent(id)} />
      </div>
    </div>
  );
}
