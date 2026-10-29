import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command, Snapshot } from "../server/contract";
import { memoryOutbox } from "../domain/outbox";
import { remote } from "../domain/remote";
import { AuthError, createWpApi, memoryActor, routeUrl, storageActor } from "./api";

const BASE = "https://hotel.test/wp-json/azl-ehd/v1/";
const cfg = { restUrl: BASE, nonce: "n1" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch double: records every call and answers from `reply`. */
function fakeFetch(reply: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    return reply(c, calls.length);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const snap = { property: { id: "1", name: "Azalea Baguio" }, staff: [], requests: [], items: {}, wos: [], cleaning: [], incidents: [], handover: {}, seq: { id: 0 }, at: 1 } as unknown as Snapshot;
const relay = (itemId: string): Command => ({ opId: `op-${itemId}`, type: "relay", itemId });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 300 && !(await f()); i++) await wait(5);
  expect(await f()).toBe(true);
};

afterEach(() => remote.disable());

describe("routeUrl", () => {
  it("joins pretty and plain-permalink REST bases", () => {
    expect(routeUrl(BASE, "/poll", { since: "4" })).toBe("https://hotel.test/wp-json/azl-ehd/v1/poll?since=4");
    expect(routeUrl("https://hotel.test/?rest_route=/azl-ehd/v1/", "/poll", { since: "4" })).toBe("https://hotel.test/?rest_route=/azl-ehd/v1/poll&since=4");
  });
});

