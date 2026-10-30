// npm run mock:wp -> http://localhost:8787/helpdesk/?role=owner&hotel=baguio
// A stand-in for the WordPress plugin, for looking at the desk without WordPress: it prints window.AZL and the hotel's
// --azl-* variables like azalea-ehelpdesk.php does, serves the built bundle (npm run build:wp first) and fonts, and
// answers the REST routes from memory. Not a backend: just enough state for every screen. No dependencies.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
// The desk's own catalog rules (Node runs the TypeScript file directly): seed, validation and the in-use check.
import { LISTS, SEED_CATALOG, deleteBlocker, validateList } from "../src/domain/catalog.ts";
// The role matrix (the desk's copy of Azl_Access): window.AZL.user.modules, window.AZL.access and command refusals.
import { LABELS, MATRIX, kindOfStaffRole, levelOf, readRefusal } from "../src/modules/access.ts";
// The desk's undo rule (the same as Azl_Commands::undo_target).
import { undoTarget } from "../src/domain/rules.ts";

const PORT = Number(process.env.PORT) || 8787;
const defaultRoot = fileURLToPath(new URL("../azalea-ehelpdesk/assets/", import.meta.url));
// AZL_ASSETS: a private folder holding desk/ (built with AZL_OUT=<that folder>/desk); fonts fall back to the plugin folder.
const root = process.env.AZL_ASSETS ? resolve(process.env.AZL_ASSETS) + sep : defaultRoot;
const NS = "/wp-json/azl-ehd/v1";
const now = Date.now(), min = 60_000;
const SHARED = { "--azl-surface": "#ffffff", "--azl-ink": "#201e1d", "--azl-muted": "#6d675f", "--azl-line": "rgba(32,30,29,.14)", "--azl-on-accent": "#ffffff", "--azl-on-gold": "#201e1d", "--azl-ok": "#2b6b45", "--azl-ok-soft": "#e3f1e8", "--azl-warn": "#7a4b00", "--azl-warn-soft": "#fbefd0", "--azl-bad": "#a43d36", "--azl-bad-soft": "#f8e3e1", "--azl-font-heading": '"Amaranth", Georgia, serif', "--azl-font-body": '"Figtree", system-ui, sans-serif', "--azl-radius-pill": "999px", "--azl-radius-card": "16px", "--azl-radius-input": "8px" };
const HOTELS = {
  baguio: { name: "Azalea Baguio", vars: { "--azl-bg": "#f6f2e9", "--azl-accent": "#3f7052", "--azl-accent-strong": "#345f45", "--azl-accent-soft": "#e6eee8", "--azl-deep": "#142d1f", "--azl-on-deep": "#cfd8d0", "--azl-gold": "#c0a14c", "--azl-shadow": "0 6px 24px rgba(32,30,29,.12)" } },
  boracay: { name: "Azalea Hotels & Residences Boracay", vars: { "--azl-bg": "#f7f4ec", "--azl-accent": "#177280", "--azl-accent-strong": "#135f6b", "--azl-accent-soft": "#e2f2f5", "--azl-deep": "#0e393f", "--azl-on-deep": "#e2f2f5", "--azl-gold": "#d8d2c4", "--azl-shadow": "0 6px 24px rgba(14,57,63,.12)" } },
};

