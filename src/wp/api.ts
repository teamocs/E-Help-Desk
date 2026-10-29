import type { Command, CommandResult, Snapshot } from "../server/contract";
import type { Outcome, StaffInput } from "../server/staff";
import type { AzlConfig } from "./config";

// The WordPress REST calls the desk makes (namespace azl-ehd/v1), over fetch with cookie auth and X-WP-Nonce.
//
// Failure rules, which decide what the offline outbox does:
// - The network failed, or the server answered 5xx, 408 or 429: throw. remote.ts keeps the command queued and retries.
// - The WordPress session ended (401, or 403 with an expired nonce): throw AuthError and call onAuthLost, so the
//   login prompt shows. The command also stays queued and goes out after the person signs in again.
// - Any other refusal (200 { ok: false }, 400, 403, 404, 409, 422...): return { ok: false, error } with the server's
//   message. remote.ts drops the command and shows the message. This includes 403 azl_needs_pin (no valid PIN token),
//   as in the Next.js desk, which refused a device command without a PIN the same way.
// - The PIN sign-in token (/pin/sign-in) goes out as X-Azl-Actor on every request.

export class AuthError extends Error {
  constructor() {
    super("Please sign in again.");
    this.name = "AuthError";
  }
}

export interface PollResult {
  seq: number;
  changed: boolean;
}

export interface WpApi {
  /** The desk state plus who is signed in with a PIN on this device (from the signed acting-staff token). */
  snapshot(): Promise<{ snapshot: Snapshot; actor: string | null }>;
  command(cmd: Command): Promise<CommandResult>;
  /** Cheap change check. `changed` is true when the server's sequence moved since the last poll. */
  poll(): Promise<PollResult>;
  pinSignIn(staffId: string, pin: string): Promise<Outcome<{ staffId: string }>>;
  pinSignOut(): Promise<void>;
  addStaff(input: StaffInput, pin: string): Promise<Outcome<{ id: string }>>;
  setPin(staffId: string, pin: string): Promise<Outcome>;
  removeStaff(staffId: string): Promise<Outcome>;
  /** The nonce now in use (WordPress may send a fresh one in the X-WP-Nonce response header). */
  readonly nonce: string;
}

export interface ApiDeps {
  fetch?: typeof fetch;
  onAuthLost?: () => void;
  /** Where the PIN sign-in token is kept. Default: this page only. */
  actor?: ActorStore;
}

