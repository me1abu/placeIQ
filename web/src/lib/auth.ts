// Sign-in for both kinds of user. Web Crypto only, so it works in the proxy and route handlers.
//
//   student  signs in with roll number + password (accounts live in the engine's database)
//   cell     the placement cell, signs in with PLACEIQ_ADMIN_PASSWORD
//
// The session cookie is "<base64url(JSON payload)>.<HMAC-SHA256(secret, payload)>", HttpOnly.
// A second, readable cookie (placeiq_who) only tells the browser whose profile to load from
// local storage; it grants nothing.

export const COOKIE = "placeiq_session";
export const WHO_COOKIE = "placeiq_who";
export const SESSION_HOURS = 12;

export type Role = "student" | "cell";
export type Session = { role: Role; sub: string; roll?: string; exp: number };

export const ENGINE = (process.env.PLACEIQ_API_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");

export function adminPassword(): string | null {
  const p = process.env.PLACEIQ_ADMIN_PASSWORD;
  return p && p.length > 0 ? p : null;
}

// Without PLACEIQ_SESSION_SECRET (start.bat passes it from .env) a random per-process secret is
// used: sign-in still works, but everyone is signed out whenever the web server restarts.
const g = globalThis as { __placeiqSecret?: string };
function secret(): string {
  const s = process.env.PLACEIQ_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!g.__placeiqSecret) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    g.__placeiqSecret = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    console.warn("[PlaceIQ] PLACEIQ_SESSION_SECRET is not set; sign-ins will end when the web server restarts.");
  }
  return g.__placeiqSecret;
}

const enc = new TextEncoder();

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(s: string): string {
  return btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function makeSession(s: Omit<Session, "exp">): Promise<string> {
  const payload = b64url(JSON.stringify({ ...s, exp: Date.now() + SESSION_HOURS * 3600_000 }));
  return `${payload}.${await hmac(secret(), `placeiq:${payload}`)}`;
}

export async function readSession(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(sig, await hmac(secret(), `placeiq:${payload}`))) return null;
  try {
    const s = JSON.parse(unb64url(payload)) as Session;
    if ((s.role !== "student" && s.role !== "cell") || typeof s.sub !== "string" || !(s.exp > Date.now())) return null;
    return s;
  } catch {
    return null;
  }
}

export async function checkPassword(given: string, password: string): Promise<boolean> {
  // Compare digests so the comparison time doesn't depend on where the strings differ.
  return safeEqual(await hmac("placeiq-login", given), await hmac("placeiq-login", password));
}

export function sessionCookies(token: string | null, sub: string, secure: boolean): string[] {
  const age = token ? SESSION_HOURS * 3600 : 0;
  const tail = ["Path=/", "SameSite=Lax", `Max-Age=${age}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
  return [`${COOKIE}=${token ?? ""}; HttpOnly; ${tail}`, `${WHO_COOKIE}=${token ? sub : ""}; ${tail}`];
}

// ------------------------------------------------------------------ who may open what
/** Decoded, so "/%63ell" is treated as "/cell". */
export function normalisePath(pathname: string): string {
  try { return decodeURIComponent(pathname); } catch { return pathname; }
}

const PUBLIC_PAGES = new Set(["/login", "/about"]);

/** Which role a page or API path needs: null = anyone, "any" = any signed-in user. */
export function requiredRole(pathname: string): Role | "any" | null {
  const p = normalisePath(pathname);
  if (PUBLIC_PAGES.has(p) || p.startsWith("/api/auth/") || p === "/api/engine/health") return null;
  if (p === "/cell" || p.startsWith("/cell/") || p.startsWith("/api/engine/admin")) return "cell";
  if (p.startsWith("/api/engine/students") || p.startsWith("/api/engine/jobs")) return "student";
  if (p.startsWith("/api/")) return "any";
  return "student"; // student pages: home, profile, readiness, what-if, roadmap
}

export function allowed(need: Role | "any" | null, s: Session | null): boolean {
  if (need === null) return true;
  if (!s) return false;
  return need === "any" || s.role === need;
}

/** Where a signed-in user lands, and a safe same-site "next" for their role. */
export function homeFor(role: Role): string {
  return role === "cell" ? "/cell" : "/";
}
export function safeNext(next: string | null | undefined, role: Role): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return homeFor(role);
  const need = requiredRole(next.split("?")[0]);
  return need === null || need === "any" || need === role ? next : homeFor(role);
}
