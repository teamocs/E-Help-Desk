import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as client from "../domain/store";
import { pad } from "../domain/rules";
import type { Q } from "../lib/db";
import type { Command, Ctx } from "./contract";
import { applyCommand } from "./mutations";
import { loadSnapshot } from "./snapshot";

// Every command runs as app_user in its own transaction with the org set, as in production.

const read = (f: string) => readFileSync(join(process.cwd(), "db", f), "utf8");
const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const BORACAY = "a0a0a0a0-0000-4000-8000-000000000011";
const BAGUIO = "a0a0a0a0-0000-4000-8000-000000000012";
const MARIA = "a0a0a0a0-0000-4000-8000-000000000101";
const RAMON = "a0a0a0a0-0000-4000-8000-000000000103";
const OTHER = "b0b0b0b0-0000-4000-8000-000000000001";
const OTHER_PROPERTY = "b0b0b0b0-0000-4000-8000-000000000011";
const ME: Ctx = { orgId: AZALEA, propertyId: BORACAY, actorStaffId: MARIA };

let db: PGlite;
const q: Q = (sql, params) => db.query(sql, params);
const id = () => crypto.randomUUID();

async function asApp<T>(org: string, fn: () => Promise<T>): Promise<T> {
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

const run = (cmd: Command, ctx = ME) => asApp(ctx.orgId, () => applyCommand(q, ctx, cmd));
const snapshot = () => asApp(AZALEA, () => loadSnapshot(q, AZALEA, BORACAY));

/** Logs a request and returns its id, item ids and result. Bundles here have two parts. */
async function logged(room: string, presets: string[], extra: { bundle?: string; later?: boolean } = {}) {
  const requestId = id();
  const itemIds = Array.from({ length: presets.length + (extra.bundle ? 2 : 0) }, id);
  const res = await run({ type: "logRequest", opId: id(), requestId, itemIds, room, presets, ...extra });
  return { requestId, itemIds, res };
}

const step = (type: "relay" | "onSite" | "resume", itemId: string) => run({ type, opId: id(), itemId });
const finish = (itemId: string, status: "done" | "cant_do" = "done") => run({ type: "finish", opId: id(), itemId, status });

interface ItemState {
  name: string; dept: string; status: string; sla_min: number; held_ms: number; ack_at: Date | null;
  assignee: string | null; depends_on: string | null; wo_id: string | null; x_from: string | null;
}
const itemRow = async (itemId: string) =>
  (await db.query<ItemState>(
    "select name, dept, status, sla_min, held_ms::float8 as held_ms, ack_at, assignee, depends_on, wo_id, x_from from items where id = $1",
    [itemId],
  )).rows[0];
const labels = async (entityId: string) =>
  (await db.query<{ what: string }>("select what from events where entity_id = $1 order by at, id", [entityId])).rows.map((r) => r.what);
const backdateHold = (itemId: string, minutes: number) =>
  db.query("update items set hold_since = hold_since - make_interval(mins => $2) where id = $1", [itemId, minutes]);
const cleanTask = async (room: string, status: string) =>
  (await db.query<{ id: string }>(
    "insert into clean_tasks (org_id, property_id, room, type, status) values ($1, $2, $3, 'Checkout', $4) returning id",
    [AZALEA, BORACAY, room, status],
  )).rows[0].id;
const cleanStatus = async (taskId: string) =>
  (await db.query<{ status: string }>("select status from clean_tasks where id = $1", [taskId])).rows[0].status;

/** Everything a replay could change: row contents, event count and the counters. */
async function fingerprint() {
  const hash = (t: string) => `(select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from ${t} x)`;
  const tables = ["requests", "items", "work_orders", "clean_tasks", "incidents", "properties"];
  return (await db.query(`select (select count(*) from events)::int as events, ${tables.map((t) => `${hash(t)} as ${t}`).join(", ")}`)).rows[0];
}

/** Applies a command, then applies it again and checks the second time changed nothing. */
async function twice(cmd: Command) {
  const first = await run(cmd);
  expect(first).toMatchObject({ ok: true, applied: true });
  const before = await fingerprint();
  const again = await run(cmd);
  expect(again).toMatchObject({ ok: true, applied: false });
  expect(await fingerprint()).toEqual(before);
  return { first, again };
}

/** An on-site engineering item, ready to escalate. */
async function onSiteAc(room: string) {
  const { itemIds } = await logged(room, ["ac"]);
  await step("onSite", itemIds[0]);
  return itemIds[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("migrations/0001_init.sql"));
  await db.exec(read("migrations/0002_rls.sql"));
  await db.exec(read("seed.sql"));
  await db.query("insert into orgs (id, name) values ($1, 'Other Hotel')", [OTHER]);
  await db.query("insert into properties (id, org_id, name) values ($1, $2, 'Other Main')", [OTHER_PROPERTY, OTHER]);
});

