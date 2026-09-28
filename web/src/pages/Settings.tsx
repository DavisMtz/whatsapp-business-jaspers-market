import { useEffect, useState, type FormEvent } from "react";
import { api, type Tag } from "../api";
import AiSettings from "../components/AiSettings";
import QuickReplySettings from "../components/QuickReplySettings";
import { notificationsEnabled, notificationsSupported, setNotificationsPref } from "../notifications";
import TagChip from "../components/TagChip";
import { TAG_LABEL } from "../format";

type Status = {
  phoneNumberId: string;
  webhookUrl: string;
  graphApiVersion: string;
  accessToken: boolean;
  appSecret: boolean;
  verifyToken: boolean;
  phone?: {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    name_status?: string;
    error?: string;
  };
};

export default function Settings({
  email,
  onError,
  onLogout
}: {
  email: string;
  onError: (e: unknown) => void;
  onLogout: () => void;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Configuración</h2>
      </header>
      <Security email={email} onError={onError} onLogout={onLogout} />
      <Notifications />
      <QuickReplySettings onError={onError} />
      <AiSettings onError={onError} />
      <Tags onError={onError} />
      <Connection onError={onError} />
    </div>
  );
}

function Security({ email, onError, onLogout }: { email: string; onError: (e: unknown) => void; onLogout: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) return setMsg({ type: "error", text: "Las contraseñas nuevas no coinciden" });
    setBusy(true);
    try {
      await api("/account/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ type: "success", text: "Contraseña actualizada. Se cerraron tus otras sesiones." });
    } catch (err) {
      onError(err);
      setMsg({ type: "error", text: err instanceof Error ? err.message : "No se pudo cambiar" });
    } finally {
      setBusy(false);
    }
  };

  const logoutOthers = async () => {
    try {
      const r = await api<{ closed: number }>("/account/logout-others", { body: {} });
      setMsg({ type: "success", text: `Se cerraron ${r.closed} sesión(es) en otros dispositivos.` });
    } catch (err) {
      onError(err);
    }
  };

  return (
    <section className="card">
      <h3>Cuenta y seguridad</h3>
      <p className="muted">
        Sesión iniciada como <strong>{email}</strong>
      </p>
      <form className="form-grid" onSubmit={change}>
        <label>
          Contraseña actual
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
        </label>
        <label>
          Nueva contraseña (mínimo 10 caracteres)
          <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={e => setNext(e.target.value)} required />
        </label>
        <label>
          Confirmar nueva contraseña
          <input type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e => setConfirm(e.target.value)} required />
        </label>
        {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {busy ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      </form>
      <div className="row separator">
        <button className="btn" onClick={logoutOthers}>
          Cerrar sesión en otros dispositivos
        </button>
        <button className="btn danger" onClick={onLogout}>
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}

function Notifications() {
  const supported = notificationsSupported();
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");

  const turnOn = async () => {
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") {
      setNotificationsPref(true);
      setEnabled(true);
      try {
        new Notification("Notificaciones activadas", { body: "Te avisaremos de los mensajes nuevos.", icon: "/icon.svg" });
      } catch {}
    }
  };

  const turnOff = () => {
    setNotificationsPref(false);
    setEnabled(false);
  };

  return (
    <section className="card">
      <h3>Notificaciones</h3>
      <p className="muted">
        Avisos del navegador cuando llega un mensaje y no estás viendo ese chat. Se configuran en cada dispositivo. El
        número de chats sin leer aparece siempre en el título de la pestaña.
      </p>
      {!supported ? (
        <div className="alert error">
          Este navegador no permite notificaciones del sitio (Safari en iPad no las muestra en una pestaña normal). El contador de no leídos del título sí funciona.
        </div>
      ) : permission === "denied" ? (
        <div className="alert error">
          Bloqueaste las notificaciones para este sitio. Permítelas en los ajustes del navegador y recarga la página.
        </div>
      ) : (
        <div className="row">
          {enabled ? (
            <>
              <span className="status-badge ok">✅ Activadas en este dispositivo</span>
              <button className="btn" onClick={turnOff}>
                Desactivar
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={turnOn}>
              Activar notificaciones
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Connection({ onError }: { onError: (e: unknown) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api<Status>("/status").then(setStatus).catch(onError);
  }, [onError]);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await api<Status>("/status?check=1"));
    } catch (err) {
      onError(err);
    } finally {
      setChecking(false);
    }
  };

  const ok = (v: boolean) => (v ? "✅ Configurado" : "❌ Falta");

  return (
    <section className="card">
      <h3>Conexión con WhatsApp</h3>
      {!status ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <dl className="info-grid">
            <dt>Phone Number ID</dt>
            <dd>{status.phoneNumberId}</dd>
            <dt>URL del webhook</dt>
            <dd className="mono">{status.webhookUrl}</dd>
            <dt>Token de acceso</dt>
            <dd>{ok(status.accessToken)}</dd>
            <dt>App Secret</dt>
            <dd>{ok(status.appSecret)}</dd>
            <dt>Verify token</dt>
            <dd>{ok(status.verifyToken)}</dd>
            <dt>Graph API</dt>
            <dd>{status.graphApiVersion}</dd>
            {status.phone && !status.phone.error && (
              <>
                <dt>Número</dt>
                <dd>
                  {status.phone.display_phone_number} · {status.phone.verified_name}
                </dd>
                <dt>Calidad</dt>
                <dd>{status.phone.quality_rating}</dd>
              </>
            )}
          </dl>
          {status.phone?.error && <div className="alert error">Meta respondió: {status.phone.error}</div>}
          {status.phone && !status.phone.error && <div className="alert success">Conexión con Meta correcta.</div>}
          <div className="row">
            <button className="btn" onClick={check} disabled={checking}>
              {checking ? "Probando…" : "Probar conexión con Meta"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Tags({ onError }: { onError: (e: unknown) => void }) {
  const [tags, setTags] = useState<(Tag & { contacts: number })[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("green");
  const [msg, setMsg] = useState("");

  const load = () =>
    api<{ tags: (Tag & { contacts: number })[]; colors: string[] }>("/tags")
      .then(r => {
        setTags(r.tags);
        setColors(r.colors);
      })
      .catch(onError);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg("");
    try {
      await fn();
      await load();
    } catch (err) {
      onError(err);
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/tags", { body: { name, color } });
      setName("");
    });
  };

  const rename = (t: Tag) => {
    const next = prompt("Nuevo nombre de la etiqueta", t.name);
    if (next && next.trim() && next !== t.name) run(() => api(`/tags/${t.id}`, { method: "PATCH", body: { name: next } }));
  };

  const remove = (t: Tag & { contacts: number }) => {
    const detail = t.contacts ? ` Se quitará de ${t.contacts} contacto(s).` : "";
    if (confirm(`¿Borrar la etiqueta "${t.name}"?${detail}`)) run(() => api(`/tags/${t.id}`, { method: "DELETE" }));
  };

  return (
    <section className="card">
      <h3>Etiquetas</h3>
      <p className="muted">Organiza tus contactos. Se asignan desde el botón ℹ️ de cada chat.</p>
      {tags.length > 0 && (
        <ul className="tag-admin">
          {tags.map(t => (
            <li key={t.id}>
              <TagChip tag={t} />
              <span className="muted small">{t.contacts} contacto(s)</span>
              <select
                value={t.color}
                aria-label="Color"
                onChange={e => run(() => api(`/tags/${t.id}`, { method: "PATCH", body: { color: e.target.value } }))}
              >
                {colors.map(c => (
                  <option key={c} value={c}>
                    {TAG_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
              <button className="btn small" onClick={() => rename(t)}>
                Renombrar
              </button>
              <button className="btn small danger" onClick={() => remove(t)}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="new-tag" onSubmit={create}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nueva etiqueta" maxLength={30} />
        <select value={color} onChange={e => setColor(e.target.value)} aria-label="Color">
          {colors.map(c => (
            <option key={c} value={c}>
              {TAG_LABEL[c] ?? c}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={!name.trim()}>
          Crear
        </button>
      </form>
      {msg && <div className="alert error">{msg}</div>}
    </section>
  );
}
