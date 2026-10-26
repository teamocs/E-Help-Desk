import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Runs the real migrations in an in-process Postgres and proves tenant isolation.
// PGlite connects as a superuser, so every check switches to `app_user` first, as the app will.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const AZALEA_PROPERTY = "a0a0a0a0-0000-4000-8000-000000000011";
const OTHER = "b0b0b0b0-0000-4000-8000-000000000001";
const OTHER_PROPERTY = "b0b0b0b0-0000-4000-8000-000000000011";

let db: PGlite;

/** Run `fn` as app_user with the org set for the transaction, like a server action will. */
async function asApp<T>(org: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', $1, true)", [org ?? ""]);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

const insertRequest = (org: string, property: string, no: number, room: string) =>
  db.query(
    `insert into requests (org_id, property_id, ticket_no, room, source, op_id)
     values ($1, $2, $3, $4, 'staff', gen_random_uuid())`,
    [org, property, no, room],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("migrations/0001_init.sql"));
  await db.exec(read("migrations/0002_rls.sql"));
  await db.exec(read("seed.sql"));
  await db.exec(`
    insert into orgs (id, name) values ('${OTHER}', 'Other Hotel');
    insert into properties (id, org_id, name) values ('${OTHER_PROPERTY}', '${OTHER}', 'Other Main');
  `);
  await insertRequest(AZALEA, AZALEA_PROPERTY, 1, "412");
  await insertRequest(OTHER, OTHER_PROPERTY, 1, "101");
});

describe("tenant isolation", () => {
  it("each org sees only its own rows", async () => {
    const a = await asApp(AZALEA, () => db.query<{ room: string }>("select room from requests"));
    const b = await asApp(OTHER, () => db.query<{ room: string }>("select room from requests"));
    expect(a.rows.map((r) => r.room)).toEqual(["412"]);
    expect(b.rows.map((r) => r.room)).toEqual(["101"]);
  });

  it("sees nothing when no org is set", async () => {
    const r = await asApp(null, () => db.query("select * from requests"));
    expect(r.rows).toHaveLength(0);
  });

  it("an org sees only its own org row and staff", async () => {
    const o = await asApp(AZALEA, () => db.query("select id from orgs"));
    const s = await asApp(OTHER, () => db.query("select id from staff"));
    expect(o.rows).toHaveLength(1);
    expect(s.rows).toHaveLength(0);
  });

  it("cannot insert a row for another org", async () => {
    await expect(asApp(AZALEA, () => insertRequest(OTHER, OTHER_PROPERTY, 2, "999"))).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another org's rows", async () => {
    const u = await asApp(AZALEA, () => db.query("update requests set room = 'x' where org_id = $1", [OTHER]));
    expect(u.affectedRows).toBe(0);
    const left = await asApp(OTHER, () => db.query("select room from requests"));
    expect(left.rows).toHaveLength(1);
  });

  it("a row cannot point at another org's property, even for the owner role", async () => {
    await expect(insertRequest(AZALEA, OTHER_PROPERTY, 3, "777")).rejects.toThrow(/foreign key/);
  });
});

describe("history and retries", () => {
  it("events can be added and read but never changed or removed", async () => {
    const id = (await db.query<{ id: string }>("select id from requests where org_id = $1", [AZALEA])).rows[0].id;
    await asApp(AZALEA, () =>
      db.query(
        `insert into events (org_id, property_id, entity, entity_id, what, op_id)
         values ($1, $2, 'request', $3, 'Logged', gen_random_uuid())`,
        [AZALEA, AZALEA_PROPERTY, id],
      ),
    );
    const read1 = await asApp(AZALEA, () => db.query("select what from events"));
    expect(read1.rows).toHaveLength(1);
    await expect(asApp(AZALEA, () => db.query("update events set what = 'edited'"))).rejects.toThrow(/permission denied/);
    await expect(asApp(AZALEA, () => db.query("delete from events"))).rejects.toThrow(/permission denied/);
    const other = await asApp(OTHER, () => db.query("select * from events"));
    expect(other.rows).toHaveLength(0);
  });

  it("a retried tap with the same op id is rejected instead of duplicated", async () => {
    const op = "c0c0c0c0-0000-4000-8000-000000000001";
    const add = () =>
      db.query(
        `insert into requests (org_id, property_id, ticket_no, room, source, op_id)
         values ($1, $2, $3, '600', 'staff', $4)`,
        [AZALEA, AZALEA_PROPERTY, Math.floor(Math.random() * 1e6) + 10, op],
      );
    await asApp(AZALEA, add);
    await expect(asApp(AZALEA, add)).rejects.toThrow(/unique|duplicate/);
  });

  it("app_user cannot create or drop tables", async () => {
    await expect(asApp(AZALEA, () => db.exec("create table evil (id int)"))).rejects.toThrow(/permission denied/);
  });
});

const MARIA = "a0a0a0a0-0000-4000-8000-000000000101";
const BAGUIO = "a0a0a0a0-0000-4000-8000-000000000012";

