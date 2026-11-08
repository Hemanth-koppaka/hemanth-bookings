// Server-only admin authentication.
//
// - The access code is stored as a PBKDF2 hash (legacy plain-text codes are
//   accepted once and upgraded in place).
// - Wrong codes are throttled per device (internet connection): after 5
//   misses that device is locked out, and each further run of misses doubles
//   its lock (up to an hour). Other devices, like the salon's own phone, can
//   still sign in. A salon-wide backstop slows guessing spread over many
//   devices, but never blocks a device that has signed in successfully before.
// - A correct code is exchanged for a short-lived signed session token; the
//   code itself is never kept in the browser. Changing the code invalidates
//   every existing session.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ITERATIONS = 100_000; // Cloudflare Workers cap PBKDF2 at 100k
const SESSION_HOURS = 12;
const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 5 * 60_000;
const MAX_LOCK_MS = 60 * 60_000;
const GUARD_KEY = "admin_guard";
/** Sessions issued before this moment are signed out ("sign out on all devices"). */
const EPOCH_KEY = "admin_session_epoch";

const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Constant-time string comparison. */
function same(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return b64(bits);
}

export async function hashCode(code: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${await pbkdf2(code, salt, ITERATIONS)}`;
}

async function matches(code: string, stored: string) {
  if (!stored.startsWith("pbkdf2$")) return same(code, stored); // legacy plain text
  const [, iter, salt, hash] = stored.split("$");
  if (!iter || !salt || !hash) return false;
  return same(await pbkdf2(code, unb64(salt) as Uint8Array<ArrayBuffer>, Number(iter)), hash);
}

/** A short code, or the original code that matches the public street number, is weak. */
// The salon's own numbers (phone, plot, PIN code) are the first things guessed.
const SALON_NUMBERS = ["7981648951", "1143", "500072"];
/** Too short, a repeat (111111, 121212, 123123), a run (123456, 654321) or the salon's own numbers. */
export const isWeakCode = (raw: string) => {
  const code = raw.trim().toLowerCase();
  if (code.length < 6) return true;
  if (/^(.)\1+$/.test(code) || /^(..)\1+$/.test(code) || /^(...)\1+$/.test(code)) return true;
  if (/^\d+$/.test(code) && ("01234567890".includes(code) || "09876543210".includes(code))) return true;
  const digits = code.replace(/\D/g, "");
  return SALON_NUMBERS.some((n) => digits.includes(n) || (digits.length >= 6 && n.includes(digits)));
};
export const WEAK_CODE_HINT =
  "Use at least 6 characters. Avoid repeats (111111, 121212), runs (123456) and the salon's phone, plot or PIN code numbers.";

/* ── session tokens ─────────────────────────────────────────── */

function secret() {
  const s = process.env["ADMIN_SESSION_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!s) throw new Error("Admin sessions are not configured");
  return s;
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/**
 * A guest's key to one booking (returned by Manage booking lookups), so changes
 * can be authorised without sending the phone number back to the browser.
 */
export async function manageToken(reference: string) {
  return (await hmac(`manage:${reference}`)).slice(0, 32);
}
export async function checkManageToken(reference: string, token: string) {
  return token.length === 32 && same(token, await manageToken(reference));
}

/** Fingerprint of the stored code, so a code change revokes old sessions. */
async function codeVersion(stored: string) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(stored))).slice(0, 16);
}

async function issueToken(stored: string, weak: boolean) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const body = b64(
    enc.encode(JSON.stringify({ exp, iat: Date.now(), v: await codeVersion(stored), w: weak ? 1 : 0 })),
  );
  return { token: `${body}.${await hmac(body)}`, expiresAt: exp };
}

async function readSecret() {
  const { data } = await supabaseAdmin.from("admin_secret").select("pin").eq("id", 1).maybeSingle();
  if (!data?.pin) throw new Error("Admin access is not set up");
  return data.pin;
}

/** Verifies a session token and returns the service-role client. Throws when invalid. */
export async function assertAdmin(token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig || !same(sig, await hmac(body))) throw new Error("Session not valid");
  let claims: { exp?: number; v?: string; iat?: number };
  try {
    claims = JSON.parse(new TextDecoder().decode(unb64(body)));
  } catch {
    throw new Error("Session not valid");
  }
  if (!claims.exp || claims.exp < Date.now()) throw new Error("Session expired");
  if ((claims as { kind?: string }).kind === "stylist") throw new Error("Session not valid");
  const [secret, epoch] = await Promise.all([readSecret(), readEpoch()]);
  if (claims.v !== (await codeVersion(secret))) throw new Error("Session revoked");
  if (epoch && (claims.iat ?? 0) < epoch) throw new Error("Session revoked");
  return supabaseAdmin;
}

async function readEpoch(): Promise<number> {
  const { data } = await supabaseAdmin.from("site_settings").select("value").eq("key", EPOCH_KEY).maybeSingle();
  return Number((data?.value as { at?: number } | null)?.at ?? 0);
}

/** Signs out every admin session, on every device (including this one). */
export async function signOutEverywhere(token: string) {
  await assertAdmin(token);
  const { error } = await supabaseAdmin.from("site_settings").upsert({ key: EPOCH_KEY, value: { at: Date.now() } as never });
  return { ok: !error };
}

/** Lockout state and session policy, for the security panel. */
export async function securityStatus() {
  const now = Date.now();
  const g = prune(await readGuards(GUARD_KEY), now);
  const stored = await readSecret().catch(() => "");
  const devices = Object.values(g.devices);
  return {
    /** Wrong codes in the last 24 hours, from all devices. */
    failedAttempts: devices.reduce((n, e) => n + e.fails, 0),
    /** Devices locked out right now (each for its own wrong codes). */
    lockedDevices: devices.filter((e) => e.lockedUntil > now).length,
    /** The salon-wide backstop (never holds a device that signed in before). */
    backstopUntil: g.backstopUntil > now ? g.backstopUntil : 0,
    hashed: stored.startsWith("pbkdf2$"),
    sessionHours: SESSION_HOURS,
    attemptsBeforeLock: FREE_ATTEMPTS,
    dedicatedSecret: Boolean(process.env["ADMIN_SESSION_SECRET"]),
  };
}

/* ── throttling: per device, with a salon-wide backstop ──────── */

type Guard = { fails: number; lockedUntil: number };
type Entry = Guard & { at: number };
/** Stored per sign-in kind (console, stylists). */
type Guards = {
  devices: Record<string, Entry>;
  /** Devices that signed in successfully (last 60 days): never held by the backstop. */
  trusted: Record<string, number>;
  /** Times of recent misses from any device, for the backstop. */
  misses: number[];
  backstopUntil: number;
};
const BACKSTOP_MISSES = 30; // wrong codes per hour, from all devices together
const BACKSTOP_LOCK_MS = 15 * 60_000;
const DAY = 24 * 3600_000;

/** A scrambled code for this device's internet connection (never the address itself). */
async function deviceKey(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const ip = (h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
    if (!ip) return "unknown";
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`hb-guard:${ip}`)));
    return Array.from(d.slice(0, 10), (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return "unknown";
  }
}

async function readGuards(key: string): Promise<Guards> {
  const { data } = await supabaseAdmin.from("site_settings").select("value").eq("key", key).maybeSingle();
  const v = (data?.value ?? {}) as Partial<Guards>;
  // an older salon-wide lock ({fails, lockedUntil}) is simply dropped
  return {
    devices: v.devices && typeof v.devices === "object" ? v.devices : {},
    trusted: v.trusted && typeof v.trusted === "object" ? v.trusted : {},
    misses: Array.isArray(v.misses) ? v.misses : [],
    backstopUntil: typeof v.backstopUntil === "number" ? v.backstopUntil : 0,
  };
}

function prune(g: Guards, now: number): Guards {
  const devices = Object.fromEntries(
    Object.entries(g.devices)
      .filter(([, e]) => e.lockedUntil > now || now - e.at < DAY)
      .sort((x, y) => y[1].at - x[1].at)
      .slice(0, 300),
  );
  const trusted = Object.fromEntries(
    Object.entries(g.trusted)
      .filter(([, at]) => now - at < 60 * DAY)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 50),
  );
  return { devices, trusted, misses: g.misses.filter((t) => now - t < 3600_000).slice(-200), backstopUntil: g.backstopUntil };
}

const writeGuards = (key: string, g: Guards) =>
  supabaseAdmin.from("site_settings").upsert({ key, value: g as never });

/** Seconds this device must wait before trying again, or 0. */
function lockedFor(g: Guards, dev: string, now: number): number {
  const own = g.devices[dev]?.lockedUntil ?? 0;
  const backstop = g.trusted[dev] ? 0 : g.backstopUntil;
  const until = Math.max(own, backstop);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** Records a wrong code from this device; returns the lock or the tries left. */
async function recordMiss(key: string, g: Guards, dev: string, now: number) {
  const fails = (g.devices[dev]?.fails ?? 0) + 1;
  const rounds = Math.floor(fails / FREE_ATTEMPTS);
  const lockedUntil =
    fails % FREE_ATTEMPTS === 0 ? now + Math.min(BASE_LOCK_MS * 2 ** (rounds - 1), MAX_LOCK_MS) : 0;
  g.devices[dev] = { fails, lockedUntil, at: now };
  g.misses.push(now);
  if (g.misses.filter((t) => now - t < 3600_000).length >= BACKSTOP_MISSES) {
    g.backstopUntil = now + BACKSTOP_LOCK_MS;
    g.misses = [];
  }
  await writeGuards(key, prune(g, now));
  const wait = lockedFor(g, dev, now);
  return wait
    ? { ok: false as const, lockedFor: wait }
    : { ok: false as const, attemptsLeft: FREE_ATTEMPTS - (fails % FREE_ATTEMPTS) };
}

/** A correct code: this device's count resets and it is trusted from now on. */
async function recordSuccess(key: string, g: Guards, dev: string, now: number) {
  delete g.devices[dev];
  if (dev !== "unknown") g.trusted[dev] = now;
  await writeGuards(key, prune(g, now));
}

export type SignInResult =
  | { ok: true; token: string; expiresAt: number; weak: boolean }
  | { ok: false; lockedFor?: number; attemptsLeft?: number };

/** Exchanges the access code for a session token, with lockout after repeated misses. */
export async function signIn(code: string): Promise<SignInResult> {
  const now = Date.now();
  const [g, dev] = await Promise.all([readGuards(GUARD_KEY), deviceKey()]);
  const wait = lockedFor(g, dev, now);
  if (wait) return { ok: false, lockedFor: wait };

  const stored = await readSecret();
  if (!(await matches(code, stored))) return recordMiss(GUARD_KEY, g, dev, now);

  let current = stored;
  if (!stored.startsWith("pbkdf2$")) {
    current = await hashCode(code);
    await supabaseAdmin.from("admin_secret").update({ pin: current }).eq("id", 1);
  }
  await recordSuccess(GUARD_KEY, g, dev, now);
  return { ok: true, ...(await issueToken(current, isWeakCode(code))), weak: isWeakCode(code) };
}

/** Changes the access code. Requires the current code again, not just a session. */
export async function changeCode(token: string, current: string, next: string) {
  await assertAdmin(token);
  const stored = await readSecret();
  if (!(await matches(current, stored)))
    return { ok: false as const, error: "Current code doesn't match." };
  if (isWeakCode(next))
    return { ok: false as const, error: WEAK_CODE_HINT };
  const hashed = await hashCode(next);
  const { error } = await supabaseAdmin.from("admin_secret").update({ pin: hashed }).eq("id", 1);
  if (error) return { ok: false as const, error: "Couldn't save the new code." };
  return { ok: true as const, ...(await issueToken(hashed, false)) };
}


/* ── stylists: their own code, their own day ─────────────────── */

const STYLIST_CODES = "stylist_codes";
const STYLIST_GUARD = "stylist_guard";

async function stylistCodes(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("site_settings").select("value").eq("key", STYLIST_CODES).maybeSingle();
  const value = data?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

/** Which stylists have a code (never the codes themselves). */
export async function stylistsWithCodes(): Promise<string[]> {
  return Object.keys(await stylistCodes());
}

/** Sets (or with an empty code, removes) a stylist's access code; signs that stylist out everywhere. */
export async function setStylistCode(staffId: string, code: string) {
  const codes = await stylistCodes();
  if (code) codes[staffId] = await hashCode(code);
  else delete codes[staffId];
  const { error } = await supabaseAdmin.from("site_settings").upsert({ key: STYLIST_CODES, value: codes as never });
  return !error;
}

/** A stylist's code → a session for their own day only (same per-device lockout as the console, counted separately). */
export async function stylistSignIn(code: string): Promise<
  { ok: true; token: string; expiresAt: number; staffId: string } | { ok: false; lockedFor?: number; attemptsLeft?: number }
> {
  const now = Date.now();
  const [g, dev] = await Promise.all([readGuards(STYLIST_GUARD), deviceKey()]);
  const wait = lockedFor(g, dev, now);
  if (wait) return { ok: false, lockedFor: wait };
  const codes = await stylistCodes();
  let staffId: string | null = null;
  for (const [id, stored] of Object.entries(codes)) if (await matches(code, stored)) staffId = id;
  if (!staffId) return recordMiss(STYLIST_GUARD, g, dev, now);
  await recordSuccess(STYLIST_GUARD, g, dev, now);
  const exp = now + 14 * 3600_000;
  const body = b64(enc.encode(JSON.stringify({ kind: "stylist", sid: staffId, exp, iat: now, v: await codeVersion(codes[staffId]!) })));
  return { ok: true, token: `${body}.${await hmac(body)}`, expiresAt: exp, staffId };
}

/** Checks a stylist session; returns the stylist's id. A new code or "sign out everywhere" ends it. */
export async function assertStylist(token: string): Promise<string> {
  const [body, sig] = token.split(".");
  if (!body || !sig || !same(sig, await hmac(body))) throw new Error("Session not valid");
  let claims: { kind?: string; sid?: string; exp?: number; iat?: number; v?: string };
  try {
    claims = JSON.parse(new TextDecoder().decode(unb64(body)));
  } catch {
    throw new Error("Session not valid");
  }
  if (claims.kind !== "stylist" || !claims.sid) throw new Error("Session not valid");
  if (!claims.exp || claims.exp < Date.now()) throw new Error("Session expired");
  const [codes, epoch] = await Promise.all([stylistCodes(), readEpoch()]);
  const stored = codes[claims.sid];
  if (!stored || claims.v !== (await codeVersion(stored))) throw new Error("Session revoked");
  if (epoch && (claims.iat ?? 0) < epoch) throw new Error("Session revoked");
  return claims.sid;
}