describe("logRequest", () => {
  it("builds items from presets on the server and numbers tickets in order", async () => {
    const a = await logged("301", ["towels", "ac"]);
    const b = await logged("302", ["water"]);
    expect(a.res).toMatchObject({ ok: true, applied: true });
    if (!a.res.ok || !b.res.ok) throw new Error("not logged");
    expect(b.res.ticketNo).toBe((a.res.ticketNo ?? 0) + 1);
    expect(await itemRow(a.itemIds[0])).toMatchObject({ name: "Extra towels", dept: "housekeeping", sla_min: 10, status: "new" });
    expect(await itemRow(a.itemIds[1])).toMatchObject({ name: "AC not cold", dept: "engineering", sla_min: 45 });
    expect(await labels(a.itemIds[0])).toEqual(["Logged"]);
  });

  it("makes the bundle's later part depend on the earlier one", async () => {
    const { itemIds } = await logged("303", [], { bundle: "leak" });
    expect(await itemRow(itemIds[1])).toMatchObject({ name: "Leak: clean up", depends_on: itemIds[0] });
  });

  it("rejects an unknown preset or a wrong number of item ids and writes nothing", async () => {
    const before = await fingerprint();
    const bad = await run({ type: "logRequest", opId: id(), requestId: id(), itemIds: [id()], room: "304", presets: ["caviar"] });
    const short = await run({ type: "logRequest", opId: id(), requestId: id(), itemIds: [], room: "304", presets: ["towels"] });
    expect(bad.ok).toBe(false);
    expect(short.ok).toBe(false);
    expect(await fingerprint()).toEqual(before);
  });

  it("logs for later as incomplete, and completeRequest adds the details", async () => {
    const { requestId } = await logged("305", [], { later: true });
    const itemId = id();
    const res = await run({ type: "completeRequest", opId: id(), requestId, itemIds: [itemId], presets: ["water"] });
    expect(res).toMatchObject({ ok: true, applied: true });
    const req = (await db.query<{ incomplete: boolean }>("select incomplete from requests where id = $1", [requestId])).rows[0];
    expect(req.incomplete).toBe(false);
    expect(await labels(itemId)).toEqual(["Details added"]);
  });
});