describe("snapshot", () => {
  it("loads the snapshot with the nonce and cookie credentials, and splits off the acting staff id", async () => {
    const f = fakeFetch(() => json(200, { ...snap, actor: "s-9" }));
    const api = createWpApi(cfg, { fetch: f.fetch });
    const r = await api.snapshot();
    expect(f.calls[0]!.url).toBe(`${BASE}snapshot`);
    expect(f.calls[0]!.method).toBe("GET");
    expect(f.calls[0]!.headers["X-WP-Nonce"]).toBe("n1");
    expect(f.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    expect(r.actor).toBe("s-9");
    expect(r.snapshot).toEqual(snap);
  });

  it("asks for a new sign-in on 401 or 403", async () => {
    for (const status of [401, 403]) {
      const onAuthLost = vi.fn();
      const api = createWpApi(cfg, { fetch: fakeFetch(() => json(status, { code: "rest_forbidden", message: "No" })).fetch, onAuthLost });
      await expect(api.snapshot()).rejects.toBeInstanceOf(AuthError);
      expect(onAuthLost).toHaveBeenCalledOnce();
    }
  });
});

describe("command", () => {
  it("posts the command as JSON with the nonce, and picks up a refreshed nonce", async () => {
    const f = fakeFetch((_c, n) => json(200, { ok: true, applied: true, ticketNo: 7 }, n === 1 ? { "X-WP-Nonce": "n2" } : {}));
    const api = createWpApi(cfg, { fetch: f.fetch });
    expect(await api.command(relay("a"))).toEqual({ ok: true, applied: true, ticketNo: 7 });
    await api.command(relay("b"));
    expect(f.calls[0]!.url).toBe(`${BASE}command`);
    expect(f.calls[0]!.method).toBe("POST");
    expect(f.calls[0]!.headers["Content-Type"]).toBe("application/json");
    expect(f.calls[0]!.body).toEqual(relay("a"));
    expect(f.calls[0]!.headers["X-WP-Nonce"]).toBe("n1");
    expect(f.calls[1]!.headers["X-WP-Nonce"]).toBe("n2");
    expect(api.nonce).toBe("n2");
  });

  it("turns a refusal into { ok: false } with the server's message", async () => {
    const api = createWpApi(cfg, { fetch: fakeFetch(() => json(422, { code: "azl_invalid", message: "Room 999 does not exist." })).fetch });
    expect(await api.command(relay("a"))).toEqual({ ok: false, error: "Room 999 does not exist." });
    const api2 = createWpApi(cfg, { fetch: fakeFetch(() => json(200, { ok: false, error: "Sign in with your PIN first." })).fetch });
    expect(await api2.command(relay("a"))).toEqual({ ok: false, error: "Sign in with your PIN first." });
  });

  it("a role refusal (403) is a refusal, but an expired nonce or 401 ends the session", async () => {
    const onAuthLost = vi.fn();
    const forbidden = createWpApi(cfg, { fetch: fakeFetch(() => json(403, { code: "rest_forbidden", message: "Managers only." })).fetch, onAuthLost });
    expect(await forbidden.command(relay("a"))).toEqual({ ok: false, error: "Managers only." });
    expect(onAuthLost).not.toHaveBeenCalled();

    const expired = createWpApi(cfg, { fetch: fakeFetch(() => json(403, { code: "rest_cookie_invalid_nonce", message: "Cookie check failed" })).fetch, onAuthLost });
    await expect(expired.command(relay("a"))).rejects.toBeInstanceOf(AuthError);
    const signedOut = createWpApi(cfg, { fetch: fakeFetch(() => json(401, { code: "rest_not_logged_in" })).fetch, onAuthLost });
    await expect(signedOut.command(relay("a"))).rejects.toBeInstanceOf(AuthError);
    expect(onAuthLost).toHaveBeenCalledTimes(2);
  });

  it("throws on a server error so the outbox retries", async () => {
    const api = createWpApi(cfg, { fetch: fakeFetch(() => json(503, { message: "busy" })).fetch });
    await expect(api.command(relay("a"))).rejects.toThrow("503");
  });
});

describe("poll", () => {
  it("reports a change only when the sequence moves, and sends the ETag back", async () => {
    const answers = [json(200, { ok: true, rev: 4, changed: true }, { ETag: '"4"' }), new Response(null, { status: 304 }), json(200, { rev: 4 }), json(200, { ok: true, rev: 6, changed: true })];
    const f = fakeFetch((_c, n) => answers[n - 1]!);
    const api = createWpApi(cfg, { fetch: f.fetch });
    expect(await api.poll()).toEqual({ seq: 4, changed: true }); // first poll: always refresh once
    expect(await api.poll()).toEqual({ seq: 4, changed: false });
    expect(f.calls[1]!.url).toBe(`${BASE}poll?since=4`);
    expect(f.calls[1]!.headers["If-None-Match"]).toBe('"4"');
    expect(await api.poll()).toEqual({ seq: 4, changed: false });
    expect(await api.poll()).toEqual({ seq: 6, changed: true });
    expect(f.calls[3]!.url).toBe(`${BASE}poll?since=4`);
  });

  it("asks for a new sign-in on 401", async () => {
    const onAuthLost = vi.fn();
    const api = createWpApi(cfg, { fetch: fakeFetch(() => json(401, { code: "rest_not_logged_in" })).fetch, onAuthLost });
    await expect(api.poll()).rejects.toBeInstanceOf(AuthError);
    expect(onAuthLost).toHaveBeenCalledOnce();
  });
});

describe("PIN and staff calls", () => {
  it("signs in with a PIN and returns the server's refusal message on a wrong PIN", async () => {
    const f = fakeFetch((c) => (c.body && (c.body as { pin: string }).pin === "2468" ? json(200, { ok: true, token: "t1", expiresAt: Date.now() + 60_000, staff: { id: "s1", name: "Ana" } }) : json(200, { ok: false, error: "That name and PIN do not match." })));
    const api = createWpApi(cfg, { fetch: f.fetch });
    expect(await api.pinSignIn("s1", "1357")).toEqual({ ok: false, error: "That name and PIN do not match." });
    expect(await api.pinSignIn("s1", "2468")).toEqual({ ok: true, staffId: "s1" });
    expect(f.calls[1]!.url).toBe(`${BASE}pin/sign-in`);
    expect(f.calls[1]!.body).toEqual({ staffId: "s1", pin: "2468" });
  });

  it("sends the PIN token as X-Azl-Actor until PIN sign-out, and keeps it across a reload", async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const f = fakeFetch((c) =>
      c.url.endsWith("sign-in") ? json(200, { ok: true, token: "t1", expiresAt: Date.now() + 60_000, staff: { id: "s1", name: "Ana" } })
        : c.url.endsWith("/snapshot") ? json(200, snap) : json(200, { ok: true, applied: true }));
    const api = createWpApi(cfg, { fetch: f.fetch, actor: storageActor("k", storage) });
    await api.command(relay("a"));
    expect(f.calls[0]!.headers["X-Azl-Actor"]).toBeUndefined();
    await api.pinSignIn("s1", "2468");
    await api.command(relay("b"));
    expect(f.calls[2]!.headers["X-Azl-Actor"]).toBe("t1");
    // A reload: a new api over the same storage still knows who is acting.
    const again = createWpApi(cfg, { fetch: f.fetch, actor: storageActor("k", storage) });
    expect((await again.snapshot()).actor).toBe("s1");
    await again.pinSignOut();
    await again.command(relay("c"));
    expect(f.calls.at(-1)!.headers["X-Azl-Actor"]).toBeUndefined();
    expect(mem.size).toBe(0);
  });

  it("forgets the PIN token when the server says it is no longer valid", async () => {
    const actor = memoryActor();
    actor.set({ token: "old", staffId: "s1", expiresAt: Date.now() + 60_000 });
    const api = createWpApi(cfg, { fetch: fakeFetch(() => json(403, { ok: false, error: "Sign in with your PIN again.", code: "azl_needs_pin" })).fetch, actor });
    expect(await api.command(relay("a"))).toEqual({ ok: false, error: "Sign in with your PIN again." });
    expect(actor.get()).toBeNull();
  });

  it("never throws from a staff call when offline", async () => {
    const api = createWpApi(cfg, { fetch: fakeFetch(() => Promise.reject(new TypeError("Failed to fetch"))).fetch });
    expect((await api.pinSignIn("s1", "2468")).ok).toBe(false);
    await expect(api.pinSignOut()).resolves.toBeUndefined();
  });

  it("adds, re-pins and deactivates staff on the documented routes", async () => {
    const f = fakeFetch((c) => json(200, c.method === "POST" ? { ok: true, id: "s5" } : { ok: true }));
    const api = createWpApi(cfg, { fetch: f.fetch });
    expect(await api.addStaff({ name: "Ana Cruz", title: "Room attendant", role: "staff", dept: "hk" }, "2468")).toEqual({ ok: true, id: "s5" });
    await api.setPin("s5", "1357");
    await api.removeStaff("s5");
    expect(f.calls.map((c) => `${c.method} ${c.url.slice(BASE.length - 1)}`)).toEqual(["POST /staff", "PATCH /staff/s5", "PATCH /staff/s5"]);
    expect(f.calls[0]!.body).toEqual({ name: "Ana Cruz", title: "Room attendant", role: "staff", dept: "hk", pin: "2468" });
    expect(f.calls[1]!.body).toEqual({ pin: "1357" });
    expect(f.calls[2]!.body).toEqual({ active: false });
  });
});

