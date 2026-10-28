import type { Q } from "../lib/db";
import { BUNDLES, DEPTS, HAZARDS, HOLD_REASONS, PRESETS, pad } from "../domain/rules";
import type { CleanStatus, Dept, ItemStatus, WoStatus } from "../domain/types";
import type { Command, CommandResult, Ctx } from "./contract";
import { OPEN_STATUSES, select } from "./snapshot";

// Server half of src/domain/store.ts. Each command: read and validate (no writes), claim the op with
// its first event row, then write. See the idempotency note at the top of db/migrations/0001_init.sql.

type Cmd<T extends Command["type"]> = Extract<Command, { type: T }>;
type Entity = "request" | "item" | "work_order" | "clean_task" | "incident" | "handover";
type Extra = { ticketNo?: number; woNo?: number; incidentNo?: number; clusteredInto?: string };
interface Run { q: Q; ctx: Ctx; opId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLEAN_STATUSES: readonly CleanStatus[] = ["scheduled", "queued", "ready", "in_progress", "done"];
const FINISH_LABELS = { done: "Done", cant_do: "Can't do", duplicate: "Marked duplicate", cancelled: "Cancelled" } as const;
const CLUSTER_MINUTES = 15;
const MAX_COST = 1e10; // numeric(12, 2)
const ALERT = "Safety words detected. Duty manager and Security alerted over the local network. Staff notified (not BFP/911).";
const LOCKED_911 = "The 911 call is already recorded for this incident";
const ESCALATE_ONLY = "Only on-site Engineering or IT items can become work orders.";
const NO_ITEM = "Unknown item";
const NOTE_MAX = 1000; // handovers.note check
const MAX_RETURN = 500;
const RETURNED = "Returned to department queue at shift end";

/** The client's firstOf(): first on-shift staff member of the item's department. */
const FIRST_ON_SHIFT = `(select s.id from staff s where s.dept = items.dept and s.on_shift and s.active and s.role = 'staff'
  order by s.created_at, s.id limit 1)`;
const HELD = "coalesce((extract(epoch from now() - hold_since) * 1000)::bigint, 0)";

const fail = (error: string): CommandResult => ({ ok: false, error });
const ok = (extra: Extra = {}): CommandResult => ({ ok: true, applied: true, ...extra });
const has = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === "string" && Object.hasOwn(o, k);
const trimmed = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const validCost = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < MAX_COST;

export async function applyCommand(q: Q, ctx: Ctx, cmd: Command): Promise<CommandResult> {
  if (!idsValid(ctx, cmd)) return fail("Invalid id");
  const r: Run = { q, ctx, opId: cmd.opId };
  const [prop] = await select(q, "select 1 from properties where id = $1 and org_id = $2", [ctx.propertyId, ctx.orgId]);
  if (!prop) return fail("Unknown property");
  return (await prior(r, cmd)) ?? dispatch(r, cmd);
}

function idsValid(ctx: Ctx, cmd: Command): boolean {
  const ids: unknown[] = [ctx.orgId, ctx.propertyId, cmd.opId];
  if (ctx.actorStaffId !== null) ids.push(ctx.actorStaffId);
  for (const [k, v] of Object.entries(cmd)) {
    if (k.endsWith("Id")) ids.push(v);
    if (k === "itemIds") ids.push(...(Array.isArray(v) ? v : [v]));
  }
  return ids.every((v) => typeof v === "string" && UUID.test(v));
}

function dispatch(r: Run, cmd: Command): Promise<CommandResult> {
  switch (cmd.type) {
    case "logRequest": return logRequest(r, cmd);
    case "completeRequest": return completeRequest(r, cmd);
    case "relay": case "onSite": case "resume": return stepItem(r, cmd, ITEM_STEPS[cmd.type]);
    case "hold": return has(HOLD_REASONS, cmd.reason) ? stepItem(r, cmd, ITEM_STEPS.hold, [cmd.reason]) : bad("Unknown hold reason");
    case "finish": return finish(r, cmd);
    case "transfer": return transfer(r, cmd);
    case "escalate": return escalate(r, cmd);
    case "undoEscalate": return undoEscalate(r, cmd);
    case "assessWo": return assessWo(r, cmd);
    case "startWo": case "holdWo": case "reopenWo": return stepWo(r, cmd, WO_STEPS[cmd.type]);
    case "completeWo":
      return validCost(cmd.actualCost) ? stepWo(r, cmd, WO_STEPS.completeWo, [cmd.actualCost]) : bad("Enter a cost of zero or more");
    case "cleanSet": return cleanSet(r, cmd);
    case "raiseSafety": return raiseSafety(r, cmd);
    case "downgradeIncident": case "resolveIncident": return setIncidentStatus(r, cmd);
    case "record911": return record911(r, cmd);
    case "ackHandover": return ackHandover(r, cmd);
    case "returnOrphans": return returnOrphans(r, cmd);
    default: return bad("Unknown command");
  }
}

const bad = async (error: string) => fail(error);

/* ---------- idempotency ---------- */

/** The result to return when this op already ran, or null when it has not. */
async function prior(r: Run, cmd: Command): Promise<CommandResult | null> {
  const [ev] = await select<{ entity_id: string }>(r.q, "select entity_id from events where op_id = $1 order by id limit 1", [r.opId]);
  return ev ? { ok: true, applied: false, ...(await priorNumbers(r, cmd, ev.entity_id)) } : null;
}

async function priorNumbers(r: Run, cmd: Command, entityId: string): Promise<Extra> {
  if (cmd.type === "logRequest") {
    const [x] = await select<{ n: number }>(r.q, "select ticket_no as n from requests where id = $1", [entityId]);
    return { ticketNo: x?.n };
  }
  if (cmd.type === "escalate") {
    const [x] = await select<{ n: number }>(r.q, "select wo_no as n from work_orders where id = $1", [entityId]);
    return { woNo: x?.n };
  }
  if (cmd.type === "raiseSafety") {
    const [x] = await select<{ n: number; op_id: string }>(r.q, "select inc_no as n, op_id from incidents where id = $1", [entityId]);
    return x?.op_id === r.opId ? { incidentNo: x.n } : { incidentNo: x?.n, clusteredInto: entityId };
  }
  return {};
}

/** Appends a history row. As the first write of a command it is the claim: false means the op already ran. */
async function addEvent(r: Run, entity: Entity, entityId: string, what: string): Promise<boolean> {
  const rows = await select(
    r.q,
    `insert into events (org_id, property_id, entity, entity_id, what, by_staff, op_id)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id`,
    [r.ctx.orgId, r.ctx.propertyId, entity, entityId, what, r.ctx.actorStaffId, r.opId],
  );
  return rows.length > 0;
}

/** A concurrent copy of this op committed between our check and our claim. */
async function replayed(r: Run, cmd: Command): Promise<CommandResult> {
  return (await prior(r, cmd)) ?? { ok: true, applied: false };
}

async function bump(r: Run, counter: "ticket_seq" | "wo_seq" | "inc_seq"): Promise<number> {
  const [x] = await select<{ n: number }>(
    r.q, `update properties set ${counter} = ${counter} + 1 where id = $1 returning ${counter} as n`, [r.ctx.propertyId]);
  return x.n;
}

/* ---------- requests ---------- */

interface ItemSpec { name: string; dept: Dept; slaMin: number; after?: number }

function presetSpecs(keys: unknown): ItemSpec[] | null {
  if (!Array.isArray(keys)) return null;
  const out: ItemSpec[] = [];
  for (const k of keys) {
    const p = PRESETS.find((x) => x.key === k);
    if (!p) return null;
    out.push({ name: p.label, dept: p.dept, slaMin: p.slaMin });
  }
  return out;
}

/** `offset` is where the bundle's parts start in the request's item list. */
function bundleSpecs(key: unknown, offset: number): ItemSpec[] | null {
  if (key === undefined) return [];
  const b = BUNDLES.find((x) => x.key === key);
  if (!b) return null;
  return b.parts.map((p) => ({ name: p.name, dept: p.dept, slaMin: p.slaMin, after: "after" in p && p.after !== undefined ? offset + p.after : undefined }));
}

const idsMatch = (ids: string[], n: number) => ids.length === n && new Set(ids).size === n;

async function insertItems(r: Run, requestId: string, specs: ItemSpec[], ids: string[], label: string) {
  for (const [i, s] of specs.entries()) {
    // Rows in one transaction share now(); the microsecond offset keeps their order for the snapshot.
    await r.q(
      `insert into items (id, org_id, property_id, request_id, name, dept, sla_min, depends_on, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::int * interval '1 microsecond')`,
      [ids[i], r.ctx.orgId, r.ctx.propertyId, requestId, s.name, s.dept, s.slaMin, s.after === undefined ? null : ids[s.after], i],
    );
    await addEvent(r, "item", ids[i], label);
  }
}

async function logRequest(r: Run, cmd: Cmd<"logRequest">): Promise<CommandResult> {
  const room = trimmed(cmd.room);
  if (!room) return fail("Room is required");
  const presets = presetSpecs(cmd.presets ?? []);
  const parts = bundleSpecs(cmd.bundle, presets?.length ?? 0);
  if (!presets || !parts) return fail("Unknown request type");
  const specs = [...presets, ...parts];
  if (!idsMatch(cmd.itemIds, specs.length)) return fail("Item ids do not match the items");
  if (!(await addEvent(r, "request", cmd.requestId, "Logged"))) return replayed(r, cmd);
  const n = await bump(r, "ticket_seq");
  await r.q(
    `insert into requests (id, org_id, property_id, ticket_no, room, source, remarks, logged_by, vip, incomplete, op_id)
     values ($1, $2, $3, $4, $5, 'staff', $6, $7, $8, $9, $10)`,
    [cmd.requestId, r.ctx.orgId, r.ctx.propertyId, n, room, typeof cmd.remarks === "string" ? cmd.remarks : null,
      r.ctx.actorStaffId, cmd.vip === true, cmd.later === true || specs.length === 0, r.opId],
  );
  await insertItems(r, cmd.requestId, specs, cmd.itemIds, "Logged");
  return ok({ ticketNo: n });
}

async function completeRequest(r: Run, cmd: Cmd<"completeRequest">): Promise<CommandResult> {
  const [req] = await select<{ incomplete: boolean }>(
    r.q, "select incomplete from requests where id = $1 and property_id = $2", [cmd.requestId, r.ctx.propertyId]);
  if (!req) return fail("Unknown request");
  if (!req.incomplete) return fail("This request already has its details");
  const specs = presetSpecs(cmd.presets);
  if (!specs) return fail("Unknown request type");
  if (!idsMatch(cmd.itemIds, specs.length)) return fail("Item ids do not match the items");
  if (!(await addEvent(r, "request", cmd.requestId, "Details added"))) return replayed(r, cmd);
  await insertItems(r, cmd.requestId, specs, cmd.itemIds, "Details added");
  await r.q("update requests set incomplete = false where id = $1", [cmd.requestId]);
  return ok();
}

/* ---------- items ---------- */

interface ItemRow { id: string; request_id: string; name: string; dept: Dept; status: ItemStatus; depends_on: string | null; wo_id: string | null }

async function loadItem(r: Run, itemId: string): Promise<ItemRow | undefined> {
  const [it] = await select<ItemRow>(
    r.q,
    "select id, request_id, name, dept, status, depends_on, wo_id from items where id = $1 and property_id = $2",
    [itemId, r.ctx.propertyId],
  );
  return it;
}

const isOpen = (it: ItemRow) => OPEN_STATUSES.includes(it.status);
const notNow = (what: string, status: string) => `Not possible while the ${what} is ${status.replace("_", " ")}`;

interface ItemStep { from: readonly ItemStatus[]; label: string; set: string }

const ITEM_STEPS = {
  relay: { from: ["new"], label: "Relayed", set: `status = 'relayed', ack_at = now(), assignee = coalesce(assignee, ${FIRST_ON_SHIFT})` },
  onSite: {
    from: ["new", "relayed"],
    label: "On site",
    set: `status = 'on_site', ack_at = coalesce(ack_at, now()), assignee = coalesce(assignee, ${FIRST_ON_SHIFT})`,
  },
  hold: { from: ["relayed", "on_site"], label: "On hold", set: "status = 'on_hold', hold_reason = $2, hold_since = now(), ack_at = coalesce(ack_at, now())" },
  resume: { from: ["on_hold"], label: "Resumed", set: `status = 'on_site', held_ms = held_ms + ${HELD}, hold_since = null, hold_reason = null` },
} satisfies Record<string, ItemStep>;

async function stepItem(r: Run, cmd: Cmd<"relay" | "onSite" | "resume" | "hold">, s: ItemStep, params: unknown[] = []) {
  const it = await loadItem(r, cmd.itemId);
  if (!it) return fail(NO_ITEM);
  if (!s.from.includes(it.status)) return fail(notNow("item", it.status));
  if (!(await addEvent(r, "item", it.id, s.label))) return replayed(r, cmd);
  await r.q(`update items set ${s.set} where id = $1`, [it.id, ...params]);
  return ok();
}

/** The client's closeItem(): close, stop any hold clock, and ready the room after a checkout or inspection. */
async function closeItem(r: Run, it: ItemRow, status: keyof typeof FINISH_LABELS) {
  await r.q(
    `update items set status = $2, done_at = now(), ack_at = coalesce(ack_at, now()),
            held_ms = held_ms + case when status = 'on_hold' then ${HELD} else 0 end, hold_since = null, hold_reason = null
      where id = $1`,
    [it.id, status],
  );
  if (status !== "done" || !/checkout|inspection/i.test(it.name)) return;
  await r.q(
    `update clean_tasks set status = 'ready'
      where property_id = $1 and status in ('scheduled', 'queued') and room = (select room from requests where id = $2)`,
    [r.ctx.propertyId, it.request_id],
  );
}

async function blocked(r: Run, it: ItemRow): Promise<boolean> {
  if (!it.depends_on) return false;
  const [pre] = await select<{ status: ItemStatus }>(r.q, "select status from items where id = $1", [it.depends_on]);
  return pre?.status !== "done";
}

async function finish(r: Run, cmd: Cmd<"finish">): Promise<CommandResult> {
  if (!has(FINISH_LABELS, cmd.status)) return fail("Unknown status");
  const it = await loadItem(r, cmd.itemId);
  if (!it) return fail(NO_ITEM);
  if (!isOpen(it)) return fail(notNow("item", it.status));
  if (await blocked(r, it)) return fail("Waiting for the earlier step to finish first.");
  if (!(await addEvent(r, "item", it.id, FINISH_LABELS[cmd.status]))) return replayed(r, cmd);
  await closeItem(r, it, cmd.status);
  return ok();
}

async function transfer(r: Run, cmd: Cmd<"transfer">): Promise<CommandResult> {
  if (!has(DEPTS, cmd.dept)) return fail("Unknown department");
  const it = await loadItem(r, cmd.itemId);
  if (!it) return fail(NO_ITEM);
  if (!isOpen(it)) return fail(notNow("item", it.status));
  if (it.dept === cmd.dept) return fail("The item is already with that department");
  if (!(await addEvent(r, "item", it.id, `Transferred to ${cmd.dept}`))) return replayed(r, cmd);
  await r.q("update items set status = 'transferred', done_at = now() where id = $1", [it.id]);
  await r.q(
    `insert into items (id, org_id, property_id, request_id, name, qty, dept, status, sla_min, depends_on, x_from)
     select $1, org_id, property_id, request_id, name, qty, $2, 'new', sla_min, depends_on, id from items where id = $3`,
    [cmd.newItemId, cmd.dept, it.id],
  );
  await addEvent(r, "item", cmd.newItemId, "Transferred in");
  return ok();
}

/* ---------- escalation ---------- */

async function escalate(r: Run, cmd: Cmd<"escalate">): Promise<CommandResult> {
  const it = await loadItem(r, cmd.itemId);
  if (!it) return fail(NO_ITEM);
  if (!["engineering", "it"].includes(it.dept) || !["on_site", "on_hold"].includes(it.status)) return fail(ESCALATE_ONLY);
  const [req] = await select<{ room: string; ticket_no: number }>(r.q, "select room, ticket_no from requests where id = $1", [it.request_id]);
  if (!(await addEvent(r, "work_order", cmd.woId, "Escalated from request"))) return replayed(r, cmd);
  const n = await bump(r, "wo_seq");
  // The work order goes in first: its src_item_id points at the existing item, then the item points back.
  await r.q(
    `insert into work_orders (id, org_id, property_id, wo_no, area, loc, descr, priority, dept, status,
                              reported_by, encoded_by, src_item_id, op_id)
     values ($1, $2, $3, $4, 'Guest room', $5, $6, 'normal', $7, 'reported', $8, $8, $9, $10)`,
    [cmd.woId, r.ctx.orgId, r.ctx.propertyId, n, `Room ${req.room}`, `${it.name} (from T-${pad(req.ticket_no)})`, it.dept,
      r.ctx.actorStaffId, it.id, r.opId],
  );
  await r.q("update items set status = 'escalated', st_before_esc = status, wo_id = $2 where id = $1", [it.id, cmd.woId]);
  await addEvent(r, "item", it.id, `Escalated to WO-${pad(n)}`);
  return ok({ woNo: n });
}

async function undoEscalate(r: Run, cmd: Cmd<"undoEscalate">): Promise<CommandResult> {
  const it = await loadItem(r, cmd.itemId);
  if (!it) return fail(NO_ITEM);
  if (it.status !== "escalated" || !it.wo_id) return fail("This item is not escalated");
  const [wo] = await select<{ status: WoStatus }>(r.q, "select status from work_orders where id = $1", [it.wo_id]);
  if (wo?.status === "done") return fail("The work order is already done");
  if (!(await addEvent(r, "item", it.id, "Escalation undone"))) return replayed(r, cmd);
  // Clear the item's link first so the work order can be deleted.
  await r.q("update items set status = coalesce(st_before_esc, 'on_site'), wo_id = null, st_before_esc = null where id = $1", [it.id]);
  await r.q("delete from work_orders where id = $1", [it.wo_id]);
  return ok();
}

/* ---------- work orders ---------- */

interface WoRow { id: string; wo_no: number; status: WoStatus; src_item_id: string | null }
interface WoStep { from: readonly WoStatus[]; label: string; set: string; after?: (r: Run, wo: WoRow) => Promise<void> }

const WO_STEPS = {
  assessWo: {
    from: ["reported"],
    label: "Assessed",
    set: "status = 'assessed', assessment = $2, assign_type = $3, contractor = $4, est_cost = $5",
  },
  startWo: { from: ["assessed", "on_hold"], label: "Work started", set: "status = 'in_progress'" },
  holdWo: { from: ["in_progress"], label: "Put on hold", set: "status = 'on_hold'" },
  completeWo: { from: ["in_progress", "on_hold", "assessed"], label: "Completed", set: "status = 'done', actual_cost = $2", after: closeSourceItem },
  reopenWo: { from: ["done"], label: "Reopened", set: "status = 'in_progress', actual_cost = null" },
} satisfies Record<string, WoStep>;

async function stepWo(r: Run, cmd: Cmd<"assessWo" | "startWo" | "holdWo" | "completeWo" | "reopenWo">, s: WoStep, params: unknown[] = []) {
  const [wo] = await select<WoRow>(
    r.q, "select id, wo_no, status, src_item_id from work_orders where id = $1 and property_id = $2", [cmd.woId, r.ctx.propertyId]);
  if (!wo) return fail("Unknown work order");
  if (!s.from.includes(wo.status)) return fail(notNow("work order", wo.status));
  if (!(await addEvent(r, "work_order", wo.id, s.label))) return replayed(r, cmd);
  await r.q(`update work_orders set ${s.set} where id = $1`, [wo.id, ...params]);
  await s.after?.(r, wo);
  return ok();
}

function assessWo(r: Run, cmd: Cmd<"assessWo">): Promise<CommandResult> {
  if (cmd.assignType !== "inhouse" && cmd.assignType !== "outsource") return bad("Unknown assignment type");
  if (!validCost(cmd.estCost)) return bad("Enter a cost of zero or more");
  const contractor = typeof cmd.contractor === "string" ? cmd.contractor : null;
  return stepWo(r, cmd, WO_STEPS.assessWo, [trimmed(cmd.assessment), cmd.assignType, contractor, cmd.estCost]);
}

async function closeSourceItem(r: Run, wo: WoRow) {
  if (!wo.src_item_id) return;
  const it = await loadItem(r, wo.src_item_id);
  if (it?.status !== "escalated") return;
  await closeItem(r, it, "done");
  await addEvent(r, "item", it.id, `Closed by WO-${pad(wo.wo_no)}`);
}

/* ---------- cleaning ---------- */

async function cleanSet(r: Run, cmd: Cmd<"cleanSet">): Promise<CommandResult> {
  if (!CLEAN_STATUSES.includes(cmd.status)) return fail("Unknown cleaning status");
  const [task] = await select(r.q, "select 1 from clean_tasks where id = $1 and property_id = $2", [cmd.taskId, r.ctx.propertyId]);
  if (!task) return fail("Unknown cleaning task");
  if (!(await addEvent(r, "clean_task", cmd.taskId, "Cleaning update"))) return replayed(r, cmd);
  await r.q("update clean_tasks set status = $2 where id = $1", [cmd.taskId, cmd.status]);
  return ok();
}

/* ---------- safety ---------- */

async function raiseSafety(r: Run, cmd: Cmd<"raiseSafety">): Promise<CommandResult> {
  if (!has(HAZARDS, cmd.hazard)) return fail("Unknown hazard");
  const room = trimmed(cmd.room);
  const text = trimmed(cmd.text);
  if (!room || !text) return fail("Room and what was said are required");
  const [near] = await select<{ id: string; inc_no: number }>(
    r.q,
    `select id, inc_no from incidents
      where property_id = $1 and hazard = $2 and status = 'active'
        and created_at > now() - make_interval(mins => $3) and not ($4 = any(rooms))
      order by created_at desc limit 1`,
    [r.ctx.propertyId, cmd.hazard, CLUSTER_MINUTES, room],
  );
  if (near) {
    if (!(await addEvent(r, "incident", near.id, `Second report from room ${room}: treated as one incident`))) return replayed(r, cmd);
    await r.q("update incidents set rooms = array_append(rooms, $2::text) where id = $1", [near.id, room]);
    return ok({ clusteredInto: near.id, incidentNo: near.inc_no });
  }
  if (!(await addEvent(r, "incident", cmd.incidentId, ALERT))) return replayed(r, cmd);
  const n = await bump(r, "inc_seq");
  await r.q(
    `insert into incidents (id, org_id, property_id, inc_no, hazard, rooms, text, status, op_id)
     values ($1, $2, $3, $4, $5, array[$6::text], $7, 'active', $8)`,
    [cmd.incidentId, r.ctx.orgId, r.ctx.propertyId, n, cmd.hazard, room, text, r.opId],
  );
  return ok({ incidentNo: n });
}

interface IncidentRow { id: string; status: string; called911_at: Date | null }

async function loadIncident(r: Run, incidentId: string): Promise<IncidentRow | undefined> {
  const [inc] = await select<IncidentRow>(
    r.q, "select id, status, called911_at from incidents where id = $1 and property_id = $2", [incidentId, r.ctx.propertyId]);
  return inc;
}

async function setIncidentStatus(r: Run, cmd: Cmd<"downgradeIncident" | "resolveIncident">): Promise<CommandResult> {
  const [status, label] = cmd.type === "downgradeIncident"
    ? ["downgraded", "Downgraded by staff (logged)"]
    : ["resolved", "Resolved with engineer and manager sign-off"];
  const inc = await loadIncident(r, cmd.incidentId);
  if (!inc) return fail("Unknown incident");
  if (inc.status !== "active") return fail("This incident is no longer active");
  if (!(await addEvent(r, "incident", inc.id, label))) return replayed(r, cmd);
  await r.q("update incidents set status = $2 where id = $1", [inc.id, status]);
  return ok();
}

async function record911(r: Run, cmd: Cmd<"record911">): Promise<CommandResult> {
  const at = new Date(typeof cmd.at === "string" ? cmd.at : Number.NaN);
  if (Number.isNaN(at.getTime())) return fail("The call time is not a valid date");
  const inc = await loadIncident(r, cmd.incidentId);
  if (!inc) return fail("Unknown incident");
  if (inc.called911_at) return fail(LOCKED_911);
  if (!(await addEvent(r, "incident", inc.id, `BFP/911 called at ${cmd.at}`))) return replayed(r, cmd);
  try {
    await r.q("update incidents set called911_by = $2, called911_at = $3 where id = $1", [inc.id, r.ctx.actorStaffId, at.toISOString()]);
  } catch (e) {
    // A concurrent call recorded it first and the trigger refused ours. The transaction is aborted, so nothing is kept.
    if (e instanceof Error && e.message.includes(LOCKED_911)) return fail(LOCKED_911);
    throw e;
  }
  return ok();
}

/* ---------- handover ---------- */

async function ackHandover(r: Run, cmd: Cmd<"ackHandover">): Promise<CommandResult> {
  if (cmd.note !== undefined && typeof cmd.note !== "string") return fail("The note must be text");
  const note = trimmed(cmd.note);
  if (note.length > NOTE_MAX) return fail(`Keep the note under ${NOTE_MAX} characters`);
  const [dup] = await select(r.q, "select 1 from handovers where id = $1", [cmd.handoverId]);
  if (dup) return fail("This handover is already signed off");
  if (!(await addEvent(r, "handover", cmd.handoverId, "Handover acknowledged"))) return replayed(r, cmd);
  await r.q(
    "insert into handovers (id, org_id, property_id, signed_by, note, op_id) values ($1, $2, $3, $4, $5, $6)",
    [cmd.handoverId, r.ctx.orgId, r.ctx.propertyId, r.ctx.actorStaffId, note || null, r.opId],
  );
  return ok();
}

/** The client's returnOrphans(): open items whose assignee is off shift (or removed) go back to the department queue. */
async function returnOrphans(r: Run, cmd: Cmd<"returnOrphans">): Promise<CommandResult> {
  const ids = cmd.itemIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_RETURN || new Set(ids).size !== ids.length) {
    return fail("Choose the items to return");
  }
  const rows = await select<{ id: string; orphaned: boolean }>(
    r.q,
    `select i.id, (i.status = any($3::text[]) and i.assignee is not null and not coalesce(s.on_shift and s.active, false)) as orphaned
       from items i left join staff s on s.id = i.assignee
      where i.id = any($1::uuid[]) and i.property_id = $2
      order by i.created_at, i.id
        for update of i`,
    [ids, r.ctx.propertyId, OPEN_STATUSES],
  );
  if (rows.length !== ids.length) return fail(NO_ITEM);
  const orphans = rows.filter((x) => x.orphaned).map((x) => x.id);
  if (!orphans.length) return fail("Nothing to return. These items already have someone on shift.");
  if (!(await addEvent(r, "item", orphans[0], RETURNED))) return replayed(r, cmd);
  for (const itemId of orphans.slice(1)) await addEvent(r, "item", itemId, RETURNED);
  await r.q("update items set assignee = null where id = any($1::uuid[])", [orphans]);
  return ok();
}
