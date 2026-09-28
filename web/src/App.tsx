import { useCallback, useEffect, useState } from "react";
import { api, AuthError } from "./api";
import Chats from "./pages/Chats";
import { useInboxAlerts } from "./notifications";
import Login from "./pages/Login";
import Metrics from "./pages/Metrics";
import Settings from "./pages/Settings";
import Templates from "./pages/Templates";

type View = "chats" | "templates" | "metrics" | "settings";

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "chats", icon: "💬", label: "Chats" },
  { view: "templates", icon: "📋", label: "Plantillas" },
  { view: "metrics", icon: "📊", label: "Métricas" },
  { view: "settings", icon: "⚙️", label: "Configuración" }
];

function viewFromHash(): View {
  const v = location.hash.replace("#/", "").split("/")[0];
  return v === "templates" || v === "metrics" || v === "settings" ? v : "chats";
}

export default function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    api<{ email: string }>("/account/me")
      .then(r => setEmail(r.email))
      .catch(() => setEmail(null));
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Si cualquier llamada devuelve 401, vuelve al login.
  const onError = useCallback((e: unknown) => {
    if (e instanceof AuthError) setEmail(null);
  }, []);

  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
    setEmail(null);
  };

  if (email === undefined) return <div className="splash">Cargando…</div>;
  if (email === null) return <Login onLogin={setEmail} />;
  return <Shell email={email} view={view} onError={onError} onLogout={logout} />;
}

function Shell({
  email,
  view,
  onError,
  onLogout
}: {
  email: string;
  view: View;
  onError: (e: unknown) => void;
  onLogout: () => void;
}) {
  // Solo con sesión: avisos de mensajes nuevos y contador en el título.
  useInboxAlerts(onError);

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-logo" title="Agente Logidma">L</div>
        {NAV.map(n => (
          <a
            key={n.view}
            href={`#/${n.view}`}
            className={`rail-item ${view === n.view ? "active" : ""}`}
            title={n.label}
          >
            <span className="rail-icon">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </a>
        ))}
      </nav>
      <main className="main">
        {view === "chats" && <Chats onError={onError} />}
        {view === "templates" && <Templates onError={onError} />}
        {view === "metrics" && <Metrics onError={onError} />}
        {view === "settings" && <Settings email={email} onError={onError} onLogout={onLogout} />}
      </main>
    </div>
  );
}
