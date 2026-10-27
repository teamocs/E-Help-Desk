import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Self-serve onboarding: a verified user creates a hotel, the owner invites managers.
// Runs the real migrations in an in-process Postgres and calls the functions as app_user.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";

let db: PGlite;

/** One statement as app_user. With no org set, like the sign-in lookups. */
async function asApp<T>(fn: () => Promise<T>, org = ""): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', $1, true)", [org]);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

const createOrg = (user: string, email: string, verified: boolean, org = "Rose Hotel", prop = "Rose Main") =>
  asApp(async () => (await db.query<{ org_id: string; property_id: string }>("select * from create_org($1, $2, $3, $4, $5)", [user, email, verified, org, prop])).rows[0]!);
// The server runs these with the caller's org set, as tx(orgId, ...) does.
const invite = (org: string, actor: string, email: string, role = "manager", setOrg = org) =>
  asApp(() => db.query("select invite_member($1, $2, $3, $4)", [org, actor, email, role]), setOrg);
const revoke = (org: string, actor: string, email: string, setOrg = org) =>
  asApp(() => db.query("select revoke_invite($1, $2, $3)", [org, actor, email]), setOrg);
const leave = (user: string) => asApp(() => db.query("select leave_org($1)", [user]));
const claim = (email: string, user: string) =>
  asApp(async () => (await db.query<{ org_id: string; role: string }>("select * from claim_membership($1, $2, true)", [email, user])).rows);
const members = (org: string) =>
  asApp(async () => (await db.query<{ email: string; role: string; user_id: string | null }>("select email, role, user_id from members order by email")).rows, org);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("migrations/0001_init.sql"));
  await db.exec(read("migrations/0002_rls.sql"));
  await db.exec(read("migrations/0003_onboarding.sql"));
  await db.exec(read("migrations/0004_pin_throttle.sql"));
  await db.exec(read("migrations/0005_device_role.sql"));
  await db.exec(read("seed.sql"));
});

describe("create_org", () => {
  it("makes the org, a first property and an owner linked to the user", async () => {
    const made = await createOrg("u-rose", "owner@rose.test", true);
    const known = await asApp(async () => (await db.query<{ org_id: string; role: string }>("select * from member_for_user('u-rose')")).rows);
    expect(known).toEqual([{ org_id: made.org_id, role: "owner" }]);
    const props = await asApp(async () => (await db.query<{ name: string }>("select name from properties")).rows, made.org_id);
    expect(props).toEqual([{ name: "Rose Main" }]);
  });

  it("refuses an unverified email", async () => {
    await expect(createOrg("u-x", "x@x.test", false)).rejects.toThrow(/verif/i);
  });

  it("refuses a user who already belongs to a hotel", async () => {
    await expect(createOrg("u-rose", "owner@rose.test", true, "Second", "Second Main")).rejects.toThrow(/already/i);
  });

  it("refuses empty or oversized names", async () => {
    await expect(createOrg("u-y", "y@y.test", true, "  ", "P")).rejects.toThrow(/name/i);
    await expect(createOrg("u-y", "y@y.test", true, "H", "x".repeat(81))).rejects.toThrow(/name/i);
  });

  it("keeps the new hotel invisible to others and others invisible to it", async () => {
    const made = await createOrg("u-lily", "owner@lily.test", true, "Lily Hotel", "Lily Main");
    expect((await members(made.org_id)).map((m) => m.email)).toEqual(["owner@lily.test"]);
    expect((await members(AZALEA)).some((m) => m.email === "owner@lily.test")).toBe(false);
  });
});

describe("invite_member and revoke_invite", () => {
  let org: string;
  beforeAll(async () => {
    org = (await createOrg("u-pine", "owner@pine.test", true, "Pine Hotel", "Pine Main")).org_id;
  });

  it("lets the owner invite a manager, who then claims it", async () => {
    await invite(org, "u-pine", "  Manager@Pine.test ");
    expect((await members(org)).find((m) => m.email === "manager@pine.test")).toMatchObject({ role: "manager", user_id: null });
    expect(await claim("manager@pine.test", "u-mgr")).toEqual([{ org_id: org, role: "manager" }]);
  });

  it("refuses an invite from a manager, a stranger or an owner of another hotel", async () => {
    await expect(invite(org, "u-mgr", "a@pine.test")).rejects.toThrow(/owner/i);
    await expect(invite(org, "u-nobody", "a@pine.test")).rejects.toThrow(/owner/i);
    await expect(invite(org, "u-rose", "a@pine.test")).rejects.toThrow(/owner/i);
  });

  it("only invites managers, with a valid email, once", async () => {
    await expect(invite(org, "u-pine", "boss@pine.test", "owner")).rejects.toThrow(/role/i);
    await expect(invite(org, "u-pine", "not-an-email")).rejects.toThrow(/email/i);
    await invite(org, "u-pine", "dup@pine.test");
    await expect(invite(org, "u-pine", "dup@pine.test")).rejects.toThrow(/already/i);
  });

  it("revokes only unclaimed invites, and only for the owner", async () => {
    await invite(org, "u-pine", "gone@pine.test");
    await expect(revoke(org, "u-mgr", "gone@pine.test")).rejects.toThrow(/owner/i);
    await revoke(org, "u-pine", "gone@pine.test");
    expect((await members(org)).some((m) => m.email === "gone@pine.test")).toBe(false);
    await revoke(org, "u-pine", "manager@pine.test"); // already claimed: nothing happens
    expect((await members(org)).some((m) => m.email === "manager@pine.test")).toBe(true);
  });

  it("refuses when the org in the call is not the org set for the transaction", async () => {
    await expect(invite(org, "u-pine", "a@pine.test", "manager", AZALEA)).rejects.toThrow(/owner/i);
    await expect(revoke(org, "u-pine", "a@pine.test", "")).rejects.toThrow(/owner/i);
  });

  it("caps how many people one hotel can invite", async () => {
    for (let i = 0; i < 60; i++) {
      try {
        await invite(org, "u-pine", `bulk${i}@pine.test`);
      } catch (e) {
        expect(String(e)).toMatch(/limit/i);
        return;
      }
    }
    throw new Error("expected a limit");
  });
});

