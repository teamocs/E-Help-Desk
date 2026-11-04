import { describe, expect, it } from "vitest";
import { readConfig } from "./config";
import { app, ui } from "../domain/store";
import { connect, makeApi, session } from "./WpApp";

describe("WordPress desk wiring", () => {
  it("shows the sign-in prompt when WordPress answers 401", async () => {
    const cfg = readConfig({ AZL: { restUrl: "https://hotel.test/wp-json/azl-ehd/v1/", nonce: "n", loginUrl: "/wp-login.php", pollMs: 5000, property: { id: "1", name: "A" }, user: { name: "M", role: "manager", canManage: true }, version: "0.1.0" } });
    const api = makeApi(cfg, (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    expect(session.get().lost).toBe(false);
    await expect(api.poll()).rejects.toThrow();
    expect(session.get().lost).toBe(true);
  });

  it("reads window.AZL with safe defaults: unknown roles act as a shared device, polling stays within 5 to 30 s", () => {
    const cfg = readConfig({ AZL: { restUrl: "/x/", nonce: "n", pollMs: 1000, property: { id: 1 }, user: { name: "X", role: "administrator", canManage: "yes" } } });
    expect(cfg.user).toEqual({ name: "X", role: "device", canManage: false, modules: {} });
    expect(cfg.pollMs).toBe(5000);
    expect(readConfig({ AZL: { ...cfg, pollMs: 99_000 } }).pollMs).toBe(30_000);
    expect(() => readConfig({})).toThrow();
  });

  it("signs a staff member out, with the reason, when Staff phones are switched off while they are signed in", async () => {
    const cfg = readConfig({ AZL: { restUrl: "/x/", nonce: "n", pollMs: 5000, property: { id: "1", name: "A" }, user: { name: "Front desk phone", role: "device", canManage: false, modules: {} }, loginUrl: "/l", version: "0.6.0" } });
    const snap = (phone?: boolean) => ({ catalog: null, staff: [{ id: "s1", name: "Ana", initials: "A", role: "staff", title: "Housekeeper", onShift: true, ...(phone === undefined ? {} : { phone }) }], requests: [], items: [], wos: [], cleaning: [], incidents: [], handover: [], seq: {}, modules: {} });
    let signedOut = 0;
    let current = snap();
    const api = { snapshot: async () => ({ snapshot: current, actor: "s1" }), poll: async () => ({ changed: true }), pinSignOut: async () => { signedOut += 1; return { ok: true }; }, stamp: (c: unknown) => c, command: async () => ({ ok: true }) } as never;
    const stop = connect(cfg, api, () => {}, () => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(app.get().me).toBe("s1");
    current = snap(false);
    const { remote } = await import("../domain/remote");
    await remote.refresh();
    expect(app.get().me).toBeNull();
    expect(signedOut).toBe(1);
    expect(ui.get().screen).toBe("lock");
    expect(ui.get().lockNote).toMatch(/Staff phones were switched off/);
    stop();
  });
});
