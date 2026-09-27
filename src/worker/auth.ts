import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, randomToken, safeEqual, sha256Hex } from "./crypto";
import type { AppEnv } from "./env";

const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 10;

// Bloqueo tras intentos fallidos, por IP y por correo.
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = { ip: 5, email: 20 };

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  salt: string;
  iterations: number;
};

function cookieName(c: Context): string {
  return new URL(c.req.url).protocol === "https:" ? "__Host-lg_session" : "lg_session";
}

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function verifyPassword(password: string, user: UserRow): Promise<boolean> {
  const { hash } = await hashPassword(password, user.salt, user.iterations);
  return safeEqual(hash, user.password_hash);
}

async function lockedUntil(db: D1Database, keys: string[], now: number): Promise<number | null> {
  const rows = await db
    .prepare(
      `SELECT max(locked_until) AS until FROM login_attempts
       WHERE key IN (${keys.map(() => "?").join(",")}) AND locked_until > ?`
    )
    .bind(...keys, now)
    .first<{ until: number | null }>();
  return rows?.until ?? null;
}

async function recordFailure(db: D1Database, key: string, max: number, now: number) {
  await db
    .prepare(
      `INSERT INTO login_attempts (key, failures, window_start, locked_until)
       VALUES (?1, 1, ?2, NULL)
       ON CONFLICT(key) DO UPDATE SET
         failures     = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END,
         locked_until = CASE
           WHEN window_start >= ?2 - ?3 AND failures + 1 >= ?4 THEN ?2 + ?5
           ELSE locked_until END`
    )
    .bind(key, now, WINDOW_MS, max, LOCK_MS)
    .run();
}

async function createSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken();
  const now = Date.now();
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(await sha256Hex(token), userId, now, expires, c.req.header("User-Agent")?.slice(0, 200) ?? null)
    .run();
  const secure = cookieName(c).startsWith("__Host-");
  setCookie(c, cookieName(c), token, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60
  });
}

// Rechaza peticiones que cambian datos si no vienen del propio sitio (CSRF).
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Origen no permitido" }, 403);
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, cookieName(c));
  if (!token) return c.json({ error: "No autenticado" }, 401);
  const row = await c.env.DB.prepare(
    `SELECT s.id, u.id AS user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; user_id: number; email: string }>();
  if (!row) {
    deleteCookie(c, cookieName(c), { path: "/", secure: cookieName(c).startsWith("__Host-") });
    return c.json({ error: "Sesión expirada" }, 401);
  }
  c.set("session", { userId: row.user_id, email: row.email, sessionId: row.id });
  await next();
};

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async c => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const keys = [`ip:${ip}`, `email:${email}`];
  const now = Date.now();
  const db = c.env.DB;

  const until = await lockedUntil(db, keys, now);
  if (until) {
    const minutes = Math.ceil((until - now) / 60000);
    return c.json({ error: `Demasiados intentos. Intenta de nuevo en ${minutes} min.` }, 429);
  }

  let user = await db
    .prepare("SELECT id, email, password_hash, salt, iterations FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();

  let ok = false;
  if (user) {
    ok = await verifyPassword(password, user);
  } else {
    // Primer acceso: solo el correo autorizado con la contraseña inicial crea el usuario.
    const count = await db.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
    const admin = normalizeEmail(c.env.ADMIN_EMAIL);
    if (
      count?.n === 0 &&
      admin &&
      email === admin &&
      c.env.DASHBOARD_PASSWORD &&
      safeEqual(password, c.env.DASHBOARD_PASSWORD)
    ) {
      const h = await hashPassword(password);
      await db
        .prepare(
          "INSERT INTO users (email, password_hash, salt, iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(email, h.hash, h.salt, h.iterations, now, now)
        .run();
      user = await db
        .prepare("SELECT id, email, password_hash, salt, iterations FROM users WHERE email = ?")
        .bind(email)
        .first<UserRow>();
      ok = !!user;
    }
  }

  if (!ok || !user) {
    await recordFailure(db, keys[0], MAX_FAILURES.ip, now);
    await recordFailure(db, keys[1], MAX_FAILURES.email, now);
    return c.json({ error: "Correo o contraseña incorrectos" }, 401);
  }

  await db.prepare(`DELETE FROM login_attempts WHERE key IN (?, ?)`).bind(...keys).run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  await createSession(c, user.id);
  return c.json({ email: user.email });
});

authRoutes.post("/logout", async c => {
  const token = getCookie(c, cookieName(c));
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, cookieName(c), { path: "/", secure: cookieName(c).startsWith("__Host-") });
  return c.json({ ok: true });
});

// Rutas que requieren sesión
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/me", c => c.json({ email: c.get("session").email }));

accountRoutes.post("/password", async c => {
  const { userId, sessionId } = c.get("session");
  const body = await c.req.json().catch(() => ({}));
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";

  if (next.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` }, 400);
  }
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, salt, iterations FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<UserRow>();
  if (!user || !(await verifyPassword(current, user))) {
    return c.json({ error: "La contraseña actual no es correcta" }, 400);
  }

  const h = await hashPassword(next);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE users SET password_hash = ?, salt = ?, iterations = ?, updated_at = ? WHERE id = ?"
    ).bind(h.hash, h.salt, h.iterations, Date.now(), userId),
    // Cierra las demás sesiones abiertas.
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, sessionId)
  ]);
  return c.json({ ok: true });
});

accountRoutes.post("/logout-others", async c => {
  const { userId, sessionId } = c.get("session");
  const res = await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(userId, sessionId)
    .run();
  return c.json({ closed: res.meta.changes ?? 0 });
});