describe("item flow", () => {
  it("relays to the first on-shift staff of the department and keeps held time", async () => {
    const { itemIds: [it] } = await logged("311", ["ac"]);
    await step("relay", it);
    expect(await itemRow(it)).toMatchObject({ status: "relayed", assignee: RAMON });
    await step("onSite", it);
    await run({ type: "hold", opId: id(), itemId: it, reason: "parts" });
    await backdateHold(it, 5);
    await step("resume", it);
    const row = await itemRow(it);
    expect(row.status).toBe("on_site");
    expect(Math.round(row.held_ms / 60000)).toBe(5);
    expect(await labels(it)).toEqual(["Logged", "Relayed", "On site", "On hold", "Resumed"]);
  });

  it("refuses a step from the wrong status", async () => {
    const { itemIds: [it] } = await logged("312", ["towels"]);
    await step("relay", it);
    expect((await step("relay", it)).ok).toBe(false);
    expect((await step("resume", it)).ok).toBe(false);
  });

  it("will not finish a step before the one it depends on", async () => {
    const { itemIds: [fix, cleanUp] } = await logged("313", [], { bundle: "leak" });
    expect(await finish(cleanUp)).toEqual({ ok: false, error: "Waiting for the earlier step to finish first." });
    await finish(fix);
    expect(await finish(cleanUp)).toMatchObject({ ok: true });
  });

  it("finishing an inspection readies that room's queued cleaning only", async () => {
    const mine = await cleanTask("314", "queued");
    const other = await cleanTask("315", "queued");
    const { itemIds: [it] } = await logged("314", ["inspection"]);
    await finish(it);
    expect(await cleanStatus(mine)).toBe("ready");
    expect(await cleanStatus(other)).toBe("queued");
  });

  it("adds held time when an item is finished while on hold", async () => {
    const { itemIds: [it] } = await logged("316", ["bulb"]);
    await step("onSite", it);
    await run({ type: "hold", opId: id(), itemId: it, reason: "vendor" });
    await backdateHold(it, 3);
    await finish(it, "cant_do");
    const row = await itemRow(it);
    expect(row.status).toBe("cant_do");
    expect(Math.round(row.held_ms / 60000)).toBe(3);
  });

  it("transfer closes the original and opens a copy in the new department", async () => {
    const { itemIds: [it] } = await logged("317", ["tv"]);
    const copy = id();
    await run({ type: "transfer", opId: id(), itemId: it, newItemId: copy, dept: "engineering" });
    expect(await itemRow(it)).toMatchObject({ status: "transferred" });
    expect(await itemRow(copy)).toMatchObject({ name: "TV not working", dept: "engineering", status: "new", x_from: it, assignee: null });
    expect(await labels(it)).toEqual(["Logged", "Transferred to engineering"]);
    expect(await labels(copy)).toEqual(["Transferred in"]);
    expect((await run({ type: "transfer", opId: id(), itemId: copy, newItemId: id(), dept: "engineering" })).ok).toBe(false);
  });
});

describe("work orders", () => {
  it("escalate then undo restores the item and removes the work order", async () => {
    const it = await onSiteAc("321");
    const woId = id();
    const res = await run({ type: "escalate", opId: id(), itemId: it, woId });
    expect(res).toMatchObject({ ok: true, applied: true, woNo: expect.any(Number) });
    if (!res.ok) throw new Error("not escalated");
    expect(await itemRow(it)).toMatchObject({ status: "escalated", wo_id: woId });
    expect(await labels(it)).toContain(`Escalated to WO-${pad(res.woNo ?? 0)}`);
    await run({ type: "undoEscalate", opId: id(), itemId: it });
    expect(await itemRow(it)).toMatchObject({ status: "on_site", wo_id: null });
    expect((await db.query("select 1 from work_orders where id = $1", [woId])).rows).toHaveLength(0);
  });

  it("completing the work order closes the escalated item", async () => {
    const it = await onSiteAc("322");
    const woId = id();
    const escalated = await run({ type: "escalate", opId: id(), itemId: it, woId });
    if (!escalated.ok) throw new Error("not escalated");
    await run({ type: "assessWo", opId: id(), woId, assessment: "Compressor", assignType: "inhouse", estCost: 1200 });
    await run({ type: "startWo", opId: id(), woId });
    await run({ type: "completeWo", opId: id(), woId, actualCost: 1100 });
    expect(await itemRow(it)).toMatchObject({ status: "done" });
    expect(await labels(it)).toContain(`Closed by WO-${pad(escalated.woNo ?? 0)}`);
    expect(await labels(woId)).toEqual(["Escalated from request", "Assessed", "Work started", "Completed"]);
  });

  it("only escalates on-site engineering or IT items", async () => {
    const error = "Only on-site Engineering or IT items can become work orders.";
    const { itemIds: [towels] } = await logged("323", ["towels"]);
    await step("onSite", towels);
    const { itemIds: [ac] } = await logged("323", ["ac"]);
    expect(await run({ type: "escalate", opId: id(), itemId: towels, woId: id() })).toEqual({ ok: false, error });
    expect(await run({ type: "escalate", opId: id(), itemId: ac, woId: id() })).toEqual({ ok: false, error });
  });

  it("rejects a negative or non-finite cost", async () => {
    const woId = id();
    await run({ type: "escalate", opId: id(), itemId: await onSiteAc("324"), woId });
    const assess = (estCost: number) =>
      run({ type: "assessWo", opId: id(), woId, assessment: "x", assignType: "outsource", contractor: "Coolfix", estCost });
    expect((await assess(-1)).ok).toBe(false);
    expect((await assess(Number.POSITIVE_INFINITY)).ok).toBe(false);
    expect((await assess(500)).ok).toBe(true);
  });
});

