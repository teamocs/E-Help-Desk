import { describe, expect, it } from "vitest";
import { readConfig } from "./config";
import { makeApi, session } from "./WpApp";

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
    expect(cfg.user).toEqual({ name: "X", role: "device", canManage: false });
    expect(cfg.pollMs).toBe(5000);
    expect(readConfig({ AZL: { ...cfg, pollMs: 99_000 } }).pollMs).toBe(30_000);
    expect(() => readConfig({})).toThrow();
  });
});