/* ---------- fixture ---------- */
const staff = [
  ["s-maria", "Maria Santos", "hdo", "Head Desk Officer", "frontdesk"], ["s-joel", "Joel Dizon", "staff", "Room Attendant", "housekeeping"],
  ["s-ramon", "Ramon Cruz", "staff", "Engineer", "engineering"], ["s-liza", "Liza Abad-Fernandez de la Cruz", "supervisor", "Housekeeping Supervisor", "housekeeping"],
  ["s-paolo", "Paolo Rivera", "staff", "IT Support", "it"],
].map(([id, name, role, title, dept]) => ({ id, name, role, title, dept, onShift: id !== "s-paolo", initials: name.split(" ").map((w) => w[0]).slice(0, 2).join("") }));
const ev = (what, at = Date.now(), by = "system") => ({ at, by, what });
const item = (id, requestId, name, dept, status, ago, extra = {}) => ({ id, requestId, name, qty: 1, dept, status, createdAt: now - ago * min, heldMs: 0, slaMin: 20, events: [ev("Logged", now - ago * min)], ...extra });
// Requests in every state (wave 2): a staff request, an "Other" item with qty, a transfer and a hand-off, a ticket with
// edit history, an item on hold, a VIP, a ticket logged for later and a few from yesterday for the date filter.
const at = (m) => now - m * min;
const req = (id, n, room, ago, itemIds, extra = {}) => ({ id, ticket: `T-0${n}`, room, source: "guest", hdo: "s-maria", loggedBy: "s-maria", createdAt: at(ago), itemIds, events: [ev("Logged", at(ago), "s-maria")], ...extra });
const db = {
  requests: [
    req("r1", 101, "412", 25, ["i1", "i2"], { vip: true, remarks: "Guest is leaving for the airport at 3 p.m.", events: [ev("Logged", at(25), "s-maria"), ev("Room: 410 → 412", at(22), "s-maria"), ev("VIP: no → yes", at(22), "s-maria")] }),
    req("r2", 102, "305", 12, ["i3"]),
    req("r3", 103, "1208", 40, ["i4"]),
    req("r4", 104, "220", 90, ["i5", "i11"]),
    req("r5", 105, "118", 3, [], { incomplete: true }),
    req("r6", 106, "507", 6, ["i6", "i12"], { source: "staff_request", staffName: "Abad, Liza", remarks: "HK found the shower rail loose" }),
    req("r7", 107, "903", 18, ["i7", "i13", "i14"]),
    req("r8", 108, "614", 1, ["i8"]),
    req("r9", 109, "701", 26 * 60, ["i9"]),
    req("r10", 110, "216", 27 * 60, ["i10"], { source: "staff" }),
  ],
  items: Object.fromEntries([
    item("i1", "r1", "Extra towels", "housekeeping", "relayed", 25, { qty: 3, ackAt: at(24), relayedBy: "s-maria", prevStatus: "new", assignee: "s-joel", events: [ev("Logged", at(25)), ev("Relayed", at(24), "s-maria"), ev("Qty: 1 → 3", at(23), "s-maria")] }),
    item("i2", "r1", "Late checkout", "frontdesk", "new", 25),
    item("i3", "r2", "AC not cold", "engineering", "on_site", 12, { ackAt: at(11), onSiteAt: at(8), relayedBy: "s-maria", prevStatus: "relayed", assignee: "s-ramon", slaMin: 45 }),
    item("i4", "r3", "Wi-Fi issue", "it", "on_hold", 40, { ackAt: at(38), onSiteAt: at(35), prevStatus: "on_site", holdReason: "dnd", holdSince: at(30), assignee: "s-paolo" }),
    item("i5", "r4", "Bottled water", "fnb", "done", 90, { qty: 2, ackAt: at(88), onSiteAt: at(85), prevStatus: "on_site", doneAt: at(80), events: [ev("Logged", at(90)), ev("Relayed", at(88), "s-maria"), ev("On site", at(85), "s-maria"), ev("Done", at(80), "s-maria"), ev("Handed off to Housekeeping: Guest wants the glasses replaced too", at(79), "s-maria")] }),
    item("i11", "r4", "Bottled water", "housekeeping", "new", 79, { xFrom: "i5", xKind: "handoff", xNote: "Guest wants the glasses replaced too", events: [ev("Follow-up of Bottled water", at(79), "s-maria")] }),
    item("i6", "r6", "Shower rail loose", "engineering", "relayed", 6, { ackAt: at(5), relayedBy: "s-maria", prevStatus: "new", assignee: "s-ramon", slaMin: 30 }),
    item("i12", "r6", "Extra hangers", "housekeeping", "new", 6, { qty: 4, slaMin: 30, remarks: "Wooden ones if we have them" }),
    item("i7", "r7", "No hot water", "engineering", "on_site", 18, { ackAt: at(16), onSiteAt: at(12), prevStatus: "relayed", assignee: "s-ramon", slaMin: 30 }),
    item("i13", "r7", "TV not working", "housekeeping", "transferred", 18, { ackAt: at(17), prevStatus: "relayed", doneAt: at(15), events: [ev("Logged", at(18)), ev("Relayed", at(17), "s-maria"), ev("Transferred to it", at(15), "s-maria")] }),
    item("i14", "r7", "TV not working", "it", "new", 15, { xFrom: "i13", xKind: "transfer", xNote: "Remote and set both dead", events: [ev("Transferred in", at(15), "s-maria")] }),
    item("i8", "r8", "Tray pickup", "fnb", "new", 1, { slaMin: 15 }),
    item("i9", "r9", "TV not working", "it", "done", 26 * 60, { ackAt: at(26 * 60 - 2), onSiteAt: at(26 * 60 - 6), prevStatus: "on_site", doneAt: at(26 * 60 - 15) }),
    item("i10", "r10", "Extra towels", "housekeeping", "done", 27 * 60, { ackAt: at(27 * 60 - 1), doneAt: at(27 * 60 - 8), slaMin: 10 }),
  ].map((i) => [i.id, i])),
  // Work orders in every stage, so the list looks like a working hotel.
  wos: [
    { id: "w1", no: "WO-0007", area: "Guest room", loc: "Room 1208", desc: "Bathroom exhaust fan rattles", priority: "high", dept: "engineering", status: "assessed", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 3 * 3600_000, assessment: "Worn part, replace", assignType: "inhouse", estCost: 1800, audit: [ev("Reported", now - 3 * 3600_000, "s-ramon"), ev("Assessed", now - 2 * 3600_000, "s-ramon")] },
    { id: "w2", no: "WO-0006", area: "Public area", loc: "Lobby restroom", desc: "Hand dryer not working", priority: "normal", dept: "engineering", status: "reported", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 70 * min, audit: [ev("Reported", now - 70 * min, "s-ramon")] },
    { id: "w3", no: "WO-0005", area: "Outdoor", loc: "Pool deck", desc: "Pool pump is noisy", priority: "normal", dept: "engineering", status: "in_progress", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 26 * 3600_000, assessment: "Vendor repair needed", assignType: "outsource", contractor: "Benguet Pool Works", estCost: 12500, audit: [ev("Reported", now - 26 * 3600_000, "s-ramon"), ev("Assessed", now - 24 * 3600_000, "s-ramon"), ev("Work started", now - 5 * 3600_000, "s-ramon")] },
    { id: "w4", no: "WO-0004", area: "Public area", loc: "4th floor corridor", desc: "Replace corridor light fixtures", priority: "normal", dept: "engineering", status: "on_hold", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 50 * 3600_000, assessment: "Worn part, replace", assignType: "inhouse", estCost: 6400, audit: [ev("Reported", now - 50 * 3600_000, "s-ramon"), ev("Assessed", now - 48 * 3600_000, "s-ramon"), ev("Put on hold", now - 30 * 3600_000, "s-ramon")] },
    { id: "w5", no: "WO-0003", area: "Public area", loc: "Main stairwell", desc: "Repaint stairwell railing", priority: "normal", dept: "engineering", status: "done", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 96 * 3600_000, assessment: "Needs repainting", assignType: "inhouse", estCost: 4000, actualCost: 4350, audit: [ev("Reported", now - 96 * 3600_000, "s-ramon"), ev("Assessed", now - 95 * 3600_000, "s-ramon"), ev("Completed", now - 40 * 3600_000, "s-ramon")] },
  ],
  // One of every state, so Housekeeping shows its groups.
  cleaning: [
    { id: "c1", room: "305", type: "Checkout", status: "ready", assignee: "s-joel" },
    { id: "c2", room: "507", type: "Checkout", status: "ready" },
    { id: "c3", room: "218", type: "Stayover", status: "in_progress", assignee: "s-joel" },
    { id: "c4", room: "611", type: "Checkout", status: "queued", assignee: "s-liza" },
    { id: "c5", room: "903", type: "Deep clean", status: "scheduled" },
    { id: "c6", room: "1102", type: "Checkout", status: "done", assignee: "s-joel" },
  ],
  incidents: [{ id: "x1", no: "INC-001", hazard: "flood", rooms: ["220"], createdAt: now - 50 * min, text: "Water under the door", status: "resolved", log: [ev("Reported", now - 50 * min), ev("Resolved with engineer and manager sign-off", now - 20 * min)] }],
  handover: { ackBy: "Maria Santos", ackAt: now - 9 * 3600_000 },
  seq: { t: 110, wo: 7, inc: 1, id: 0 },
};
const accounts = [{ id: 2, name: "Ana Villanueva", email: "ana@example.test", role: "manager", disabled: false }, { id: 3, name: "Front desk phone", email: "desk-phone@example.test", role: "device", disabled: false }];
let rev = 1, nextId = 10;
let catalog = structuredClone(SEED_CATALOG);