describe("cleaning and safety", () => {
  it("cleanSet changes the status and logs it", async () => {
    const task = await cleanTask("331", "scheduled");
    await run({ type: "cleanSet", opId: id(), taskId: task, status: "in_progress" });
    expect(await cleanStatus(task)).toBe("in_progress");
    expect(await labels(task)).toEqual(["Cleaning update"]);
  });

  it("merges a second report from another room into the active incident", async () => {
    const first = id();
    const a = await run({ type: "raiseSafety", opId: id(), incidentId: first, room: "332", text: "smoke", hazard: "smoke" });
    const b = await run({ type: "raiseSafety", opId: id(), incidentId: id(), room: "333", text: "usok", hazard: "smoke" });
    const c = await run({ type: "raiseSafety", opId: id(), incidentId: id(), room: "332", text: "smoke again", hazard: "smoke" });
    if (!a.ok) throw new Error("not raised");
    expect(b).toEqual({ ok: true, applied: true, clusteredInto: first, incidentNo: a.incidentNo });
    expect(c).toMatchObject({ ok: true, applied: true, incidentNo: (a.incidentNo ?? 0) + 1 });
    const rooms = (await db.query<{ rooms: string[] }>("select rooms from incidents where id = $1", [first])).rows[0].rooms;
    expect(rooms).toEqual(["332", "333"]);
  });

  it("records the 911 call once only", async () => {
    const incidentId = id();
    await run({ type: "raiseSafety", opId: id(), incidentId, room: "334", text: "gas leak", hazard: "gas" });
    const at = "2026-10-27T10:00:00.000Z";
    expect((await run({ type: "record911", opId: id(), incidentId, at: "not a date" })).ok).toBe(false);
    expect(await run({ type: "record911", opId: id(), incidentId, at })).toMatchObject({ ok: true, applied: true });
    expect(await run({ type: "record911", opId: id(), incidentId, at: "2026-10-27T10:05:00.000Z" })).toEqual({
      ok: false,
      error: "The 911 call is already recorded for this incident",
    });
    expect(await labels(incidentId)).toContain(`BFP/911 called at ${at}`);
  });
});

describe("idempotent replay", () => {
  it("request commands", async () => {
    const requestId = id();
    const { first, again } = await twice({ type: "logRequest", opId: id(), requestId, itemIds: [id()], room: "341", presets: ["towels"], later: true });
    expect(again).toMatchObject({ ticketNo: first.ok ? first.ticketNo : -1 });
    await twice({ type: "completeRequest", opId: id(), requestId, itemIds: [id()], presets: ["water"] });
  });

  it("item commands", async () => {
    const { itemIds: [it] } = await logged("342", ["ac"]);
    await twice({ type: "relay", opId: id(), itemId: it });
    await twice({ type: "onSite", opId: id(), itemId: it });
    await twice({ type: "hold", opId: id(), itemId: it, reason: "parts" });
    await twice({ type: "resume", opId: id(), itemId: it });
    await twice({ type: "transfer", opId: id(), itemId: it, newItemId: id(), dept: "it" });
    const { itemIds: [other] } = await logged("342", ["towels"]);
    await twice({ type: "finish", opId: id(), itemId: other, status: "done" });
  });

  it("work-order commands", async () => {
    const it = await onSiteAc("343");
    const woId = id();
    const { first, again } = await twice({ type: "escalate", opId: id(), itemId: it, woId });
    expect(again).toMatchObject({ woNo: first.ok ? first.woNo : -1 });
    await twice({ type: "undoEscalate", opId: id(), itemId: it });
    const wo = id();
    await run({ type: "escalate", opId: id(), itemId: it, woId: wo });
    await twice({ type: "assessWo", opId: id(), woId: wo, assessment: "Fan", assignType: "inhouse", estCost: 0 });
    await twice({ type: "startWo", opId: id(), woId: wo });
    await twice({ type: "holdWo", opId: id(), woId: wo });
    await twice({ type: "completeWo", opId: id(), woId: wo, actualCost: 10 });
    await twice({ type: "reopenWo", opId: id(), woId: wo });
  });

  it("cleaning and safety commands", async () => {
    await twice({ type: "cleanSet", opId: id(), taskId: await cleanTask("344", "scheduled"), status: "done" });
    const incidentId = id();
    const raised = await twice({ type: "raiseSafety", opId: id(), incidentId, room: "345", text: "baha", hazard: "flood" });
    expect(raised.again).toMatchObject({ incidentNo: raised.first.ok ? raised.first.incidentNo : -1 });
    const merged = await twice({ type: "raiseSafety", opId: id(), incidentId: id(), room: "346", text: "baha", hazard: "flood" });
    expect(merged.again).toMatchObject({ clusteredInto: incidentId });
    await twice({ type: "record911", opId: id(), incidentId, at: new Date().toISOString() });
    await twice({ type: "downgradeIncident", opId: id(), incidentId });
    const other = id();
    await run({ type: "raiseSafety", opId: id(), incidentId: other, room: "347", text: "lift", hazard: "lift" });
    await twice({ type: "resolveIncident", opId: id(), incidentId: other });
  });
});

