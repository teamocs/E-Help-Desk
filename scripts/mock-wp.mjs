// npm run mock:wp -> http://localhost:8787/helpdesk/?role=owner&hotel=baguio
// A stand-in for the WordPress plugin, for looking at the desk without WordPress: it prints window.AZL and the hotel's
// --azl-* variables like azalea-ehelpdesk.php does, serves the built bundle (npm run build:wp first) and fonts, and
// answers the REST routes from memory. Not a backend: just enough state for every screen. No dependencies.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 8787;
const root = fileURLToPath(new URL("../azalea-ehelpdesk/assets/", import.meta.url));
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
const db = {
  requests: [
    { id: "r1", ticket: "T-0101", room: "412", source: "staff", loggedBy: "s-maria", createdAt: now - 25 * min, itemIds: ["i1", "i2"], vip: true, remarks: "Guest is leaving for the airport at 3 p.m." },
    { id: "r2", ticket: "T-0102", room: "305", source: "staff", loggedBy: "s-maria", createdAt: now - 12 * min, itemIds: ["i3"] },
    { id: "r3", ticket: "T-0103", room: "1208", source: "staff", loggedBy: "s-maria", createdAt: now - 40 * min, itemIds: ["i4"] },
    { id: "r4", ticket: "T-0104", room: "220", source: "staff", loggedBy: "s-maria", createdAt: now - 90 * min, itemIds: ["i5"] },
    { id: "r5", ticket: "T-0105", room: "118", source: "staff", loggedBy: "s-maria", createdAt: now - 3 * min, itemIds: [], incomplete: true },
  ],
  items: Object.fromEntries([
    item("i1", "r1", "Extra towels", "housekeeping", "relayed", 25, { ackAt: now - 24 * min, assignee: "s-joel" }),
    item("i2", "r1", "Late checkout", "frontdesk", "new", 25),
    item("i3", "r2", "AC not cold", "engineering", "on_site", 12, { ackAt: now - 11 * min, assignee: "s-ramon", slaMin: 45 }),
    item("i4", "r3", "Wi-Fi issue", "it", "on_hold", 40, { ackAt: now - 38 * min, holdReason: "dnd", holdSince: now - 30 * min, assignee: "s-paolo" }),
    item("i5", "r4", "Bottled water", "fnb", "done", 90, { ackAt: now - 88 * min, doneAt: now - 80 * min }),
  ].map((i) => [i.id, i])),
  wos: [{ id: "w1", no: "WO-0007", area: "Guest room", loc: "Room 1208", desc: "Bathroom exhaust fan rattles", priority: "high", dept: "engineering", status: "assessed", reportedBy: "s-ramon", encodedBy: "s-maria", createdAt: now - 3 * 3600_000, assessment: "Worn part, replace", assignType: "inhouse", estCost: 1800, audit: [ev("Reported", now - 3 * 3600_000), ev("Assessed", now - 2 * 3600_000)] }],
  cleaning: [{ id: "c1", room: "305", type: "Checkout", status: "ready", assignee: "s-joel" }],
  incidents: [{ id: "x1", no: "INC-001", hazard: "flood", rooms: ["220"], createdAt: now - 50 * min, text: "Water under the door", status: "resolved", log: [ev("Reported", now - 50 * min), ev("Resolved with engineer and manager sign-off", now - 20 * min)] }],
  handover: { ackBy: "Maria Santos", ackAt: now - 9 * 3600_000 },
  seq: { t: 105, wo: 7, inc: 1, id: 0 },
};
const accounts = [{ id: 2, name: "Ana Villanueva", email: "ana@example.test", role: "manager", disabled: false }, { id: 3, name: "Front desk phone", email: "desk-phone@example.test", role: "device", disabled: false }];
let rev = 1, nextId = 10;