/* ---------- per-module extensions: every scripts/mock/<id>.mjs adds sample data, commands and a snapshot slice.
   export default { id, commandModule: { commandType: moduleId }, commands: { commandType: (c, x) => void | { ok:false, error } }, snapshot: (x) => slice }
   where x = { db, staff, catalog, ev, by, t, role }. ---------- */
const EXT = [], EXT_COMMANDS = {}, EXT_MODULE = {}, EXT_ROUTES = [];
{
  const { readdirSync } = await import("node:fs");
  const dir = fileURLToPath(new URL("./mock/", import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) {
    const m = (await import(new URL(`./mock/${f}`, import.meta.url))).default;
    EXT.push(m);
    Object.assign(EXT_COMMANDS, m.commands ?? {});
    Object.assign(EXT_MODULE, m.commandModule ?? {});
    // routes: { "GET /reports/<id>": (url, x) => json | { status, headers, raw } }; <name> matches one path segment.
    for (const [k, h] of Object.entries(m.routes ?? {})) { const [method, path] = k.split(" "); EXT_ROUTES.push([method, new RegExp(`^${path.replace(/<\w+>/g, "[^/]+")}$`), h]); }
  }
}
// catalog(cat): an extension may add lists and their definitions (scripts/mock/config.mjs: module lists, catalog.defs).
for (const m of EXT) if (m.catalog) catalog = m.catalog(catalog);
const extSnapshot = (role) => Object.fromEntries(EXT.filter((m) => m.snapshot).map((m) => [m.id, m.snapshot({ db, staff, catalog, ev, role })]));

/* ---------- the hotel's lists: GET /catalog, PUT /catalog/<list> (stale and in-use refusals like the plugin) ---------- */
function usage() {
  const out = { departments: {}, holdReasons: {} };
  const bump = (list, key, what, n = 1) => { if (key) ((out[list][key] ??= {})[what] = (out[list][key][what] ?? 0) + n); };
  for (const s of staff) bump("departments", s.dept, "people");
  for (const d of new Set(Object.values(db.items).map((i) => `${i.dept}|${i.requestId}`))) bump("departments", d.split("|")[0], "requests");
  for (const w of db.wos) bump("departments", w.dept, "workOrders");
  for (const d of new Set(Object.values(db.items).filter((i) => i.holdReason).map((i) => `${i.holdReason}|${i.requestId}`))) bump("holdReasons", d.split("|")[0], "requests");
  out.openWorkOrders = db.wos.filter((w) => w.status !== "done").length;
  out.lists = Object.assign({}, ...EXT.map((m) => m.usage?.({ db, catalog }) ?? {})); // usage(x): module lists in use
  return out;
}
function makeKey(label, taken) {
  const base = (label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item").slice(0, 20);
  let key = base;
  for (let n = 2; key.length < 2 || taken.has(key); n++) key = base.slice(0, 20 - `_${n}`.length).replace(/_+$/, "") + `_${n}`;
  taken.add(key);
  return key;
}
function putList(list, b) {
  if (!LISTS.includes(list) && !catalog.defs?.some((d) => d.key === list)) return [404, { ok: false, code: "azl_invalid", error: "Unknown list." }];
  if (!Array.isArray(b.items) || !Number.isInteger(b.baseRev)) return [400, { ok: false, code: "azl_invalid", error: "Send the whole list and the version you loaded." }];
  if (b.baseRev !== catalog.catalogRev) return [409, { ok: false, code: "azl_stale", error: "Someone else changed this list. Your screen was refreshed; try again.", catalog, usage: usage() }];
  const known = new Set(catalog[list].map((x) => x.key));
  const bad = b.items.findIndex((x) => x.key && !known.has(x.key));
  if (bad >= 0) return [400, { ok: false, code: "azl_invalid", error: "This entry no longer exists. Reload the list.", index: bad }];
  const items = b.items.map((x) => ({ ...x, label: String(x.label ?? "").trim(), active: x.active !== false, ...(list === "departments" ? { repairs: x.repairs ?? false } : {}) }));
  const problem = validateList(list, items, catalog, usage().openWorkOrders);
  if (problem) return [400, { ok: false, code: "azl_invalid", ...problem }];
  const kept = new Set(items.map((x) => x.key));
  for (const old of catalog[list]) {
    const why = kept.has(old.key) ? "" : deleteBlocker(list, old.key, catalog, usage());
    if (why) return [409, { ok: false, code: "azl_in_use", key: old.key, error: `${old.label}: ${why}` }];
  }
  const taken = new Set([...known, ...kept]);
  catalog = { ...catalog, [list]: items.map((x) => ({ ...x, key: x.key || makeKey(x.label, taken) })), catalogRev: catalog.catalogRev + 1 };
  rev++;
  return [200, { ok: true, catalog, usage: usage() }];
}

/* ---------- access: the same answers as Azl_Access ---------- */
const COMMAND_MODULE = { ackHandover: "dashboard", returnOrphans: "dashboard", assessWo: "workorders", startWo: "workorders", holdWo: "workorders", completeWo: "workorders", reopenWo: "workorders", cleanSet: "cleaning", raiseSafety: "crisis", downgradeIncident: "crisis", record911: "crisis", resolveIncident: "crisis" };
const repairs = (dept) => catalog.departments.some((d) => d.key === dept && d.active && d.repairs);
const whoOf = (role, actor) => (role === "device" ? (() => { const p = staff.find((x) => x.id === actor); return { kind: kindOfStaffRole(p?.role), dept: p?.dept }; })() : { kind: role });
const levels = (who) => Object.fromEntries(Object.keys(MATRIX).map((m) => [m, levelOf(m, who, MATRIX, repairs)]).filter(([, l]) => l !== "none"));
function refusal(c, who) {
  const mod = COMMAND_MODULE[c.type] ?? EXT_MODULE[c.type] ?? "requests";
  if (who.kind === "none") return "Sign in with your PIN first.";
  const level = levelOf(mod, who, MATRIX, repairs);
  if (level === "none") return `Your role cannot use ${LABELS[mod]}.`;
  if (level === "read" && readRefusal(mod, c.type, LABELS[mod])) return readRefusal(mod, c.type, LABELS[mod]);
  if (level === "own" && (c.type === "resolveIncident" || c.type === "editRequest")) return `Only a supervisor or manager can do this in ${LABELS[mod]}.`;
  if (level === "own" && who.kind === "staff" && c.itemId && db.items[c.itemId] && db.items[c.itemId].dept !== who.dept) return "You can only work on items of your own department.";
  return null;
}

/* ---------- commands: just enough to keep the screens honest ---------- */
const activeIn = (list, key) => catalog[list].find((x) => x.key === key && x.active);
function apply(c, by) {
  const it = db.items[c.itemId], wo = db.wos.find((w) => w.id === c.woId), inc = db.incidents.find((i) => i.id === c.incidentId), t = Date.now();
  const mark = (x, status, what, extra = {}) => Object.assign(x, { status, ...extra, events: [...(x.events ?? []), ev(what, t, by)] });
  // Requests (wave 2): rows (a request type or "Other" with a department), qty and an assignee; the same refusals as Commands.php.
  const ofDept = (who, dept) => !who || staff.some((p) => p.id === who && p.dept === dept);
  const rowSpec = (r) => {
    const p = r.type ? activeIn("requestTypes", r.type) : null;
    if (r.type && !p) return "Unknown request type";
    if (!r.type && !String(r.other ?? "").trim()) return "Describe the item";
    if (!r.type && !activeIn("departments", r.dept)) return "Choose a department for the item";
    const qty = r.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return "Quantity must be 1 to 99";
    const dept = p ? p.dept : r.dept;
    if (!ofDept(r.assignee, dept)) return "Assign someone from the item's department";
    return { name: p ? p.label : r.other.trim(), dept, slaMin: p ? p.slaMin : 30, qty, assignee: r.assignee };
  };
  const specsOf = (x) => (x.rows ?? (x.presets ?? []).map((type) => ({ type }))).map(rowSpec);
  const addItems = (reqId, ids, specs, what = "Logged") => specs.forEach((sp, n) => { db.items[ids[n]] = item(ids[n], reqId, sp.name, sp.dept, "new", 0, { createdAt: t,  slaMin: sp.slaMin, qty: sp.qty, assignee: sp.assignee, events: [ev(what, t, by)] }); });
  if (["logRequest", "completeRequest"].includes(c.type)) { const bad = specsOf(c).find((x) => typeof x === "string"); if (bad) return { ok: false, error: bad }; }
  if (c.bundle && !activeIn("bundles", c.bundle)) return { ok: false, error: "Unknown request type" };
  if (c.type === "logRequest" && c.source === "staff_request" && !String(c.staffName ?? "").trim()) return { ok: false, error: "Enter the staff member's name" };
  if ((c.type === "transfer" || c.type === "handOff") && !activeIn("departments", c.dept)) return { ok: false, error: "Unknown department" };
  if ((c.type === "transfer" || c.type === "handOff") && !ofDept(c.assignee, c.dept)) return { ok: false, error: "Assign someone from that department" };
  if (c.type === "hold" && !activeIn("holdReasons", c.reason)) return { ok: false, error: "Unknown hold reason" };
  if (c.type === "escalate" && !(activeIn("departments", it?.dept)?.repairs && ["on_site", "on_hold"].includes(it?.status))) return { ok: false, error: "Only on-site items of a department that handles repairs can become work orders." };
  const name = (id) => staff.find((p) => p.id === id)?.name ?? "—";
  const change = (f, a, b) => `${f}: ${a || "—"} → ${b || "—"}`;
  switch (c.type) {
    case "logRequest": {
      const specs = specsOf(c);
      addItems(c.requestId, c.itemIds, specs);
      const parts = c.bundle ? activeIn("bundles", c.bundle).parts : [], off = specs.length;
      parts.forEach((p, j) => { const id = c.itemIds[off + j]; db.items[id] = item(id, c.requestId, p.name, p.dept, "new", 0, { createdAt: t,  slaMin: p.slaMin, dependsOn: p.after != null ? c.itemIds[off + p.after] : undefined }); });
      db.requests.unshift({ id: c.requestId, ticket: `T-0${++db.seq.t}`, room: c.room, source: c.source ?? "staff", staffName: c.source === "staff_request" ? c.staffName.trim() : undefined, hdo: c.hdoId ?? by, loggedBy: by, createdAt: t, itemIds: c.itemIds.slice(0, off + parts.length), incomplete: !!c.later || off + parts.length === 0, vip: !!c.vip, remarks: c.remarks, events: [ev("Logged", t, by)] });
      break;
    }
    case "completeRequest": { const r = db.requests.find((x) => x.id === c.requestId); addItems(c.requestId, c.itemIds, specsOf(c), "Details added"); Object.assign(r, { itemIds: [...r.itemIds, ...c.itemIds], incomplete: false }); break; }
    case "relay": mark(it, "relayed", "Relayed", { ackAt: t, relayedBy: by, prevStatus: it.status }); break;
    case "onSite": mark(it, "on_site", "On site", { ackAt: it.ackAt ?? t, onSiteAt: t, prevStatus: it.status }); break;
    case "hold": mark(it, "on_hold", "On hold", { holdReason: c.reason, holdSince: t, prevStatus: it.status }); break;
    case "resume": mark(it, "on_site", "Resumed", { heldMs: it.heldMs + t - it.holdSince, holdSince: undefined, holdReason: undefined, prevStatus: it.status }); break;
    case "finish": mark(it, c.status, { done: "Done", cant_do: "Can't do", duplicate: "Marked duplicate", cancelled: "Cancelled" }[c.status], { doneAt: t, ackAt: it.ackAt ?? t, prevStatus: it.status, heldMs: it.status === "on_hold" ? it.heldMs + t - it.holdSince : it.heldMs, holdSince: undefined, holdReason: undefined }); break;
    case "transfer": mark(it, "transferred", `Transferred to ${c.dept}`, { doneAt: t, prevStatus: it.status }); db.items[c.newItemId] = { ...item(c.newItemId, it.requestId, it.name, c.dept, "new", 0, { createdAt: t,  qty: it.qty, slaMin: it.slaMin, assignee: c.assignee, events: [ev("Transferred in", t, by)] }), xFrom: it.id, xKind: "transfer", xNote: c.note }; db.requests.find((r) => r.id === it.requestId).itemIds.push(c.newItemId); break;
    case "editRequest": {
      const r = db.requests.find((x) => x.id === c.requestId);
      if (!r) return { ok: false, error: "Unknown request" };
      const lines = [];
      if (c.room != null && c.room.trim() !== r.room) { lines.push(change("Room", r.room, c.room.trim())); r.room = c.room.trim(); }
      if (c.vip != null && c.vip !== !!r.vip) { lines.push(change("VIP", r.vip ? "yes" : "no", c.vip ? "yes" : "no")); r.vip = c.vip; }
      if (c.source) {
        const was = r.source === "staff_request" ? `Staff (${r.staffName})` : "Guest", next = c.source === "staff_request" ? `Staff (${c.staffName})` : "Guest";
        if (was !== next) { lines.push(change("Requested by", was, next)); r.source = c.source; r.staffName = c.source === "staff_request" ? c.staffName : undefined; }
      }
      if (c.hdoId && c.hdoId !== r.hdo) { lines.push(change("HDO", name(r.hdo), name(c.hdoId))); r.hdo = c.hdoId; }
      if (c.remarks != null && c.remarks !== (r.remarks ?? "")) { lines.push(change("Remarks", r.remarks, c.remarks)); r.remarks = c.remarks || undefined; }
      if (!lines.length) return { ok: false, error: "Nothing changed" };
      r.events = [...(r.events ?? []), ...lines.map((l) => ev(l, t, by))];
      break;
    }
    case "editItem": {
      if (!it) return { ok: false, error: "Unknown item" };
      if (["transferred", "escalated", "cancelled"].includes(it.status)) return { ok: false, error: `Not possible while the item is ${it.status}` };
      if (c.dept && c.dept !== it.dept && it.status !== "new") return { ok: false, error: "Use Transfer to move a started item to another department" };
      const dept = c.dept ?? it.dept;
      if ("assignee" in c && !ofDept(c.assignee, dept)) return { ok: false, error: "Assign someone from the item's department" };
      const lines = [];
      if (c.name && c.name !== it.name) { lines.push(change("Item", it.name, c.name)); it.name = c.name; }
      if (c.qty != null && c.qty !== it.qty) { lines.push(change("Qty", it.qty, c.qty)); it.qty = c.qty; }
      if (dept !== it.dept) { lines.push(change("Department", it.dept, dept)); it.dept = dept; }
      if ("assignee" in c && (c.assignee ?? undefined) !== it.assignee) { lines.push(change("Assigned", name(it.assignee), name(c.assignee))); it.assignee = c.assignee ?? undefined; }
      if (c.remarks != null && c.remarks !== (it.remarks ?? "")) { lines.push(change("Remarks", it.remarks, c.remarks)); it.remarks = c.remarks || undefined; }
      if (!lines.length) return { ok: false, error: "Nothing changed" };
      it.events = [...it.events, ...lines.map((l) => ev(l, t, by))];
      break;
    }
    case "handOff": {
      if (!it || it.status !== "done") return { ok: false, error: "Only a done item can be handed off. Use Transfer for open work." };
      const nm = c.name ?? it.name;
      it.events = [...it.events, ev(`Handed off to ${activeIn("departments", c.dept).label}${c.assignee ? ` (${name(c.assignee)})` : ""}${c.note ? `: ${c.note}` : ""}`, t, by)];
      db.items[c.newItemId] = { ...item(c.newItemId, it.requestId, nm, c.dept, "new", 0, { createdAt: t,  qty: it.qty, slaMin: nm === it.name ? it.slaMin : 30, assignee: c.assignee, events: [ev(`Follow-up of ${it.name}`, t, by)] }), xFrom: it.id, xKind: "handoff", xNote: c.note };
      db.requests.find((r) => r.id === it.requestId).itemIds.push(c.newItemId);
      break;
    }
    case "undoStep": {
      if (!it) return { ok: false, error: "Unknown item" };
      if (it.status === "escalated") { db.wos = db.wos.filter((w) => w.id !== it.woId); mark(it, it.stBeforeEsc ?? "on_site", "Escalation undone", { woId: undefined, stBeforeEsc: undefined }); break; }
      const tg = undoTarget(it);
      if (tg.refused) return { ok: false, error: tg.refused };
      const copy = it.status === "transferred" ? Object.values(db.items).find((x) => x.xFrom === it.id && x.status !== "cancelled" && x.xKind !== "handoff") : null;
      if (copy && copy.status !== "new") return { ok: false, error: "The other department already started on it. Ask them to transfer it back." };
      const back = { relayed: { ackAt: undefined, relayedBy: undefined }, on_site: { onSiteAt: undefined, ...(tg.to === "new" ? { ackAt: undefined } : {}) }, on_hold: { holdSince: undefined, holdReason: undefined } }[it.status] ?? { doneAt: undefined, ...(tg.to === "new" ? { ackAt: undefined } : {}) };
      const step = { relayed: "Relayed", on_site: "On site", on_hold: "On hold", transferred: `Transferred to ${copy?.dept ?? ""}`, cant_do: "Can't do", duplicate: "Marked duplicate", cancelled: "Cancelled" }[it.status] ?? "Done";
      mark(it, tg.to, `Undone: ${step}`, { ...back, prevStatus: undefined });
      if (copy) mark(copy, "cancelled", "Cancelled: transfer undone", { prevStatus: "new", doneAt: t });
      break;
    }
    case "escalate": mark(it, "escalated", "Escalated", { woId: c.woId, stBeforeEsc: it.status }); db.wos.unshift({ id: c.woId, no: `WO-000${++db.seq.wo}`, area: "Guest room", loc: `Room ${db.requests.find((r) => r.id === it.requestId)?.room ?? ""}`.trim(), desc: it.name, priority: "normal", dept: it.dept, status: "reported", reportedBy: by, encodedBy: by, createdAt: t, srcItemId: it.id, audit: [ev("Escalated from request", t, by)] }); break;
    case "assessWo": Object.assign(wo, { status: "assessed", assessment: c.assessment, assignType: c.assignType, contractor: c.contractor, estCost: c.estCost }); break;
    case "startWo": case "reopenWo": wo.status = "in_progress"; break;
    case "holdWo": wo.status = "on_hold"; break;
    case "completeWo": Object.assign(wo, { status: "done", actualCost: c.actualCost }); break;
    case "cleanSet": db.cleaning.find((x) => x.id === c.taskId).status = c.status; break;
    case "raiseSafety": db.incidents.unshift({ id: c.incidentId, no: `INC-00${++db.seq.inc}`, hazard: c.hazard, rooms: [c.room], createdAt: t, text: c.text, status: "active", log: [ev("Safety words detected", t, by)] }); break;
    case "downgradeIncident": inc.status = "downgraded"; break;
    case "resolveIncident": inc.status = "resolved"; break;
    case "record911": inc.called911 = { by, at: new Date(c.at).toLocaleTimeString() }; break;
    case "ackHandover": db.handover = { ackBy: staff.find((s) => s.id === by)?.name ?? "a manager", ackAt: t }; break;
    case "returnOrphans": c.itemIds.forEach((id) => delete db.items[id].assignee); break;
    default: { const h = EXT_COMMANDS[c.type]; if (!h) return { ok: false, error: `The mock does not know ${c.type}.` }; const r = h(c, { db, staff, catalog, ev, by, t }); if (r && r.ok === false) return r; }
  }
  rev++;
  return { ok: true, applied: true };
}

/* ---------- http ---------- */
const send = (res, status, data, type = "application/json") => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(data) : data); };
const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } }); });
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };
const roleOf = (req) => /azl_role=(\w+)/.exec(req.headers.cookie ?? "")?.[1] ?? "owner";