describe("tenant and property scope", () => {
  it("another org cannot touch the first org's rows", async () => {
    const { itemIds: [it] } = await logged("351", ["towels"]);
    const task = await cleanTask("351", "scheduled");
    const them: Ctx = { orgId: OTHER, propertyId: OTHER_PROPERTY, actorStaffId: null };
    expect(await run({ type: "relay", opId: id(), itemId: it }, them)).toEqual({ ok: false, error: "Unknown item" });
    expect((await run({ type: "cleanSet", opId: id(), taskId: task, status: "done" }, them)).ok).toBe(false);
    const borrowed: Ctx = { ...them, propertyId: BORACAY };
    expect(await run({ type: "relay", opId: id(), itemId: it }, borrowed)).toEqual({ ok: false, error: "Unknown property" });
    expect(await itemRow(it)).toMatchObject({ status: "new" });
    expect(await cleanStatus(task)).toBe("scheduled");
  });

  it("a row from another property of the same org is unknown", async () => {
    const { itemIds: [it] } = await logged("352", ["towels"]);
    const baguio: Ctx = { ...ME, propertyId: BAGUIO };
    expect(await run({ type: "relay", opId: id(), itemId: it }, baguio)).toEqual({ ok: false, error: "Unknown item" });
  });

  it("rejects an unknown command and a malformed id", async () => {
    const unknown = { type: "dropTables", opId: id() } as unknown as Command;
    expect(await run(unknown)).toEqual({ ok: false, error: "Unknown command" });
    expect((await run({ type: "relay", opId: id(), itemId: "1; drop table items" })).ok).toBe(false);
  });
});

