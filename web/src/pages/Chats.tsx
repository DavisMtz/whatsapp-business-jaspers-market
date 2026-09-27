import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Conversation, type Message } from "../api";
import {
  displayName,
  formatDay,
  formatDuration,
  formatListTime,
  formatPhone,
  formatTime,
  windowRemaining
} from "../format";

type OnError = (e: unknown) => void;

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

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status: tab, q: query });
    api<{ conversations: Conversation[] }>(`/conversations?${qs}`)
      .then(r => setConversations(r.conversations))
      .catch(onError);
  }, [tab, query, onError]);

  usePolling(load, 5000, [load]);

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
        </div>
        <ul className="conversations">
          {conversations.length === 0 && (
            <li className="muted empty-list">
              {tab === "open" ? "No hay chats abiertos." : "No hay chats archivados."}
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
                  {c.unread_count > 0 && <span className="badge">{c.unread_count}</span>}
                </div>
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
            onError={onError}
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
  onError
}: {
  conversation: Conversation;
  onBack: () => void;
  onChanged: () => void;
  onError: OnError;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(conversation.custom_name ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(() => {
    api<{ messages: Message[] }>(`/conversations/${conversation.id}/messages`)
      .then(r => setMessages(r.messages))
      .catch(onError);
  }, [conversation.id, onError]);

  usePolling(load, 4000, [load]);

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
        <button className="btn small" onClick={toggleArchive}>
          {conversation.status === "archived" ? "Desarchivar" : "Archivar"}
        </button>
      </header>

      <div className="messages">
        {messages.map(m => {
          const day = formatDay(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <div className="day-divider">{day}</div>}
              <div className={`bubble ${m.direction}`}>
                <div className="bubble-text">{m.body}</div>
                <div className="bubble-meta">
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

      <Composer to={conversation.wa_id} windowOpen={!!remaining} onSent={() => { load(); onChanged(); }} />
    </div>
  );
}

function Composer({ to, windowOpen, onSent }: { to: string; windowOpen: boolean; onSent: () => void }) {
  const [mode, setMode] = useState<"text" | "template">(windowOpen ? "text" : "template");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      {mode === "text" ? (
        <form className="composer-row" onSubmit={sendText}>
          <button type="button" className="icon-btn" title="Enviar plantilla" onClick={() => setMode("template")}>
            📋
          </button>
          <textarea
            rows={1}
            value={text}
            placeholder="Escribe un mensaje"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          <button className="btn primary" disabled={busy || !text.trim()}>
            {busy ? "…" : "Enviar"}
          </button>
        </form>
      ) : (
        <TemplateForm
          to={to}
          onSent={onSent}
          onCancel={windowOpen ? () => setMode("text") : undefined}
        />
      )}
    </div>
  );
}

const LANGUAGES = [
  ["es_MX", "Español (México)"],
  ["es", "Español"],
  ["en_US", "Inglés (EE. UU.)"],
  ["en", "Inglés"]
];

function TemplateForm({
  to,
  onSent,
  onCancel
}: {
  to: string;
  onSent: (conversationId?: number) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ conversationId: number }>("/messages", {
        body: { to, template: { name: name.trim(), language } }
      });
      setName("");
      onSent(r.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="template-form" onSubmit={send}>
      {error && <div className="alert error">{error}</div>}
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la plantilla" required />
      <select value={language} onChange={e => setLanguage(e.target.value)}>
        {LANGUAGES.map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
      <button className="btn primary" disabled={busy || !to}>
        {busy ? "Enviando…" : "Enviar plantilla"}
      </button>
      {onCancel && (
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      )}
    </form>
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
        <TemplateForm to={digits} onSent={id => id && onSent(id)} />
      </div>
    </div>
  );
}