/** The staff member signed in with a PIN on this device: the signed token /pin/sign-in returned. */
export interface Actor {
  token: string;
  staffId: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface ActorStore {
  get(): Actor | null;
  set(a: Actor | null): void;
}

export function memoryActor(): ActorStore {
  let a: Actor | null = null;
  return { get: () => (a && a.expiresAt > Date.now() ? a : null), set: (v) => void (a = v) };
}

/**
 * Keeps the PIN token across reloads on a shared phone (sessions stay open all shift). The server binds it to the
 * WordPress user and voids it on PIN sign-out, so a copied token is useless to another account.
 */
export function storageActor(key: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalThis.localStorage): ActorStore {
  const mem = memoryActor();
  return {
    get() {
      try {
        const raw = storage?.getItem(key);
        const a = raw ? (JSON.parse(raw) as Actor) : null;
        return a && typeof a.token === "string" && typeof a.staffId === "string" && Number(a.expiresAt) > Date.now() ? a : null;
      } catch {
        return mem.get();
      }
    },
    set(a) {
      mem.set(a);
      try {
        if (a) storage?.setItem(key, JSON.stringify(a));
        else storage?.removeItem(key);
      } catch {
        /* private mode: the page-only copy still works */
      }
    },
  };
}

interface Reply {
  status: number;
  data: unknown;
  headers: Headers;
}

const OFFLINE = "Could not reach the server. Check the connection and try again.";
const REFUSED = "The server refused that change.";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
/** A user-safe message from a WP_Error ({ code, message }) or a contract refusal ({ ok: false, error }). */
const messageOf = (data: unknown) =>
  isObj(data) && typeof data.message === "string" ? data.message : isObj(data) && typeof data.error === "string" ? data.error : REFUSED;
const codeOf = (data: unknown) => (isObj(data) && typeof data.code === "string" ? data.code : "");
const retryable = (status: number) => status >= 500 || status === 408 || status === 429;
const sessionEnded = (r: Reply) => r.status === 401 || (r.status === 403 && codeOf(r.data) === "rest_cookie_invalid_nonce");

/** Joins the REST base and a route. Works for /wp-json/ and ?rest_route= bases. */
export function routeUrl(restUrl: string, path: string, query?: Record<string, string>): string {
  let url = restUrl.replace(/\/+$/, "") + path;
  if (query) {
    const q = new URLSearchParams(query).toString();
    if (q) url += (url.includes("?") ? "&" : "?") + q;
  }
  return url;
}

export function createWpApi(cfg: Pick<AzlConfig, "restUrl" | "nonce">, deps: ApiDeps = {}): WpApi {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const actor = deps.actor ?? memoryActor();
  let nonce = cfg.nonce;
  let lastSeq: number | null = null;
  let etag: string | null = null;

  const lost = () => {
    deps.onAuthLost?.();
    return new AuthError();
  };

  /** One request. Throws only when the server could not be reached. */
  async function call(method: string, path: string, body?: unknown, extra?: { query?: Record<string, string>; headers?: Record<string, string> }): Promise<Reply> {
    const headers: Record<string, string> = { Accept: "application/json", "X-WP-Nonce": nonce, ...extra?.headers };
    const acting = actor.get();
    if (acting) headers["X-Azl-Actor"] = acting.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(routeUrl(cfg.restUrl, path, extra?.query), {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const fresh = res.headers.get("X-WP-Nonce");
    if (fresh) nonce = fresh;
    let data: unknown = null;
    if (res.status !== 204 && res.status !== 304) data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  }

  /** Staff and PIN calls: never throw; every failure becomes a message for the screen. */
  async function outcome<T extends object>(method: string, path: string, body: unknown, pick: (d: Record<string, unknown>) => T): Promise<Outcome<T>> {
    let r: Reply;
    try {
      r = await call(method, path, body);
    } catch {
      return { ok: false, error: OFFLINE };
    }
    if (sessionEnded(r)) {
      lost();
      return { ok: false, error: "Please sign in again." };
    }
    if (r.status >= 200 && r.status < 300 && !(isObj(r.data) && r.data.ok === false)) {
      return { ok: true, ...pick(isObj(r.data) ? r.data : {}) };
    }
    return { ok: false, error: retryable(r.status) ? OFFLINE : messageOf(r.data) };
  }

  return {
    get nonce() {
      return nonce;
    },

    async snapshot() {
      const r = await call("GET", "/snapshot");
      // A signed-in user without azl_use_desk gets 403 here: the desk cannot open, so show the login prompt.
      if (r.status === 401 || r.status === 403) throw lost();
      if (r.status < 200 || r.status >= 300 || !isObj(r.data)) throw new Error(messageOf(r.data));
      const { actor: named, ...snapshot } = r.data;
      return { snapshot: snapshot as unknown as Snapshot, actor: typeof named === "string" ? named : (actor.get()?.staffId ?? null) };
    },

    async command(cmd) {
      const r = await call("POST", "/command", cmd);
      if (sessionEnded(r)) throw lost();
      if (retryable(r.status)) throw new Error(`Server error ${r.status}`);
      // No valid PIN token (expired, signed out elsewhere, or none on a shared phone): forget it so a reload asks for the PIN.
      if (codeOf(r.data) === "azl_needs_pin") actor.set(null);
      if (r.status < 200 || r.status >= 300) return { ok: false, error: messageOf(r.data) };
      if (isObj(r.data) && r.data.ok === false) return { ok: false, error: messageOf(r.data) };
      const d = isObj(r.data) ? r.data : {};
      return { ...d, ok: true, applied: d.applied !== false } as CommandResult;
    },

    async poll() {
      const since = lastSeq ?? 0;
      const r = await call("GET", "/poll", undefined, { query: { since: String(since) }, headers: etag ? { "If-None-Match": etag } : {} });
      if (r.status === 401 || r.status === 403) throw lost();
      if (r.status === 304) return { seq: since, changed: false };
      if (r.status < 200 || r.status >= 300 || !isObj(r.data)) throw new Error(`Poll failed ${r.status}`);
      etag = r.headers.get("ETag");
      const seq = Number(r.data.rev ?? r.data.seq);
      const changed = lastSeq === null || (typeof r.data.changed === "boolean" ? r.data.changed : seq !== since);
      if (Number.isFinite(seq)) lastSeq = seq;
      return { seq: lastSeq ?? since, changed };
    },

    async pinSignIn(staffId, pin) {
      const r = await outcome("POST", "/pin/sign-in", { staffId, pin }, (d) => d);
      if (!r.ok) return r;
      if (typeof r.token !== "string") return { ok: false, error: REFUSED };
      const who = isObj(r.staff) && typeof r.staff.id === "string" ? r.staff.id : staffId;
      actor.set({ token: r.token, staffId: who, expiresAt: Number(r.expiresAt) || Date.now() + 12 * 3600_000 });
      return { ok: true, staffId: who };
    },
    async pinSignOut() {
      actor.set(null);
      await outcome("POST", "/pin/sign-out", {}, () => ({}));
    },
    addStaff: (input, pin) =>
      outcome("POST", "/staff", { name: input.name, title: input.title, role: input.role, dept: input.dept, pin }, (d) => ({ id: String(d.id ?? "") })),
    setPin: (staffId, pin) => outcome("PATCH", `/staff/${encodeURIComponent(staffId)}`, { pin }, () => ({})),
    removeStaff: (staffId) => outcome("PATCH", `/staff/${encodeURIComponent(staffId)}`, { active: false }, () => ({})),
  };
}