describe("loadSnapshot", () => {
  it("maps rows to the client shapes without PIN data", async () => {
    await db.query("update staff set pin_hash = 'secret-pin-hash' where id = $1", [MARIA]);
    const { requestId, itemIds, res } = await logged("361", ["towels", "water"]);
    await step("relay", itemIds[0]);
    const s = await snapshot();
    const req = s.requests.find((r) => r.id === requestId);
    expect(req).toMatchObject({ ticket: `T-${pad(res.ok ? res.ticketNo ?? 0 : 0)}`, room: "361", loggedBy: MARIA, itemIds });
    expect(s.items[itemIds[0]].events.map((e) => [e.by, e.what])).toEqual([[MARIA, "Logged"], [MARIA, "Relayed"]]);
    expect(s.items[itemIds[0]]).toMatchObject({ status: "relayed", assignee: expect.any(String), heldMs: 0 });
    expect(Object.keys(s.staff[0]).sort()).toEqual(["dept", "id", "initials", "name", "onShift", "role", "title"]);
    expect(JSON.stringify(s)).not.toContain("secret-pin-hash");
    expect(s.property).toEqual({ id: BORACAY, name: "Azalea Boracay" });
    expect(s.properties).toHaveLength(2);
    expect(s.seq).toMatchObject({ t: expect.any(Number), id: 0 });
  });

  it("keeps recent and open rows and drops old closed ones", async () => {
    const old = (days: number) => `now() - interval '${days} days'`;
    const insertReq = async (no: number) =>
      (await db.query<{ id: string }>(
        `insert into requests (org_id, property_id, ticket_no, room, source, op_id, created_at)
         values ($1, $2, $3, '362', 'staff', gen_random_uuid(), ${old(3)}) returning id`,
        [AZALEA, BORACAY, no],
      )).rows[0].id;
    const closedReq = await insertReq(9001);
    const openReq = await insertReq(9002);
    await db.query(
      `insert into items (org_id, property_id, request_id, name, dept, sla_min, status, created_at)
       values ($1, $2, $3, 'Old', 'it', 20, 'done', ${old(3)}), ($1, $2, $4, 'Old open', 'it', 20, 'relayed', ${old(3)})`,
      [AZALEA, BORACAY, closedReq, openReq],
    );
    const wo = (no: number, status: string) =>
      db.query(
        `insert into work_orders (org_id, property_id, wo_no, area, loc, descr, dept, status, op_id, created_at)
         values ($1, $2, $3, 'Lobby', 'Lobby', 'wo-${no}', 'engineering', $4, gen_random_uuid(), ${old(20)})`,
        [AZALEA, BORACAY, no, status],
      );
    await wo(9001, "done");
    await wo(9002, "in_progress");
    const incident = (no: number, status: string) =>
      db.query(
        `insert into incidents (org_id, property_id, inc_no, hazard, rooms, text, status, op_id, created_at)
         values ($1, $2, $3, 'flood', '{362}', 'inc-${no}', $4, gen_random_uuid(), ${old(10)})`,
        [AZALEA, BORACAY, no, status],
      );
    await incident(9001, "resolved");
    await incident(9002, "active");
    await db.query(
      `insert into clean_tasks (org_id, property_id, room, type, status, created_at) values
       ($1, $2, '362-done', 'Regular', 'done', ${old(2)}), ($1, $2, '362-open', 'Regular', 'queued', ${old(2)})`,
      [AZALEA, BORACAY],
    );
    const s = await snapshot();
    expect(s.requests.map((r) => r.id)).toContain(openReq);
    expect(s.requests.map((r) => r.id)).not.toContain(closedReq);
    expect(s.wos.map((w) => w.desc)).toContain("wo-9002");
    expect(s.wos.map((w) => w.desc)).not.toContain("wo-9001");
    expect(s.incidents.map((i) => i.text)).toContain("inc-9002");
    expect(s.incidents.map((i) => i.text)).not.toContain("inc-9001");
    expect(s.cleaning.map((c) => c.room)).toContain("362-open");
    expect(s.cleaning.map((c) => c.room)).not.toContain("362-done");
  });
});

describe("client and server parity", () => {
  interface Outcome { statuses: string[]; heldMin: number; labels: string[]; assignee: string | undefined }

  function onClient(): Outcome {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    try {
      client.resetApp(Date.now());
      client.unlock("s-maria");
      client.logRequest({ room: "371", presets: ["ac"] });
      const it = client.app.get().requests[0].itemIds[0];
      const status = () => client.app.get().items[it].status;
      const statuses: string[] = [];
      client.relay(it); statuses.push(status());
      client.onSite(it); statuses.push(status());
      client.hold(it, "parts"); statuses.push(status());
      vi.advanceTimersByTime(5 * 60000);
      client.resume(it); statuses.push(status());
      client.finishItem(it, "done"); statuses.push(status());
      const item = client.app.get().items[it];
      const name = client.app.get().staff.find((p) => p.id === item.assignee)?.name;
      return { statuses, heldMin: Math.round(item.heldMs / 60000), labels: item.events.map((e) => e.what), assignee: name };
    } finally {
      vi.useRealTimers();
    }
  }

  async function onServer(): Promise<Outcome> {
    const { itemIds: [it] } = await logged("371", ["ac"]);
    const statuses: string[] = [];
    const record = async () => statuses.push((await itemRow(it)).status);
    await step("relay", it); await record();
    await step("onSite", it); await record();
    await run({ type: "hold", opId: id(), itemId: it, reason: "parts" }); await record();
    await backdateHold(it, 5);
    await step("resume", it); await record();
    await finish(it); await record();
    const row = await itemRow(it);
    const name = (await db.query<{ name: string }>("select name from staff where id = $1", [row.assignee])).rows[0]?.name;
    return { statuses, heldMin: Math.round(row.held_ms / 60000), labels: await labels(it), assignee: name };
  }

  it("the same steps give the same statuses, held time, history and assignee", async () => {
    expect(await onServer()).toEqual(onClient());
  });
});
