import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Q } from "./db";
import { resolveTenant } from "./tenant";

// Runs the real migrations in an in-process Postgres and calls resolveTenant as app_user with no
// org set, exactly as the dashboard does before it knows the org.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
let db: PGlite;

async function asApp<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', '', true)");
    const out = await fn((sql, params) => db.query(sql, params as unknown[]) as ReturnType<Q>);
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("migrations/0001_init.sql"));
  await db.exec(read("migrations/0002_rls.sql"));
  await db.exec(read("seed.sql"));
  await db.query("insert into members (org_id, email, role) values ($1, 'manager@example.com', 'manager')", [AZALEA]);
});

describe("resolveTenant", () => {
  it("a verified, invited email claims its membership and is remembered", async () => {
    const first = await asApp((q) => resolveTenant({ id: "u-owner", email: "TeamOCSph@Gmail.com", emailVerified: true }, q));
    expect(first).toEqual({ orgId: AZALEA, role: "owner" });
    const again = await asApp((q) => resolveTenant({ id: "u-owner", email: "teamocsph@gmail.com", emailVerified: false }, q));
    expect(again).toEqual({ orgId: AZALEA, role: "owner" });
  });

  it("an unverified email claims nothing and is told to verify", async () => {
    const r = await asApp((q) => resolveTenant({ id: "u-mgr", email: "manager@example.com", emailVerified: false }, q));
    expect(r).toBe("unverified");
    const rows = await db.query("select user_id from members where email = 'manager@example.com'");
    expect(rows.rows[0]).toEqual({ user_id: null });
  });

  it("the same email claims the membership once it is verified", async () => {
    const r = await asApp((q) => resolveTenant({ id: "u-mgr", email: "manager@example.com", emailVerified: true }, q));
    expect(r).toEqual({ orgId: AZALEA, role: "manager" });
  });

  it("a verified stranger is not invited", async () => {
    const r = await asApp((q) => resolveTenant({ id: "u-x", email: "stranger@example.com", emailVerified: true }, q));
    expect(r).toBeNull();
  });

  it("someone else cannot take an already claimed membership", async () => {
    const r = await asApp((q) => resolveTenant({ id: "u-thief", email: "teamocsph@gmail.com", emailVerified: true }, q));
    expect(r).toBeNull();
  });
});
