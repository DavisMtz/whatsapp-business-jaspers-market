const encoder = new TextEncoder();

// Workers limita PBKDF2 a 100 000 iteraciones.
export const PBKDF2_ITERATIONS = 100_000;

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export async function hashPassword(
  password: string,
  salt = toBase64(crypto.getRandomValues(new Uint8Array(16))),
  iterations = PBKDF2_ITERATIONS
): Promise<{ hash: string; salt: string; iterations: number }> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations },
    key,
    256
  );
  return { hash: toHex(bits), salt, iterations };
}