/* ---------- commands: just enough to keep the screens honest ---------- */
const PRESET = { towels: ["Extra towels", "housekeeping"], clean: ["Room cleaning", "housekeeping"], inspection: ["Checkout inspection", "housekeeping"], ac: ["AC not cold", "engineering"], bulb: ["Light bulb", "engineering"], wifi: ["Wi-Fi issue", "it"], water: ["Bottled water", "fnb"], late: ["Late checkout", "frontdesk"], noise: ["Noise complaint", "security"] };
function apply(c, by) {
  const it = db.items[c.itemId], wo = db.wos.find((w) => w.id === c.woId), inc = db.incidents.find((i) => i.id === c.incidentId), t = Date.now();
  const mark = (x, status, what, extra = {}) => Object.assign(x, { status, ...extra, events: [...(x.events ?? []), ev(what, t, by)] });
  const addItems = (reqId, ids, keys) => keys.forEach((k, n) => { const [name, dept] = PRESET[k] ?? [k, "frontdesk"]; db.items[ids[n]] = item(ids[n], reqId, name, dept, "new", 0); });
  switch (c.type) {
    case "logRequest": addItems(c.requestId, c.itemIds, c.presets ?? []); db.requests.unshift({ id: c.requestId, ticket: `T-0${++db.seq.t}`, room: c.room, source: "staff", loggedBy: by, createdAt: t, itemIds: c.itemIds.slice(0, (c.presets ?? []).length), incomplete: !!c.later, vip: !!c.vip, remarks: c.remarks }); break;
    case "completeRequest": { const r = db.requests.find((x) => x.id === c.requestId); addItems(c.requestId, c.itemIds, c.presets); Object.assign(r, { itemIds: [...r.itemIds, ...c.itemIds], incomplete: false }); break; }
    case "relay": mark(it, "relayed", "Relayed", { ackAt: t }); break;
    case "onSite": mark(it, "on_site", "On site", { ackAt: it.ackAt ?? t }); break;
    case "hold": mark(it, "on_hold", "On hold", { holdReason: c.reason, holdSince: t }); break;
    case "resume": mark(it, "on_site", "Resumed", { heldMs: it.heldMs + t - it.holdSince, holdSince: undefined }); break;
    case "finish": mark(it, c.status, "Done", { doneAt: t }); break;
    case "transfer": mark(it, "transferred", `Transferred to ${c.dept}`, { doneAt: t }); db.items[c.newItemId] = { ...item(c.newItemId, it.requestId, it.name, c.dept, "new", 0), xFrom: it.id }; db.requests.find((r) => r.id === it.requestId).itemIds.push(c.newItemId); break;
    case "escalate": mark(it, "escalated", "Escalated", { woId: c.woId, stBeforeEsc: it.status }); db.wos.unshift({ id: c.woId, no: `WO-000${++db.seq.wo}`, area: "Guest room", loc: "Room", desc: it.name, priority: "normal", dept: it.dept, status: "reported", reportedBy: by, encodedBy: by, createdAt: t, srcItemId: it.id, audit: [ev("Escalated from request", t, by)] }); break;
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
    default: return { ok: false, error: `The mock does not know ${c.type}.` };
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
  const manifest = existsSync(join(root, "desk/manifest.json")) ? JSON.parse(readFileSync(join(root, "desk/manifest.json"), "utf8"))["src/wp/main.tsx"] : null;
  if (!manifest) return send(res, 503, "Run npm run build:wp first.", "text/plain");
  const vars = Object.entries({ ...hotel.vars, ...SHARED }).map(([k, v]) => `${k}:${v}`).join(";");
  const AZL = { restUrl: `http://localhost:${PORT}${NS}/`, nonce: "mock-nonce", loginUrl: "/helpdesk/login/", pollMs: 5000, property: { id: `mock-${key}`, name: hotel.name },
    user: { name: role === "device" ? "Front desk phone" : role === "owner" ? "Mr. Reyes" : "Ana Villanueva", role, canManage: role === "owner" || role === "manager" },
    theme: { key, name: hotel.name, logoUrl: url.searchParams.get("logo") === "0" ? "" : "/logo.svg", fonts: {} }, version: "mock" };
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
  if (p === "/logo.svg") return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#142d1f"/><path d="M20 7 9 33h5l2.4-6h7.2l2.4 6h5L20 7Zm-2 15 2-6 2 6h-4Z" fill="#c0a14c"/></svg>`, "image/svg+xml");
  if (/^\/(desk|fonts)\//.test(p)) {
    const f = normalize(join(root, p));
    if (!f.startsWith(root) || !existsSync(f)) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, readFileSync(f), MIME[extname(f)] ?? "application/octet-stream");
  }
  if (!p.startsWith(NS)) return send(res, 404, "Not found", "text/plain");
  const r = p.slice(NS.length), actor = /^tok-(.+)$/.exec(req.headers["x-azl-actor"] ?? "")?.[1] ?? null, role = roleOf(req);
  if (r === "/snapshot") return send(res, 200, { ...db, staff, property: { id: "mock", name: "Mock" }, properties: [], at: Date.now(), actor });
  if (r === "/poll") { const since = Number(url.searchParams.get("since")); return send(res, 200, { ok: true, rev, changed: since !== rev }); }
  const b = m === "GET" ? {} : await body(req);
  if (r === "/command") {
    if (role === "device" && !actor) return send(res, 403, { ok: false, code: "azl_needs_pin", error: "Sign in with your PIN first." });
    return send(res, 200, apply(b, actor ?? "member"));
  }
  if (r === "/pin/sign-in") return /^\d{4}$/.test(b.pin) && b.pin !== "0000" ? send(res, 200, { ok: true, token: `tok-${b.staffId}`, expiresAt: Date.now() + 12 * 3600_000, staff: { id: b.staffId } }) : send(res, 200, { ok: false, error: "That name and PIN do not match." });
  if (r === "/pin/sign-out" || r === "/auth/logout") return send(res, 200, { ok: true, redirect: "/helpdesk/login/" });
  if (r === "/staff" && m === "POST") { const id = `s-${nextId++}`; staff.push({ id, name: b.name, title: b.title, role: b.role, dept: b.dept, onShift: true, initials: b.name.slice(0, 2).toUpperCase() }); rev++; return send(res, 201, { ok: true, id }); }
  if (r.startsWith("/staff/")) { const s = staff.find((x) => x.id === r.slice(7)); if (b.active === false) staff.splice(staff.indexOf(s), 1); rev++; return send(res, 200, { ok: true }); }
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
