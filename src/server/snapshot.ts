import type { Q } from "../lib/db";
import { pad } from "../domain/rules";
import type {
  CleanStatus,
  CleanTask,
  Dept,
  Handover,
  Hazard,
  HoldReason,
  Incident,
  Item,
  ItemEvent,
  ItemStatus,
  Request,
  Role,
  Staff,
  WoStatus,
  WorkOrder,
} from "../domain/types";
import type { Snapshot } from "./contract";

/** Requests younger than this are always sent; older ones only while one of their items is open. */
const REQUEST_HOURS = 48;
const REQUEST_CAP = 500;
/** Done work orders and done cleaning drop out after this long without activity. */
const WO_DONE_DAYS = 14;
const CLEAN_DONE_HOURS = 24;
/** Incidents that are no longer active drop out after this long. */
const INCIDENT_DAYS = 7;

export const OPEN_STATUSES: readonly ItemStatus[] = ["new", "relayed", "on_site", "on_hold"];

/** Runs a query and names the row shape. The caller lists the columns that make up `T`. */
export async function select<T>(q: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q(sql, params)).rows as T[];
}

const opt = <T>(v: T | null): T | undefined => v ?? undefined;

interface PropertyRow { id: string; name: string; ticket_seq: number; wo_seq: number; inc_seq: number; now: Date }
interface StaffRow { id: string; name: string; initials: string; role: Role; title: string; dept: Dept | null; on_shift: boolean }
interface EventRow { entity_id: string; what: string; by_staff: string | null; at: Date }
interface RequestRow {
  id: string; ticket_no: number; room: string; source: Request["source"]; remarks: string | null; logged_by: string | null;
  created_at: Date; incomplete: boolean; vip: boolean; safety_id: string | null;
}
interface ItemRow {
  id: string; request_id: string; name: string; qty: number; dept: Dept; assignee: string | null; status: ItemStatus;
  hold_reason: HoldReason | null; created_at: Date; ack_at: Date | null; done_at: Date | null; hold_since: Date | null;
  held_ms: number; sla_min: number; depends_on: string | null; x_from: string | null; wo_id: string | null;
  st_before_esc: ItemStatus | null;
}
interface WoRow {
  id: string; wo_no: number; area: string; loc: string; descr: string; priority: WorkOrder["priority"]; dept: Dept;
  status: WoStatus; reported_by: string | null; encoded_by: string | null; created_at: Date; assessment: string | null;
  assign_type: WorkOrder["assignType"] | null; contractor: string | null; est_cost: number | null;
  actual_cost: number | null; target_end: Date | null; src_item_id: string | null;
}
interface CleanRow { id: string; room: string; type: CleanTask["type"]; status: CleanStatus; assignee: string | null }
interface IncidentRow {
  id: string; inc_no: number; hazard: Hazard; rooms: string[]; created_at: Date; text: string; status: Incident["status"];
  called911_by: string | null; called911_at: Date | null;
}

export async function loadSnapshot(q: Q, orgId: string, propertyId: string): Promise<Snapshot> {
  const [p] = await select<PropertyRow>(
    q,
    "select id, name, ticket_seq, wo_seq, inc_seq, now() as now from properties where id = $1 and org_id = $2",
    [propertyId, orgId],
  );
  if (!p) throw new Error("Unknown property");
  const properties = await select<{ id: string; name: string }>(q, "select id, name from properties order by created_at, name");
  const { requests, items } = await loadRequests(q, propertyId);
  return {
    property: { id: p.id, name: p.name },
    properties,
    staff: await loadStaff(q),
    requests,
    items,
    wos: await loadWorkOrders(q, propertyId),
    cleaning: await loadCleaning(q, propertyId),
    incidents: await loadIncidents(q, propertyId),
    handover: await loadHandover(q, propertyId),
    seq: { t: p.ticket_seq, wo: p.wo_seq, inc: p.inc_seq, id: 0 },
    at: p.now.getTime(),
  };
}

async function loadStaff(q: Q): Promise<Staff[]> {
  const rows = await select<StaffRow>(
    q,
    "select id, name, initials, role, title, dept, on_shift from staff where active order by created_at, id",
  );
  return rows.map((s) => ({
    id: s.id, name: s.name, initials: s.initials, role: s.role, title: s.title, dept: opt(s.dept), onShift: s.on_shift,
  }));
}

/** History rows for many entities at once, keyed by entity id, oldest first. */
async function loadLogs(q: Q, entity: string, ids: string[]): Promise<Map<string, ItemEvent[]>> {
  const rows = await select<EventRow>(
    q,
    "select entity_id, what, by_staff, at from events where entity = $1 and entity_id = any($2::uuid[]) order by at, id",
    [entity, ids],
  );
  const out = new Map<string, ItemEvent[]>();
  for (const e of rows) {
    const log = out.get(e.entity_id) ?? [];
    log.push({ at: e.at.getTime(), by: e.by_staff ?? "system", what: e.what });
    out.set(e.entity_id, log);
  }
  return out;
}

