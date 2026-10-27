import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Q } from "../lib/db";
import { ACTOR_HOURS, readActor, signActor } from "./actor";
import { hashPin, isWeakPin, verifyPin } from "./pin";
import { changePin, checkPin, createStaff, deactivateStaff } from "./staff";

process.env.NEON_AUTH_COOKIE_SECRET = "test-secret-test-secret-test-secret-123";

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const OTHER = "b0b0b0b0-0000-4000-8000-000000000001";
let db: PGlite;

/** One transaction as app_user with the org set, like tx(orgId, ...). */
async function inOrg<T>(org: string, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', $1, true)", [org]);
    const out = await fn((sql, params) => db.query(sql, params));
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

const person = { name: "Ana Reyes", title: "Room attendant", role: "staff", dept: "housekeeping" };
const add = (pin = "4729", input = person, org = AZALEA) => inOrg(org, (q) => createStaff(q, org, input, pin));
const check = (id: string, pin: string, org = AZALEA, user = org === AZALEA ? "u-test" : "u-other") =>
  inOrg(org, (q) => checkPin(q, id, user, pin));

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["migrations/0001_init.sql", "migrations/0002_rls.sql", "migrations/0003_onboarding.sql", "migrations/0004_pin_throttle.sql", "seed.sql"]) await db.exec(read(f));
  await db.exec(`insert into orgs (id, name) values ('${OTHER}', 'Other Hotel')`);
  await db.exec(`insert into members (org_id, email, user_id, role) values ('${AZALEA}', 'dev@x.test', 'u-test', 'owner'), ('${OTHER}', 'dev@o.test', 'u-other', 'owner')`);
});

describe("pin hashing", () => {
  it("verifies the right PIN and rejects others; hashes differ per call", async () => {
    const h = await hashPin("4729");
    expect(await verifyPin("4729", h)).toBe(true);
    expect(await verifyPin("4728", h)).toBe(false);
    expect(await verifyPin("4729", "garbage")).toBe(false);
    expect(await hashPin("4729")).not.toBe(h);
  });

  it("flags repeats and straight runs as weak", () => {
    for (const p of ["0000", "7777", "1234", "4321", "3456", "abcd", "123"]) expect(isWeakPin(p)).toBe(true);
    for (const p of ["4729", "1357", "1212", "9081"]) expect(isWeakPin(p)).toBe(false);
  });
});

describe("actor cookie", () => {
  const exp = Date.now() + ACTOR_HOURS * 3600_000;
  const a = { u: "user-1", p: "prop-1", s: "staff-1", exp };

  it("round-trips for the same user and property", () => {
    expect(readActor(signActor(a), "user-1", "prop-1")).toEqual(a);
  });

  it("is refused when forged, expired, or used by another user or property", () => {
    const t = signActor(a);
    const [body] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...a, s: "staff-2" })).toString("base64url");
    expect(readActor(`${forged}.${t.split(".")[1]}`, "user-1", "prop-1")).toBeNull();
    expect(readActor(`${body}.AAAA`, "user-1", "prop-1")).toBeNull();
    expect(readActor(t, "user-2", "prop-1")).toBeNull();
    expect(readActor(t, "user-1", "prop-2")).toBeNull();
    expect(readActor(t, "user-1", "prop-1", exp + 1)).toBeNull();
    expect(readActor(undefined, "user-1", "prop-1")).toBeNull();
  });
});

describe("staff and PIN sign-in", () => {
  it("creates a person, whose PIN works and whose wrong PIN does not", async () => {
    const r = await add();
    expect(r.ok).toBe(true);
    const id = (r as { id: string }).id;
    expect(await check(id, "4729")).toEqual({ ok: true });
    expect(await check(id, "4720")).toMatchObject({ ok: false });
    expect(await check(id, "4729")).toEqual({ ok: true }); // a success clears the count
  });

  it("never returns the PIN hash to the app role", async () => {
    await expect(inOrg(AZALEA, (q) => q("select pin_hash from staff"))).rejects.toThrow();
  });

  it("rejects bad input: weak PIN, owner role, unknown department, empty name", async () => {
    expect(await add("1234")).toMatchObject({ ok: false });
    expect(await add("4729", { ...person, role: "owner" })).toMatchObject({ ok: false });
    expect(await add("4729", { ...person, role: "manager" })).toMatchObject({ ok: false });
    expect(await add("4729", { ...person, dept: "nope" })).toMatchObject({ ok: false });
    expect(await add("4729", { ...person, name: "  " })).toMatchObject({ ok: false });
  });

  it("locks after five wrong tries, even for the right PIN", async () => {
    const id = ((await add("5821", { ...person, name: "Ben Cruz" })) as { id: string }).id;
    for (let i = 0; i < 5; i++) await check(id, "0000");
    const r = await check(id, "5821");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/too many/i);
  });

  it("answers the same for an unknown, inactive or other-hotel person", async () => {
    const id = ((await add("6153", { ...person, name: "Cara Dizon" })) as { id: string }).id;
    const wrong = await check(id, "0000");
    expect(await check("00000000-0000-4000-8000-0000000000aa", "6153")).toEqual(wrong);
    expect(await check(id, "6153", OTHER)).toEqual(wrong);
    expect(await inOrg(AZALEA, (q) => deactivateStaff(q, id))).toEqual({ ok: true });
    expect(await check(id, "6153")).toEqual(wrong);
  });

  it("changes a PIN, which then replaces the old one and clears a lockout", async () => {
    const id = ((await add("7392", { ...person, name: "Dan Evora" })) as { id: string }).id;
    for (let i = 0; i < 5; i++) await check(id, "0000");
    expect(await inOrg(AZALEA, (q) => changePin(q, id, "8264"))).toEqual({ ok: true });
    expect(await check(id, "7392")).toMatchObject({ ok: false });
    expect(await check(id, "8264")).toEqual({ ok: true });
  });

  it("stops one PIN being sprayed across many people from the same device account", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push(((await add("5821", { ...person, name: `Spray ${i}` })) as { id: string }).id);
    // The spray user is a fresh device account so earlier tests do not count.
    await db.exec(`insert into members (org_id, email, user_id, role) values ('${AZALEA}', 'spray@x.test', 'u-spray', 'manager')`);
    const wrong = (id: string) => check(id, "9999", AZALEA, "u-spray");
    for (let i = 0; i < 20; i++) expect(await wrong(ids[i]!)).toMatchObject({ ok: false });
    const blocked = await check(ids[20]!, "5821", AZALEA, "u-spray"); // the right PIN, but the device account is throttled
    expect(blocked).toMatchObject({ ok: false });
    expect((blocked as { error: string }).error).toMatch(/too many/i);
    expect(await check(ids[20]!, "5821", AZALEA, "u-test")).toEqual({ ok: true }); // other accounts are unaffected
  });

  it("cannot change the PIN of someone in another hotel", async () => {
    const id = ((await add("2954", { ...person, name: "Eli Fong" })) as { id: string }).id;
    expect(await inOrg(OTHER, (q) => changePin(q, id, "8264"))).toMatchObject({ ok: false });
    expect(await check(id, "2954")).toEqual({ ok: true });
  });
});