describe("least privilege", () => {
  it("the app cannot read PIN hashes or device tokens", async () => {
    await expect(asApp(AZALEA, () => db.query("select pin_hash from staff"))).rejects.toThrow(/permission denied/);
    await expect(asApp(AZALEA, () => db.query("select token_hash from devices"))).rejects.toThrow(/permission denied/);
    const ok = await asApp(AZALEA, () => db.query("select name from staff"));
    expect(ok.rows).toHaveLength(8);
  });

  it("the app cannot change staff roles or write members", async () => {
    await expect(asApp(AZALEA, () => db.query("update staff set role = 'owner'"))).rejects.toThrow(/permission denied/);
    await expect(
      asApp(AZALEA, () => db.query("insert into members (org_id, email, role) values ($1, 'x@y.z', 'owner')", [AZALEA])),
    ).rejects.toThrow(/permission denied/);
    await expect(asApp(AZALEA, () => db.query("update members set role = 'owner'"))).rejects.toThrow(/permission denied/);
  });

  it("incident text cannot be rewritten and a recorded 911 time is final", async () => {
    await db.query(
      `insert into incidents (org_id, property_id, inc_no, hazard, rooms, text, op_id)
       values ($1, $2, 1, 'smoke', array['612'], 'smoke in the hallway', gen_random_uuid())`,
      [AZALEA, AZALEA_PROPERTY],
    );
    await expect(asApp(AZALEA, () => db.query("update incidents set text = 'edited'"))).rejects.toThrow(/permission denied/);
    await asApp(AZALEA, () => db.query("update incidents set called911_at = now()"));
    await expect(
      asApp(AZALEA, () => db.query("update incidents set called911_at = now() + interval '1 hour'")),
    ).rejects.toThrow(/already recorded/);
  });
});

describe("sign-in functions", () => {
  it("a device token finds its org before any org is set, and a revoked one does not", async () => {
    await db.query("insert into devices (org_id, property_id, label, token_hash) values ($1, $2, 'Front desk', 'hash-1')", [
      AZALEA,
      AZALEA_PROPERTY,
    ]);
    const ok = await asApp(null, () => db.query("select * from device_by_token('hash-1')"));
    expect(ok.rows).toHaveLength(1);
    await db.query("update devices set revoked_at = now() where token_hash = 'hash-1'");
    const gone = await asApp(null, () => db.query("select * from device_by_token('hash-1')"));
    expect(gone.rows).toHaveLength(0);
  });

  it("a membership is claimed only with a verified email, and only once", async () => {
    const unverified = await asApp(null, () => db.query("select * from claim_membership('TeamOCSph@Gmail.com', 'user-1', false)"));
    expect(unverified.rows).toHaveLength(0);
    const first = await asApp(null, () => db.query("select * from claim_membership('TeamOCSph@Gmail.com', 'user-1', true)"));
    expect(first.rows).toEqual([{ org_id: AZALEA, role: "owner" }]);
    const attacker = await asApp(null, () => db.query("select * from claim_membership('teamocsph@gmail.com', 'user-2', true)"));
    expect(attacker.rows).toHaveLength(0);
    const who = await asApp(null, () => db.query("select * from member_for_user('user-1')"));
    expect(who.rows).toHaveLength(1);
  });

  it("five wrong PINs lock the person, and a right one clears it", async () => {
    const dev = (
      await db.query<{ id: string }>(
        "insert into devices (org_id, property_id, label, token_hash) values ($1, $2, 'Desk 2', 'hash-2') returning id",
        [AZALEA, AZALEA_PROPERTY],
      )
    ).rows[0].id;
    for (let i = 0; i < 5; i++) await asApp(AZALEA, () => db.query("select record_pin_attempt($1, $2, false)", [MARIA, dev]));
    const locked = await asApp(AZALEA, () => db.query<{ pin_failed: number; pin_locked_until: string | null }>("select * from staff_pin_state($1)", [MARIA]));
    expect(locked.rows[0].pin_failed).toBe(5);
    expect(locked.rows[0].pin_locked_until).not.toBeNull();
    await asApp(AZALEA, () => db.query("select record_pin_attempt($1, $2, true)", [MARIA, dev]));
    const clear = await asApp(AZALEA, () => db.query<{ pin_failed: number }>("select * from staff_pin_state($1)", [MARIA]));
    expect(clear.rows[0].pin_failed).toBe(0);
  });

  it("PIN state of another org's staff is not visible", async () => {
    const r = await asApp(OTHER, () => db.query("select * from staff_pin_state($1)", [MARIA]));
    expect(r.rows).toHaveLength(0);
  });
});

describe("property and history integrity", () => {
  it("an item cannot sit in a different property from its request", async () => {
    const req = await db.query<{ id: string }>(
      `insert into requests (org_id, property_id, ticket_no, room, source, op_id)
       values ($1, $2, 50, '888', 'staff', gen_random_uuid()) returning id`,
      [AZALEA, AZALEA_PROPERTY],
    );
    await expect(
      db.query(
        `insert into items (org_id, property_id, request_id, name, dept, sla_min)
         values ($1, $2, $3, 'Towels', 'housekeeping', 10)`,
        [AZALEA, BAGUIO, req.rows[0].id],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("one op can write two events on an entity, but not the same event twice", async () => {
    const id = (await db.query<{ id: string }>("select id from requests where org_id = $1 limit 1", [AZALEA])).rows[0].id;
    const op = "d0d0d0d0-0000-4000-8000-000000000001";
    const add = (what: string) =>
      db.query(
        `insert into events (org_id, property_id, entity, entity_id, what, op_id) values ($1, $2, 'request', $3, $4, $5)`,
        [AZALEA, AZALEA_PROPERTY, id, what, op],
      );
    await add("Relayed");
    await add("Done");
    await expect(add("Done")).rejects.toThrow(/unique|duplicate/);
  });
});

describe("seed", () => {
  it("has Azalea with two properties and eight staff, and is safe to run again", async () => {
    await db.exec(read("seed.sql"));
    const p = await db.query("select count(*)::int as n from properties where org_id = $1", [AZALEA]);
    const s = await db.query("select count(*)::int as n from staff where org_id = $1", [AZALEA]);
    expect((p.rows[0] as { n: number }).n).toBe(2);
    expect((s.rows[0] as { n: number }).n).toBe(8);
  });
});