describe("claim_membership with several invites", () => {
  it("claims one invite when the same email is invited to two hotels", async () => {
    const a = (await createOrg("u-a", "a@owner.test", true, "A Hotel", "A Main")).org_id;
    const b = (await createOrg("u-b", "b@owner.test", true, "B Hotel", "B Main")).org_id;
    await invite(a, "u-a", "both@x.test");
    await invite(b, "u-b", "both@x.test");
    expect(await claim("both@x.test", "u-both")).toHaveLength(1);
    const rows = [...(await members(a)), ...(await members(b))].filter((m) => m.email === "both@x.test");
    expect(rows.filter((m) => m.user_id === "u-both")).toHaveLength(1);
    expect(rows.filter((m) => m.user_id === null)).toHaveLength(1);
  });
});

describe("leave_org", () => {
  it("lets a manager leave and start their own hotel, but not an owner", async () => {
    const o = (await createOrg("u-oak", "owner@oak.test", true, "Oak Hotel", "Oak Main")).org_id;
    await invite(o, "u-oak", "m@oak.test");
    await claim("m@oak.test", "u-oak-mgr");
    await leave("u-oak-mgr");
    expect((await members(o)).some((m) => m.email === "m@oak.test")).toBe(false);
    await createOrg("u-oak-mgr", "m@oak.test", true, "Own Hotel", "Own Main");
    await expect(leave("u-oak")).rejects.toThrow(/owner/i);
  });
});

describe("new hotel throttle", () => {
  it("stops a flood of sign-ups", async () => {
    let refused = false;
    for (let i = 0; i < 25 && !refused; i++) {
      try {
        await createOrg(`u-flood-${i}`, `f${i}@flood.test`, true, `Flood ${i}`, "Main");
      } catch (e) {
        refused = /too many/i.test(String(e));
      }
    }
    expect(refused).toBe(true);
  });
});

describe("device accounts", () => {
  let org: string;
  beforeAll(async () => {
    await db.exec("update orgs set created_at = now() - interval '2 hours'"); // the flood test above used up the hourly cap
    org = (await createOrg("u-fir", "owner@fir.test", true, "Fir Hotel", "Fir Main")).org_id;
  });

  it("lets the owner invite a device account, which claims it with the device role", async () => {
    await invite(org, "u-fir", "frontdesk@fir.test", "device");
    expect(await claim("frontdesk@fir.test", "u-fir-device")).toEqual([{ org_id: org, role: "device" }]);
    const known = await asApp(async () => (await db.query<{ role: string }>("select role from member_for_user('u-fir-device')")).rows);
    expect(known).toEqual([{ role: "device" }]);
  });

  it("still refuses to invite an owner, and a device account cannot invite", async () => {
    await expect(invite(org, "u-fir", "boss@fir.test", "owner")).rejects.toThrow(/role/i);
    await expect(invite(org, "u-fir-device", "x@fir.test", "device")).rejects.toThrow(/owner/i);
    await expect(invite(org, "u-fir-device", "x@fir.test", "manager")).rejects.toThrow(/owner/i);
  });

  it("does not let a device account leave through leave_org", async () => {
    await leave("u-fir-device");
    expect((await members(org)).some((m) => m.email === "frontdesk@fir.test")).toBe(true);
  });

  it("only knows the three roles", async () => {
    await expect(db.exec(`insert into members (org_id, email, role) values ('${org}', 'z@fir.test', 'admin')`)).rejects.toThrow();
  });
});

describe("direct writes stay closed", () => {
  it("app_user cannot insert members itself", async () => {
    await expect(asApp(() => db.query("insert into members (org_id, email, role) values ($1, 'z@z.test', 'owner')", [AZALEA]), AZALEA)).rejects.toThrow();
  });
});
