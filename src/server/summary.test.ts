import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Q } from "../lib/db";
import { loadSummary } from "./summary";

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const BORACAY = "a0a0a0a0-0000-4000-8000-000000000011";
const OTHER = "b0b0b0b0-0000-4000-8000-000000000001";
const OTHER_PROPERTY = "b0b0b0b0-0000-4000-8000-000000000011";
let db: PGlite;

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

const request = async (org: string, property: string, no: number) => {
  const r = await db.query<{ id: string }>(
    `insert into requests (org_id, property_id, ticket_no, room, source, op_id) values ($1, $2, $3, '101', 'staff', gen_random_uuid()) returning id`,
    [org, property, no],
  );
  return r.rows[0]!.id;
};
const item = (org: string, property: string, req: string, status: string, ageMin: number, sla: number) =>
  db.query(
    `insert into items (org_id, property_id, request_id, name, dept, status, sla_min, created_at)
     values ($1, $2, $3, 'Extra towels', 'housekeeping', $4, $5, now() - $6 * interval '1 minute')`,
    [org, property, req, status, sla, ageMin],
  );

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["migrations/0001_init.sql", "migrations/0002_rls.sql", "seed.sql"]) await db.exec(read(f));
  await db.exec(`insert into orgs (id, name) values ('${OTHER}', 'Other Hotel');
                 insert into properties (id, org_id, name) values ('${OTHER_PROPERTY}', '${OTHER}', 'Other Main')`);
  const r = await request(AZALEA, BORACAY, 9001);
  await item(AZALEA, BORACAY, r, "new", 120, 10); // open and overdue
  await item(AZALEA, BORACAY, r, "on_site", 5, 60); // open, inside its time
  await item(AZALEA, BORACAY, r, "on_hold", 300, 10); // open, but the clock is stopped
  await item(AZALEA, BORACAY, r, "done", 500, 10); // closed
  const o = await request(OTHER, OTHER_PROPERTY, 1);
  await item(OTHER, OTHER_PROPERTY, o, "new", 500, 10);
  await db.query(
    `insert into incidents (org_id, property_id, inc_no, hazard, rooms, text, status, op_id)
     values ($1, $2, 1, 'smoke', array['101'], 'smoke', 'active', gen_random_uuid()),
            ($1, $2, 2, 'gas', array['102'], 'gas', 'resolved', gen_random_uuid())`,
    [AZALEA, BORACAY],
  );
});

describe("loadSummary", () => {
  it("counts what an operator can act on, per property", async () => {
    const rows = await inOrg(AZALEA, loadSummary);
    const boracay = rows.find((r) => r.id === BORACAY)!;
    expect(boracay).toMatchObject({ name: expect.any(String), open: 3, overdue: 1, incidents: 1, workOrders: 0 });
  });

  it("lists every property, including ones with nothing going on", async () => {
    const rows = await inOrg(AZALEA, loadSummary);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows.filter((x) => x.id !== BORACAY)) expect(r).toMatchObject({ open: 0, overdue: 0, incidents: 0, workOrders: 0 });
  });

  it("never counts another hotel", async () => {
    const other = await inOrg(OTHER, loadSummary);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ open: 1, overdue: 1 });
    expect((await inOrg(AZALEA, loadSummary)).some((r) => r.id === OTHER_PROPERTY)).toBe(false);
  });
});
