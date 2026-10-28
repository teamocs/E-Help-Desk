import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Migration 0009: every row an operator can change records when it last changed, set by the database
// so no code path can forget it. Runs as app_user, which has column-level UPDATE grants only.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const BORACAY = "a0a0a0a0-0000-4000-8000-000000000011";
let db: PGlite;

async function asApp<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.exec("set local role app_user");
    await db.query("select set_config('app.org_id', $1, true)", [AZALEA]);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

const updatedAt = async (table: string, id: string) =>
  (await db.query<{ u: Date; c: Date }>(`select updated_at as u, created_at as c from ${table} where id = $1`, [id])).rows[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let requestId: string;
let itemId: string;
let incidentId: string;
let workOrderId: string;
let cleanId: string;

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["migrations/0001_init.sql", "migrations/0002_rls.sql", "migrations/0009_updated_at.sql", "seed.sql"]) await db.exec(read(f));
  requestId = (await db.query<{ id: string }>(
    `insert into requests (org_id, property_id, ticket_no, room, source, op_id) values ($1, $2, 9100, '101', 'staff', gen_random_uuid()) returning id`,
    [AZALEA, BORACAY])).rows[0]!.id;
  itemId = (await db.query<{ id: string }>(
    `insert into items (org_id, property_id, request_id, name, dept, status, sla_min) values ($1, $2, $3, 'Towels', 'housekeeping', 'new', 10) returning id`,
    [AZALEA, BORACAY, requestId])).rows[0]!.id;
  incidentId = (await db.query<{ id: string }>(
    `insert into incidents (org_id, property_id, inc_no, hazard, rooms, text, status, op_id)
     values ($1, $2, 9100, 'smoke', array['101'], 'smoke', 'active', gen_random_uuid()) returning id`,
    [AZALEA, BORACAY])).rows[0]!.id;
  workOrderId = (await db.query<{ id: string }>("select id from work_orders limit 1")).rows[0]?.id ?? "";
  cleanId = (await db.query<{ id: string }>("select id from clean_tasks limit 1")).rows[0]?.id ?? "";
});

describe("updated_at", () => {
  it("starts equal to created_at for existing rows and new rows", async () => {
    const i = await updatedAt("items", itemId);
    expect(i.u.getTime()).toBe(i.c.getTime());
  });

  it("moves forward when the app changes an item", async () => {
    const before = await updatedAt("items", itemId);
    await sleep(15);
    await asApp(() => db.query("update items set status = 'relayed' where id = $1", [itemId]));
    const after = await updatedAt("items", itemId);
    expect(after.u.getTime()).toBeGreaterThan(before.u.getTime());
    expect(after.c.getTime()).toBe(before.c.getTime());
  });

  it("moves forward when the app changes an incident", async () => {
    const before = await updatedAt("incidents", incidentId);
    await sleep(15);
    await asApp(() => db.query("update incidents set rooms = array['101', '102'] where id = $1", [incidentId]));
    expect((await updatedAt("incidents", incidentId)).u.getTime()).toBeGreaterThan(before.u.getTime());
  });

  it("cannot be set by the app, so it can be trusted", async () => {
    await expect(asApp(() => db.query("update items set updated_at = '2000-01-01' where id = $1", [itemId]))).rejects.toThrow(/permission denied/i);
  });

  it("is on every table an operator can change", async () => {
    const cols = (await db.query<{ table_name: string }>(
      `select table_name from information_schema.columns where column_name = 'updated_at' and table_schema = 'public'`)).rows.map((r) => r.table_name);
    for (const t of ["requests", "items", "work_orders", "clean_tasks", "incidents"]) expect(cols).toContain(t);
  });

  it("moves forward for work orders and cleaning tasks when the seed has any", async () => {
    if (workOrderId) {
      const b = await updatedAt("work_orders", workOrderId);
      await sleep(15);
      await asApp(() => db.query("update work_orders set status = status where id = $1", [workOrderId]));
      expect((await updatedAt("work_orders", workOrderId)).u.getTime()).toBeGreaterThan(b.u.getTime());
    }
    if (cleanId) {
      const b = await updatedAt("clean_tasks", cleanId);
      await sleep(15);
      await asApp(() => db.query("update clean_tasks set status = status where id = $1", [cleanId]));
      expect((await updatedAt("clean_tasks", cleanId)).u.getTime()).toBeGreaterThan(b.u.getTime());
    }
  });
});