async function loadRequests(q: Q, propertyId: string): Promise<{ requests: Request[]; items: Record<string, Item> }> {
  const reqs = await select<RequestRow>(
    q,
    `select id, ticket_no, room, source, remarks, logged_by, created_at, incomplete, vip, safety_id
       from requests r
      where property_id = $1
        and (created_at > now() - make_interval(hours => $2)
             or exists (select 1 from items i where i.request_id = r.id and i.status = any($3::text[])))
      order by created_at desc, id desc
      limit $4`,
    [propertyId, REQUEST_HOURS, OPEN_STATUSES, REQUEST_CAP],
  );
  const rows = await select<ItemRow>(
    q,
    `select id, request_id, name, qty, dept, assignee, status, hold_reason, created_at, ack_at, done_at, hold_since,
            held_ms::float8 as held_ms, sla_min, depends_on, x_from, wo_id, st_before_esc
       from items where request_id = any($1::uuid[]) order by created_at, id`,
    [reqs.map((r) => r.id)],
  );
  const logs = await loadLogs(q, "item", rows.map((i) => i.id));
  const items: Record<string, Item> = {};
  for (const i of rows) items[i.id] = toItem(i, logs.get(i.id) ?? []);
  const requests = reqs.map((r) => toRequest(r, rows.filter((i) => i.request_id === r.id).map((i) => i.id)));
  return { requests, items };
}

function toRequest(r: RequestRow, itemIds: string[]): Request {
  return {
    id: r.id, ticket: `T-${pad(r.ticket_no)}`, room: r.room, source: r.source, remarks: opt(r.remarks),
    loggedBy: r.logged_by ?? "", createdAt: r.created_at.getTime(), itemIds, incomplete: r.incomplete, vip: r.vip,
    safetyId: opt(r.safety_id),
  };
}

function toItem(i: ItemRow, events: ItemEvent[]): Item {
  return {
    id: i.id, requestId: i.request_id, name: i.name, qty: i.qty, dept: i.dept, assignee: opt(i.assignee),
    status: i.status, holdReason: opt(i.hold_reason), createdAt: i.created_at.getTime(), ackAt: i.ack_at?.getTime(),
    doneAt: i.done_at?.getTime(), holdSince: i.hold_since?.getTime(), heldMs: i.held_ms, slaMin: i.sla_min,
    dependsOn: opt(i.depends_on), xFrom: opt(i.x_from), woId: opt(i.wo_id), stBeforeEsc: opt(i.st_before_esc), events,
  };
}

async function loadWorkOrders(q: Q, propertyId: string): Promise<WorkOrder[]> {
  const rows = await select<WoRow>(
    q,
    `select id, wo_no, area, loc, descr, priority, dept, status, reported_by, encoded_by, created_at, assessment,
            assign_type, contractor, est_cost::float8 as est_cost, actual_cost::float8 as actual_cost, target_end, src_item_id
       from work_orders w
      where property_id = $1
        and (status <> 'done' or created_at > now() - make_interval(days => $2)
             or exists (select 1 from events e where e.entity = 'work_order' and e.entity_id = w.id
                          and e.at > now() - make_interval(days => $2)))
      order by created_at desc, id desc`,
    [propertyId, WO_DONE_DAYS],
  );
  const logs = await loadLogs(q, "work_order", rows.map((w) => w.id));
  return rows.map((w) => ({
    id: w.id, no: `WO-${pad(w.wo_no)}`, area: w.area, loc: w.loc, desc: w.descr, priority: w.priority, dept: w.dept,
    status: w.status, reportedBy: w.reported_by ?? "", encodedBy: w.encoded_by ?? "", createdAt: w.created_at.getTime(),
    assessment: opt(w.assessment), assignType: opt(w.assign_type), contractor: opt(w.contractor), estCost: opt(w.est_cost),
    actualCost: opt(w.actual_cost), targetEnd: w.target_end?.getTime(), srcItemId: opt(w.src_item_id),
    audit: logs.get(w.id) ?? [],
  }));
}

async function loadCleaning(q: Q, propertyId: string): Promise<CleanTask[]> {
  const rows = await select<CleanRow>(
    q,
    `select id, room, type, status, assignee
       from clean_tasks c
      where property_id = $1
        and (status <> 'done' or created_at > now() - make_interval(hours => $2)
             or exists (select 1 from events e where e.entity = 'clean_task' and e.entity_id = c.id
                          and e.at > now() - make_interval(hours => $2)))
      order by room, created_at`,
    [propertyId, CLEAN_DONE_HOURS],
  );
  return rows.map((c) => ({ id: c.id, room: c.room, type: c.type, status: c.status, assignee: opt(c.assignee) }));
}

/** Who signed off when no staff member was signed in with a PIN (the owner or manager account). */
export const MANAGER_SIGNER = "a manager";

async function loadHandover(q: Q, propertyId: string): Promise<Handover> {
  const [h] = await select<{ signed_at: Date; name: string | null }>(
    q,
    `select h.signed_at, s.name
       from handovers h left join staff s on s.id = h.signed_by
      where h.property_id = $1
      order by h.signed_at desc, h.id desc
      limit 1`,
    [propertyId],
  );
  return h ? { ackBy: h.name ?? MANAGER_SIGNER, ackAt: h.signed_at.getTime() } : {};
}

async function loadIncidents(q: Q, propertyId: string): Promise<Incident[]> {
  const rows = await select<IncidentRow>(
    q,
    `select i.id, i.inc_no, i.hazard, i.rooms, i.created_at, i.text, i.status, s.name as called911_by, i.called911_at
       from incidents i left join staff s on s.id = i.called911_by
      where i.property_id = $1 and (i.status = 'active' or i.created_at > now() - make_interval(days => $2))
      order by i.created_at desc, i.id desc`,
    [propertyId, INCIDENT_DAYS],
  );
  const logs = await loadLogs(q, "incident", rows.map((i) => i.id));
  return rows.map((i) => ({
    id: i.id, no: `INC-${pad(i.inc_no, 3)}`, hazard: i.hazard, rooms: i.rooms, createdAt: i.created_at.getTime(),
    text: i.text, status: i.status,
    called911: i.called911_at ? { by: i.called911_by ?? MANAGER_SIGNER, at: i.called911_at.toISOString() } : undefined,
    log: logs.get(i.id) ?? [],
  }));
}