function page(url, res) {
  const role = ["owner", "manager", "supervisor", "device"].includes(url.searchParams.get("role")) ? url.searchParams.get("role") : "owner";
  const key = url.searchParams.get("hotel") === "boracay" ? "boracay" : "baguio";
  const hotel = HOTELS[key];
  // ?empty=1 clears the desk (until the mock restarts) to show the empty states.
  if (url.searchParams.get("empty") === "1") {
    Object.assign(db, { requests: [], items: {}, wos: [], cleaning: [], incidents: [], handover: {} });
    rev++;
  }
  // ?ack=0 puts the handover back to "not yet signed this shift" (the demo capture signs it more than once).
  if (url.searchParams.get("ack") === "0") db.handover = { ackBy: "Maria Santos", ackAt: now - 9 * 3600_000 };
  const manifest = existsSync(join(root, "desk/manifest.json")) ? JSON.parse(readFileSync(join(root, "desk/manifest.json"), "utf8"))["src/wp/main.tsx"] : null;
  if (!manifest) return send(res, 503, "Run npm run build:wp first.", "text/plain");
  const vars = Object.entries({ ...hotel.vars, ...SHARED }).map(([k, v]) => `${k}:${v}`).join(";");
  const AZL = { restUrl: `http://localhost:${PORT}${NS}/`, nonce: "mock-nonce", loginUrl: "/helpdesk/login/", pollMs: 5000, property: { id: `mock-${key}`, name: hotel.name },
    user: { name: role === "device" ? "Front desk phone" : role === "owner" ? "Mr. Reyes" : role === "supervisor" ? "Liza Abad" : "Ana Villanueva", role, canManage: role === "owner" || role === "manager", canManageLists: role === "owner" || role === "manager", modules: role === "device" ? {} : levels({ kind: role }) },
    access: MATRIX,
    theme: { key, name: hotel.name, logoUrl: url.searchParams.get("logo") === "0" ? "" : `/logo.svg?h=${key}`, fonts: {} }, version: "mock" };
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": `azl_role=${role}; Path=/; SameSite=Lax` });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="light"><title>E-Help Desk · ${hotel.name}</title>
<style>@font-face{font-family:"Amaranth";font-weight:400;font-display:swap;src:url(/fonts/amaranth-400-latin.woff2) format("woff2")}@font-face{font-family:"Figtree";font-weight:300 900;font-display:swap;src:url(/fonts/figtree-variable-latin.woff2) format("woff2")}:root{color-scheme:light;${vars}}</style>
${(manifest.css ?? []).map((c) => `<link rel="stylesheet" href="/desk/${c}">`).join("")}</head><body><div id="azl-root"></div>
<script>window.AZL=${JSON.stringify(AZL)};</script><script type="module" src="/desk/${manifest.file}"></script></body></html>`);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname, m = req.method;
  if (p === "/" || p === "/helpdesk") return res.writeHead(302, { Location: "/helpdesk/" + url.search }).end();
  if (p === "/helpdesk/") return page(url, res);
  if (p === "/helpdesk/login/") return send(res, 200, `<!doctype html><title>Signed out</title><p style="font:16px system-ui;padding:2rem">Signed out of the mock. <a href="/helpdesk/">Open the desk again</a></p>`, "text/html");
  if (p === "/logo.svg") { const b = url.searchParams.get("h") === "boracay"; return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${b ? "#0e393f" : "#142d1f"}"/><path d="M20 7 9 33h5l2.4-6h7.2l2.4 6h5L20 7Zm-2 15 2-6 2 6h-4Z" fill="${b ? "#d8d2c4" : "#c0a14c"}"/></svg>`, "image/svg+xml"); }
  if (/^\/(desk|fonts)\//.test(p)) {
    let base = root, f = normalize(join(root, p));
    if (!existsSync(f)) { base = defaultRoot; f = normalize(join(defaultRoot, p)); }
    if (!f.startsWith(base) || !existsSync(f)) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, readFileSync(f), MIME[extname(f)] ?? "application/octet-stream");
  }
  if (!p.startsWith(NS)) return send(res, 404, "Not found", "text/plain");
  const r = p.slice(NS.length), actor = /^tok-(.+)$/.exec(req.headers["x-azl-actor"] ?? "")?.[1] ?? null, role = roleOf(req);
  // Module slices: none of the wave 2 modules exist yet, so every reader gets an empty object.
  if (r === "/snapshot") return send(res, 200, { ...db, staff, property: { id: "mock", name: "Mock" }, properties: [], at: Date.now(), actor, catalog, modules: extSnapshot(roleOf(req)) });
  if (r === "/catalog" && m === "GET") return send(res, 200, { ok: true, catalog, usage: usage() });
  if (r === "/poll") { const since = Number(url.searchParams.get("since")); return send(res, 200, { ok: true, rev, changed: since !== rev }); }
  const route = EXT_ROUTES.find(([mm, re]) => mm === m && re.test(r));
  if (route) {
    const out = await route[2](url, { db, staff, catalog, ev, role, actor, level: (mod) => levelOf(mod, whoOf(role, actor), MATRIX, repairs), body: () => body(req) });
    if (out && "raw" in out) { res.writeHead(out.status ?? 200, { "Cache-Control": "no-store", ...out.headers }); return res.end(out.raw); }
    return send(res, out?.status ?? 200, out?.status ? out.data : out);
  }
  const b = m === "GET" ? {} : await body(req);
  if (r === "/command") {
    if (role === "device" && !actor) return send(res, 403, { ok: false, code: "azl_needs_pin", error: "Sign in with your PIN first." });
    const why = refusal(b, whoOf(role, actor));
    if (why) return send(res, 200, { ok: false, error: why });
    return send(res, 200, apply(b, actor ?? "s-maria")); // an owner or manager's own account acts as the head desk officer in this mock
  }
  if (r === "/pin/sign-in") return /^\d{4}$/.test(b.pin) && b.pin !== "0000" ? send(res, 200, { ok: true, token: `tok-${b.staffId}`, expiresAt: Date.now() + 12 * 3600_000, staff: { id: b.staffId } }) : send(res, 200, { ok: false, error: "That name and PIN do not match." });
  if (r === "/pin/sign-out" || r === "/auth/logout") return send(res, 200, { ok: true, redirect: "/helpdesk/login/" });
  if (r === "/staff" && m === "POST") { const id = `s-${nextId++}`; staff.push({ id, name: b.name, title: b.title, role: b.role, dept: b.dept, onShift: true, initials: b.name.slice(0, 2).toUpperCase() }); rev++; return send(res, 201, { ok: true, id }); }
  if (r.startsWith("/staff/")) { const s = staff.find((x) => x.id === r.slice(7)); if (b.active === false) staff.splice(staff.indexOf(s), 1); rev++; return send(res, 200, { ok: true }); }
  if (r.startsWith("/catalog/") && m === "PUT") {
    if (role !== "owner" && role !== "manager") return send(res, 403, { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." });
    const [status, out] = putList(r.slice(9), b);
    return send(res, status, out);
  }
  if (r.startsWith("/accounts") && role !== "owner") return send(res, 403, { code: "rest_forbidden", message: "Only the hotel owner can manage logins." });
  if (r === "/accounts" && m === "GET") return send(res, 200, { ok: true, accounts: [{ id: 1, name: "Mr. Reyes", email: "owner@example.test", role: "owner", disabled: false, self: true }, ...accounts] });
  if (r === "/accounts" && m === "POST") {
    if (accounts.some((a) => a.email === String(b.email).toLowerCase())) return send(res, 409, { ok: false, error: "An account with that email already exists." });
    accounts.push({ id: nextId++, name: b.name, email: String(b.email).toLowerCase(), role: b.role, disabled: false });
    return send(res, 201, { ok: true, emailSent: true });
  }
  const acc = /^\/accounts\/(\d+)$/.exec(r) && accounts.find((a) => a.id === Number(r.split("/")[2]));
  if (acc && m === "PATCH") { acc.disabled = b.disabled === true; return send(res, 200, { ok: true, account: acc }); }
  send(res, 404, { code: "rest_no_route", message: "No route." });
}).listen(PORT, () => console.log(`Mock WordPress desk: http://localhost:${PORT}/helpdesk/?role=owner&hotel=baguio`));
