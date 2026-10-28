import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { hashCode, insertCode, newCode } from "../../db/signup-code.mjs";

// Invite-code gated hotel creation (migration 0007). Runs the real migrations in an in-process Postgres;
// create_org is called as app_user, codes are issued as the owner the way db/issue-code.mjs does.
//
// Parallel safety (PGlite has one connection, so this is reasoned, not tested): create_org first locks
// the caller's signup_attempts row FOR UPDATE, so one user's attempts run one at a time and cannot all
// pass the "not locked" check. The code is consumed by a single UPDATE ... WHERE uses_left > 0 AND
// expires_at > now(), which row-locks it; a second transaction waiting on that lock re-checks the WHERE
// against the committed row (READ COMMITTED), so a single-use code cannot be spent twice.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const BAD = /not valid/i;

let db: PGlite;
const owner = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);

async function asApp<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', '', true)");
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

type Row = { org_id: string | null; property_id: string | null; refusal: string | null };
/** Raw call: a bad code comes back as a refusal row (so the failure count is kept), not an exception. */
const call = (user: string, code: string, name = `Hotel ${user}`) =>
  asApp(async () => (await db.query<Row>("select * from create_org($1, $2, true, $3, 'Main', $4)", [user, `${user}@x.test`, name, code])).rows[0]!);
const issue = (uses = 1, days = 7) => insertCode(owner, { uses, days, note: "test" }).then((r) => r.code);
const usesLeft = async (code: string) =>
  (await owner("select uses_left, used_by_org from signup_codes where code_hash = $1", [hashCode(code)])).rows[0] as { uses_left: number; used_by_org: string | null };

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["0001_init.sql", "0002_rls.sql", "0003_onboarding.sql", "0004_pin_throttle.sql", "0005_device_role.sql", "0007_signup_codes.sql"])
    await db.exec(read(`migrations/${f}`));
  await db.exec(read("seed.sql"));
});

describe("codes", () => {
  it("are 160-bit base32 in groups of four, and the hash ignores case, spaces and dashes", () => {
    const c = newCode();
    expect(c).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(newCode()).not.toBe(c);
    expect(hashCode(` ${c.toLowerCase().replace(/-/g, " ")} `)).toBe(hashCode(c));
    expect(hashCode(c)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("are stored as a hash only", async () => {
    const c = await issue();
    const cols = (await owner("select column_name from information_schema.columns where table_name = 'signup_codes'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain("code");
    expect((await owner("select count(*)::int as n from signup_codes where code_hash = $1", [hashCode(c)])).rows[0]!.n).toBe(1);
  });
});

describe("create_org with an invite code", () => {
  it("creates the org with a valid code and consumes one use", async () => {
    const c = await issue(2);
    const r = await call("u-valid", c);
    expect(r.refusal).toBeNull();
    expect(r.org_id).toBeTruthy();
    expect(await usesLeft(c)).toEqual({ uses_left: 1, used_by_org: r.org_id });
  });

  it("accepts the code typed in lower case with spaces", async () => {
    const c = await issue();
    expect((await call("u-typed", ` ${c.toLowerCase().replace(/-/g, " ")} `)).refusal).toBeNull();
  });

  it("refuses a single-use code the second time", async () => {
    const c = await issue(1);
    expect((await call("u-first", c)).refusal).toBeNull();
    const r = await call("u-second", c);
    expect(r.refusal).toMatch(BAD);
    expect(r.org_id).toBeNull();
    expect((await owner("select count(*)::int as n from members where user_id = 'u-second'")).rows[0]!.n).toBe(0);
  });

  it("refuses an expired code, with the same message as a wrong one", async () => {
    const expired = await issue(1, -1);
    const a = await call("u-expired", expired);
    const b = await call("u-wrong", newCode());
    const empty = await call("u-empty", "");
    expect(a.refusal).toMatch(BAD);
    expect(b.refusal).toBe(a.refusal);
    expect(empty.refusal).toBe(a.refusal);
    expect((await usesLeft(expired)).uses_left).toBe(1);
  });

  it("does not use up a code when another check refuses", async () => {
    const c = await issue(1);
    await expect(call("u-longname", c, "x".repeat(81))).rejects.toThrow(/name/i);
    expect((await usesLeft(c)).uses_left).toBe(1);
  });
});

describe("code guessing", () => {
  it("locks a user after five wrong codes, even for a later correct code, then lets them in after 15 minutes", async () => {
    const good = await issue(1);
    for (let i = 0; i < 5; i++) expect((await call("u-guess", newCode())).refusal).toMatch(BAD);
    await expect(call("u-guess", good)).rejects.toThrow(/too many/i);
    expect((await usesLeft(good)).uses_left).toBe(1);
    const lock = (await owner("select locked_until > now() + interval '14 minutes' as ok from signup_attempts where user_id = 'u-guess'")).rows[0];
    expect(lock).toEqual({ ok: true });
    await owner("update signup_attempts set locked_until = now() - interval '1 second' where user_id = 'u-guess'");
    expect((await call("u-guess", good)).refusal).toBeNull();
    expect((await owner("select count(*)::int as n from signup_attempts where user_id = 'u-guess'")).rows[0]!.n).toBe(0);
  });

  it("does not lock other users", async () => {
    for (let i = 0; i < 5; i++) await call("u-attacker", newCode());
    await expect(call("u-attacker", newCode())).rejects.toThrow(/too many/i);
    expect((await call("u-bystander", await issue())).refusal).toBeNull();
  });

  it("counts four failures without locking", async () => {
    for (let i = 0; i < 4; i++) await call("u-clumsy", newCode());
    expect((await call("u-clumsy", await issue())).refusal).toBeNull();
  });
});

describe("app_user has no direct access", () => {
  for (const sql of [
    "select * from signup_codes",
    "insert into signup_codes (code_hash, uses_left, expires_at) values (repeat('a', 64), 99, now() + interval '1 day')",
    "update signup_codes set uses_left = 99",
    "delete from signup_codes",
    "select * from signup_attempts",
    "insert into signup_attempts (user_id) values ('u-me')",
    "update signup_attempts set locked_until = null",
    "delete from signup_attempts",
  ]) {
    it(sql, async () => {
      await expect(asApp(() => db.query(sql))).rejects.toThrow(/permission denied/i);
    });
  }

  it("cannot call the old five-argument create_org", async () => {
    await expect(asApp(() => db.query("select * from create_org('u-old', 'o@x.test', true, 'Old', 'Main')"))).rejects.toThrow(/does not exist/i);
  });
});