describe("with the offline outbox", () => {
  function enable(api: ReturnType<typeof createWpApi>, outbox = memoryOutbox()) {
    const errors: string[] = [];
    remote.enable({ run: (c) => api.command(c), load: async () => (await api.snapshot()).snapshot }, { snapshot: () => {}, error: (m) => errors.push(m) }, { scope: "wp:1", outbox, retryMs: 5 });
    return { outbox, errors };
  }
  const commandCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/command"));
  const answer = (c: Call) => (c.url.endsWith("/snapshot") ? json(200, snap) : json(200, { ok: true, applied: true }));

  it("keeps a command through a dropped connection and resends it with the same op id", async () => {
    let drops = 2;
    const f = fakeFetch((c) => (c.url.endsWith("/command") && drops-- > 0 ? Promise.reject(new TypeError("Failed to fetch")) : answer(c)));
    const t = enable(createWpApi(cfg, { fetch: f.fetch }));
    remote.send({ type: "relay", itemId: "a" });
    await until(() => commandCalls(f.calls).length === 3 && !remote.busy);
    expect(new Set(commandCalls(f.calls).map((c) => (c.body as Command).opId)).size).toBe(1);
    expect(await t.outbox.all("wp:1")).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("keeps the command queued when the session ends, instead of dropping it", async () => {
    const onAuthLost = vi.fn();
    const f = fakeFetch((c) => (c.url.endsWith("/command") ? json(401, { code: "rest_not_logged_in" }) : answer(c)));
    const t = enable(createWpApi(cfg, { fetch: f.fetch, onAuthLost }));
    remote.send({ type: "relay", itemId: "a" });
    await until(() => onAuthLost.mock.calls.length > 0);
    expect(remote.busy).toBe(true);
    await until(async () => (await t.outbox.all("wp:1")).length === 1);
    expect(t.errors).toEqual([]);
  });

  it("replays a queued command after a reload exactly once, and never again after it was accepted", async () => {
    const outbox = memoryOutbox();
    await outbox.add("wp:1", relay("a"));
    const f = fakeFetch(answer);
    enable(createWpApi(cfg, { fetch: f.fetch }), outbox);
    await until(async () => commandCalls(f.calls).length === 1 && !remote.busy && (await outbox.all("wp:1")).length === 0);
    remote.disable();
    // A second page load with the same outbox: nothing left to send.
    enable(createWpApi(cfg, { fetch: f.fetch }), outbox);
    await wait(50);
    expect(commandCalls(f.calls)).toHaveLength(1);
    expect((commandCalls(f.calls)[0]!.body as Command).opId).toBe("op-a");
  });
});
