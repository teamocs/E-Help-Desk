// Reports for the mock desk (scripts/mock-wp.mjs): GET /reports/<id>?from=&to=&...[&format=csv], the same answers in
// the same shape as includes/Modules/Reports.php, computed in JavaScript over 120 days of generated history (a fixed
// seed, so every run shows the same figures) plus the mock's live request items. Not the authority: the SQL is.
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, OFF = 8 * HOUR, RELAY = 2 * MIN, MAX_DAYS = 366, MAX_ROWS = 500;
const now = Date.now();
const IDS = ["overview", "response", "kpi", "turnaround", "workorders", "inquiries", "crisis"];
const TITLES = { overview: "Reports", response: "Response Time", kpi: "KPI Dashboard", turnaround: "Room Turnaround", workorders: "WO Summary", inquiries: "Inquiry Volume", crisis: "Crisis Log" };
const PRIORITY = ["low", "medium", "high", "urgent"];
const WO_STATUS = ["scheduled", "reported", "assessed", "in_progress", "on_hold", "done"];
const CONTACTS = { in_house: "In-house guest", external: "External", checked_out: "Checked-out guest" };
const CR_STATUS = { active: "Active", monitoring: "Monitoring", resolved: "Closed" };
const CODES = { medical_emergency: "10-9 Medical Emergency", guest_complaint: "10-28 Guest Complaint", fire: "10-1 Fire", earthquake: "10-2 Earthquake", typhoon: "10-3 Typhoon", power_outage: "10-5 Power Outage", water_interruption: "10-6 Water Interruption", security_threat: "10-7 Security Threat", other: "10-0 Other" };
const CATS = { noise: "Noise", cleanliness: "Cleanliness", room_condition: "Room Condition", ac_temperature: "AC / Temperature", wifi_internet: "WiFi / Internet", wait_time: "Wait Time" };
const PLACES = { room: "Room", lobby: "Lobby", restaurant: "Restaurant", pool_area: "Pool Area", parking_area: "Parking Area", kitchen: "Kitchen", hallway_corridor: "Hallway / Corridor" };
const CLEAN = { regular: "Regular", checkout: "Checkout", deep_clean: "Deep Clean", touch_up: "Touch-up", pre_arrival: "Pre-arrival", turndown: "Turndown" };
const TYPES = [["Extra towels", "housekeeping", 10], ["Extra pillows", "housekeeping", 10], ["Bathroom amenities", "housekeeping", 10], ["Room cleaning", "housekeeping", 40], ["AC not cooling", "engineering", 45], ["Plumbing issue", "engineering", 60], ["Light bulb", "engineering", 20], ["TV not working", "it", 30], ["Wi-Fi issue", "it", 20], ["Room service", "fnb", 30], ["Bottled water", "fnb", 15], ["Luggage assistance", "frontdesk", 10], ["Checkout", "frontdesk", 10], ["Security escort", "security", 10]];

/* ---------- 120 days of a working hotel, from a fixed seed ---------- */
let seed = 20261030;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
/** A busy-hours moment of a hotel day: few at night, most from 7 AM to 10 PM. */
const momentOf = (dayStart) => dayStart + (rnd() < 0.08 ? between(0, 6) : between(6.5, 23)) * HOUR;
let hist = null;
function history() {
  if (hist) return hist;
  const items = [], requests = [], inquiries = [], wos = [], cleans = [], cases = [];
  const today = Math.floor((now + OFF) / DAY) * DAY - OFF;
  for (let d = 120; d >= 0; d--) {
    const start = today - d * DAY, weekend = new Date(start + OFF).getUTCDay() % 6 === 0;
    for (let i = Math.round(between(22, 40) * (weekend ? 1.25 : 1)); i > 0; i--) {
      const created = momentOf(start);
      if (created > now) continue;
      const [name, dept, sla] = pick(TYPES);
      const it = { name, dept, slaMin: sla, createdAt: created, heldMs: 0 };
      const relay = rnd() < 0.82 ? between(0.2, 2) * MIN : between(2, rnd() < 0.8 ? 6 : 25) * MIN;
      if (rnd() > 0.03 && created + relay < now) {
        it.ackAt = created + relay;
        const work = sla * MIN * (rnd() < 0.8 ? between(0.3, 1) : between(1, 2.4));
        if (rnd() < 0.06) it.heldMs = between(10, 90) * MIN;
        if (it.ackAt + work + it.heldMs < now) { it.doneAt = it.ackAt + work + it.heldMs; it.status = "done"; } else it.status = "relayed";
      } else it.status = "new";
      items.push(it);
      if (rnd() < 0.75) requests.push({ createdAt: created });
    }
    for (let i = Math.round(between(5, 14)); i > 0; i--) {
      const created = momentOf(start);
      if (created > now) continue;
      const close = rnd() < 0.62 ? between(1, 6) * MIN : between(6, 45) * MIN;
      const closed = rnd() < 0.9 && created + close < now ? created + close : null;
      inquiries.push({ contactType: pick(["in_house", "in_house", "in_house", "external", "external", "checked_out"]), createdAt: created, closedAt: closed, quick: closed !== null && close <= 6 * MIN });
    }
    for (let i = Math.round(between(8, 18)); i > 0; i--) {
      const checkout = start + between(7, 12.5) * HOUR, type = pick(["checkout", "checkout", "checkout", "regular", "regular", "deep_clean", "touch_up", "pre_arrival", "turndown"]);
      const clockIn = checkout + between(10, type === "checkout" ? 150 : 60) * MIN, clockOut = clockIn + between(18, type === "deep_clean" ? 110 : 55) * MIN;
      if (clockOut > now) continue;
      cleans.push({ type, clockIn, clockOut, checkoutAt: type === "checkout" ? checkout : null });
    }
    if (rnd() < 0.55) {
      const created = momentOf(start), pri = pick(["low", "medium", "medium", "high", "urgent"]), est = Math.round(between(3, 160)) * 100;
      const age = (now - created) / DAY, deadline = Math.floor((created + OFF) / DAY) * DAY - OFF + Math.round(between(1, 7)) * DAY;
      const status = age > 9 ? (rnd() < 0.9 ? "done" : "on_hold") : pick(["reported", "assessed", "in_progress", "on_hold", "done", "done"]);
      const end = status === "done" ? Math.min(now, created + between(3, 120) * HOUR) : null;
      wos.push({ no: wos.length + 1, area: pick(["Room", "Public Area", "Office", "Function Room", "Basement Parking"]), dept: pick(["engineering", "engineering", "engineering", "it", "housekeeping"]), pri, status, createdAt: created, actualEnd: end, est, actual: end ? Math.round(est * between(0.7, 1.4)) : null, deadline });
    }
    if (rnd() < 0.18) {
      const occurred = momentOf(start), code = pick(["guest_complaint", "guest_complaint", "guest_complaint", "medical_emergency", "power_outage", "water_interruption", "security_threat", "other"]);
      const resolved = rnd() < 0.85 && occurred + 3 * HOUR < now ? occurred + between(0.3, 30) * HOUR : null;
      cases.push({ no: cases.length + 1, code, category: code === "guest_complaint" ? pick(Object.keys(CATS)) : null, location: pick(Object.keys(PLACES)), occurredAt: occurred, resolvedAt: resolved, status: resolved ? "resolved" : pick(["active", "monitoring"]), called: code === "medical_emergency" && rnd() < 0.5 });
    }
  }
  return (hist = { items, requests, inquiries, wos, cleans, cases });
}

/* ---------- dates: the hotel's calendar days (Asia/Manila, UTC+8, no daylight saving) ---------- */
const dateOf = (ms) => new Date(ms + OFF).toISOString().slice(0, 10);
const msOf = (date) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? ""); if (!m) return null; const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) - OFF; return dateOf(ms) === date ? ms : null; };
const addDays = (date, n) => dateOf(msOf(date) + n * DAY + 12 * HOUR);
const num = (v, dp = 0) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const pct = (n, d) => (d > 0 ? Math.round((100 * n) / d) : null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const min = (ms) => num(ms == null ? null : ms / MIN, 1);
const hours = (ms) => num(ms == null ? null : ms / HOUR, 1);
const fig = (key, label, value, unit) => ({ key, label, value, unit });
const col = (key, label, unit = "") => ({ key, label, unit });
const inRange = (t, q) => t != null && t >= q.start && t < q.end;
const days = (q, fn) => Array.from({ length: q.days }, (_, i) => fn(addDays(q.from, i), q.start + i * DAY));

function params(url, id) {
  const g = (k) => url.searchParams.get(k) || "";
  const to = g("to") || dateOf(now), from = g("from") || addDays(to, -6);
  const start = msOf(from), last = msOf(to);
  if (start == null || last == null) return { error: "Choose real dates (YYYY-MM-DD)." };
  if (start > last) return { error: "The start date is after the end date." };
  const end = last + DAY, n = Math.round((end - start) / DAY);
  if (n > MAX_DAYS) return { error: `Choose at most ${MAX_DAYS} days.` };
  const format = g("format") || "json";
  if (!["json", "csv"].includes(format)) return { error: "Unknown format." };
  const ok = { dept: (v) => /^[a-z0-9_]{1,20}$/.test(v), type: (v) => v.trim() && v.length <= 120, priority: (v) => PRIORITY.includes(v), status: (v) => (id === "crisis" ? Object.keys(CR_STATUS) : WO_STATUS).includes(v), contact: (v) => v in CONTACTS, code: (v) => /^[a-z0-9_]{1,20}$/.test(v) };
  const f = {};
  for (const [k, test] of Object.entries(ok)) { const v = g(k); if (!v) continue; if (!test(v)) return { error: `That ${k === "type" ? "request type" : k} filter is not valid.` }; f[k] = v; }
  return { from, to, start, end, days: n, format, f };
}

/* ---------- the reports ---------- */
function clocks(its) {
  const acked = its.filter((i) => i.ackAt), done = its.filter((i) => i.status === "done" && i.ackAt && i.doneAt);
  const work = (i) => i.doneAt - i.ackAt - (i.heldMs ?? 0);
  return {
    items: its.length,
    relayAvg: min(avg(acked.map((i) => i.ackAt - i.createdAt))),
    relayPct: pct(acked.filter((i) => i.ackAt - i.createdAt <= RELAY).length, acked.length),
    workAvg: min(avg(done.map(work))),
    withinPct: pct(done.filter((i) => work(i) <= i.slaMin * MIN).length, done.length),
    done: done.length,
    target: num(avg(its.map((i) => i.slaMin))),
  };
}
const groupBy = (xs, key) => xs.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const count = (labels, xs, key) => Object.entries(labels).map(([k, label]) => ({ label, count: xs.filter((x) => key(x) === k).length }));
const allItems = (x) => [...history().items, ...Object.values(x.db.items ?? {})];

const REPORTS = {
  response(q, x) {
    const dl = Object.fromEntries(x.catalog.departments.map((d) => [d.key, d.label]));
    const base = allItems(x).filter((i) => inRange(i.createdAt, q));
    const its = base.filter((i) => (!q.f.dept || i.dept === q.f.dept) && (!q.f.type || i.name === q.f.type));
    const all = clocks(its);
    const byDept = Object.entries(groupBy(its, (i) => i.dept)).sort(([a], [b]) => a.localeCompare(b)).map(([d, xs]) => ({ dept: d, label: dl[d] ?? d, ...clocks(xs) }));
    const rows = Object.values(groupBy(its, (i) => `${i.name}|${i.dept}`)).map((xs) => ({ type: xs[0].name, dept: dl[xs[0].dept] ?? xs[0].dept, ...clocks(xs) })).sort((a, b) => b.items - a.items || a.type.localeCompare(b.type));
    const relay = its.filter((i) => i.ackAt).map((i) => i.ackAt - i.createdAt), done = its.filter((i) => i.status === "done" && i.ackAt && i.doneAt).map((i) => (i.doneAt - i.ackAt - (i.heldMs ?? 0)) / (i.slaMin * MIN));
    const band = (xs, edges, labels) => labels.map((label, k) => ({ label, count: xs.filter((v) => (k === 0 || v > edges[k - 1]) && (k === edges.length || v <= edges[k])).length }));
    return {
      headline: fig("withinPct", "finished within target", all.withinPct, "pct"),
      summary: [fig("items", "Items logged", all.items, "count"), fig("relayAvg", "Average time to relay", all.relayAvg, "min"), fig("relayPct", "Relayed within 2 minutes", all.relayPct, "pct"), fig("workAvg", "Average time to complete", all.workAvg, "min"), fig("withinPct", "Completed within target", all.withinPct, "pct")],
      options: { dept: x.catalog.departments.map((d) => ({ value: d.key, label: d.label })), type: [...new Set(base.map((i) => i.name))].sort().map((n) => ({ value: n, label: n })) },
      byDept,
      relayDist: band(relay, [MIN, 2 * MIN, 5 * MIN, 15 * MIN], ["Under 1 min", "1 to 2 min", "2 to 5 min", "5 to 15 min", "Over 15 min"]),
      workDist: band(done, [0.5, 1, 2], ["Under half the target", "Within target", "Up to twice the target", "Over twice the target"]),
      empty: all.items === 0,
      table: { columns: [col("type", "Request type"), col("dept", "Department"), col("items", "Items", "count"), col("relayAvg", "Avg to relay", "min"), col("relayPct", "Relayed within 2 min", "pct"), col("workAvg", "Avg to complete", "min"), col("target", "Target", "min"), col("withinPct", "Within target", "pct")], rows },
    };
  },
  kpi(q, x) {
    const h = history();
    const figures = (s, e) => {
      const r = { start: s, end: e }, c = clocks(allItems(x).filter((i) => inRange(i.createdAt, r)));
      const inq = h.inquiries.filter((i) => inRange(i.createdAt, r)), closed = inq.filter((i) => i.closedAt);
      return [fig("requests", "Tickets logged", h.requests.filter((i) => inRange(i.createdAt, r)).length, "count"), fig("items", "Items logged", c.items, "count"), fig("relayPct", "Relayed within 2 minutes", c.relayPct, "pct"), fig("withinPct", "Completed within target", c.withinPct, "pct"), fig("relayAvg", "Average time to relay", c.relayAvg, "min"), fig("workAvg", "Average time to complete", c.workAvg, "min"), fig("inquiries", "Inquiries", inq.length, "count"), fig("quickPct", "Inquiries closed within 6 minutes", pct(closed.filter((i) => i.quick).length, closed.length), "pct"), fig("woReported", "Work orders reported", h.wos.filter((w) => inRange(w.createdAt, r)).length, "count"), fig("woDone", "Work orders completed", h.wos.filter((w) => w.status === "done" && inRange(w.actualEnd, r)).length, "count"), fig("cleaned", "Rooms cleaned", h.cleans.filter((c2) => inRange(c2.clockOut, r)).length, "count"), fig("crisis", "Crisis cases", h.cases.filter((k) => inRange(k.occurredAt, r)).length, "count")];
    };
    const len = q.end - q.start, cur = figures(q.start, q.end), prev = figures(q.start - len, q.start);
    const its = allItems(x);
    return {
      headline: { ...cur[1], label: "items logged" }, summary: cur,
      previous: { from: addDays(q.from, -q.days), to: addDays(q.from, -1) },
      trend: days(q, (date, s) => ({ date, count: its.filter((i) => i.createdAt >= s && i.createdAt < s + DAY).length })),
      options: {},
      empty: cur.every((f) => f.unit !== "count" || f.value === 0),
      table: { columns: [col("label", "Figure"), col("value", "This period"), col("prev", "Previous period"), col("change", "Change"), col("unit", "Unit")], rows: cur.map((f, i) => ({ label: f.label, value: f.value, prev: prev[i].value, change: f.value == null || prev[i].value == null ? null : num(f.value - prev[i].value, 1), unit: f.unit })) },
    };
  },
  turnaround(q) {
    const cs = history().cleans.filter((c) => inRange(c.clockOut, q) && (!q.f.type || c.type === q.f.type)).map((c) => ({ type: c.type, clean: c.clockOut - c.clockIn, turn: c.checkoutAt ? c.clockOut - c.checkoutAt : null }));
    const stat = (xs) => ({ rooms: xs.length, cleanAvg: min(avg(xs.map((c) => c.clean))), turned: xs.filter((c) => c.turn != null).length, turnAvg: min(avg(xs.filter((c) => c.turn != null).map((c) => c.turn))) });
    const all = stat(cs), band = (vals, edges, labels) => labels.map((label, k) => ({ label, count: vals.filter((v) => (k === 0 || v > edges[k - 1]) && (k === edges.length || v <= edges[k])).length }));
    return {
      headline: fig("turnAvg", "checkout to clean room", all.turnAvg, "min"),
      summary: [fig("rooms", "Rooms cleaned", all.rooms, "count"), fig("cleanAvg", "Average cleaning time", all.cleanAvg, "min"), fig("turned", "Checkouts matched", all.turned, "count"), fig("turnAvg", "Average checkout to clean room", all.turnAvg, "min")],
      options: { type: Object.entries(CLEAN).map(([value, label]) => ({ value, label })) },
      turnDist: band(cs.filter((c) => c.turn != null).map((c) => c.turn), [HOUR, 2 * HOUR, 4 * HOUR], ["Within 1 h", "1 to 2 h", "2 to 4 h", "Over 4 h"]),
      cleanDist: band(cs.map((c) => c.clean), [20 * MIN, 40 * MIN, 60 * MIN], ["Within 20 min", "20 to 40 min", "40 to 60 min", "Over 60 min"]),
      empty: all.rooms === 0,
      table: { columns: [col("type", "Cleaning type"), col("rooms", "Rooms cleaned", "count"), col("cleanAvg", "Avg cleaning", "min"), col("turned", "With a checkout time", "count"), col("turnAvg", "Avg checkout to clean", "min")], rows: Object.entries(groupBy(cs, (c) => c.type)).map(([t, xs]) => ({ type: CLEAN[t] ?? t, ...stat(xs) })).sort((a, b) => b.rooms - a.rooms) },
    };
  },
  workorders(q, x) {
    const dl = Object.fromEntries(x.catalog.departments.map((d) => [d.key, d.label]));
    const today = msOf(dateOf(now));
    const ws = history().wos.filter((w) => inRange(w.createdAt, q) && (!q.f.dept || w.dept === q.f.dept) && (!q.f.priority || w.pri === q.f.priority) && (!q.f.status || w.status === q.f.status));
    const late = (w) => !["done", "scheduled"].includes(w.status) && w.deadline < today;
    const stat = (xs) => ({ count: xs.length, done: xs.filter((w) => w.status === "done").length, overdue: xs.filter(late).length, completeAvg: hours(avg(xs.filter((w) => w.actualEnd).map((w) => w.actualEnd - w.createdAt))), est: xs.reduce((a, w) => a + w.est, 0), actual: xs.reduce((a, w) => a + (w.actual ?? 0), 0) });
    const all = stat(ws), cap = (s) => s[0].toUpperCase() + s.slice(1).replace("_", " ");
    return {
      headline: fig("overdue", "overdue", all.overdue, "count"),
      summary: [fig("count", "Work orders reported", all.count, "count"), fig("open", "Still open", all.count - all.done, "count"), fig("overdue", "Overdue", all.overdue, "count"), fig("completeAvg", "Average time to complete", all.completeAvg, "h"), fig("est", "Estimated cost", ws.length ? all.est : null, "php"), fig("actual", "Actual cost (completed)", all.done ? all.actual : null, "php"), fig("estDone", "Estimate of the completed", all.done ? ws.filter((w) => w.status === "done").reduce((a, w) => a + w.est, 0) : null, "php")],
      options: { dept: x.catalog.departments.map((d) => ({ value: d.key, label: d.label })), priority: PRIORITY.map((p) => ({ value: p, label: cap(p) })), status: WO_STATUS.map((s) => ({ value: s, label: cap(s) })) },
      byStatus: WO_STATUS.map((s) => ({ label: cap(s), count: ws.filter((w) => w.status === s).length })),
      byPriority: PRIORITY.map((p) => ({ label: cap(p), count: ws.filter((w) => w.pri === p).length })),
      byDept: Object.entries(groupBy(ws, (w) => w.dept)).map(([d, xs]) => ({ label: dl[d] ?? d, ...stat(xs) })).sort((a, b) => b.count - a.count),
      capped: ws.length > MAX_ROWS, empty: ws.length === 0,
      table: { columns: [col("no", "WO"), col("area", "Area"), col("dept", "Department"), col("priority", "Priority"), col("status", "Status"), col("reported", "Reported", "date"), col("done", "Completed", "date"), col("hours", "Time to complete", "h"), col("est", "Estimated cost", "php"), col("actual", "Actual cost", "php"), col("overdue", "Overdue")],
        rows: [...ws].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ROWS).map((w) => ({ no: `WO-${String(w.no).padStart(4, "0")}`, area: w.area, dept: dl[w.dept] ?? w.dept, priority: cap(w.pri), status: cap(w.status), reported: dateOf(w.createdAt), done: w.actualEnd ? dateOf(w.actualEnd) : null, hours: w.actualEnd ? hours(w.actualEnd - w.createdAt) : null, est: w.est, actual: w.actual, overdue: late(w) ? "Yes" : "No" })) },
    };
  },
  inquiries(q) {
    const xs = history().inquiries.filter((i) => inRange(i.createdAt, q) && (!q.f.contact || i.contactType === q.f.contact));
    const closed = xs.filter((i) => i.closedAt);
    const dayRows = days(q, (date, s) => { const d = xs.filter((i) => i.createdAt >= s && i.createdAt < s + DAY), c = d.filter((i) => i.closedAt); return { date, total: d.length, inHouse: d.filter((i) => i.contactType === "in_house").length, external: d.filter((i) => i.contactType === "external").length, checkedOut: d.filter((i) => i.contactType === "checked_out").length, closed: c.length, quickPct: pct(c.filter((i) => i.quick).length, c.length) }; });
    return {
      headline: fig("count", "inquiries", xs.length, "count"),
      summary: [fig("count", "Inquiries", xs.length, "count"), fig("perDay", "Average per day", num(xs.length / q.days, 1), "count"), fig("closed", "Closed", closed.length, "count"), fig("quickPct", "Closed within 6 minutes", pct(closed.filter((i) => i.quick).length, closed.length), "pct"), fig("closeAvg", "Average time to close", min(avg(closed.map((i) => i.closedAt - i.createdAt))), "min")],
      options: { contact: Object.entries(CONTACTS).map(([value, label]) => ({ value, label })) },
      trend: dayRows.map((r) => ({ date: r.date, count: r.total })),
      byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: xs.filter((i) => Math.floor(((i.createdAt + OFF) % DAY) / HOUR) === h).length })),
      byContact: count(CONTACTS, xs, (i) => i.contactType),
      empty: xs.length === 0,
      table: { columns: [col("date", "Date", "date"), col("total", "Inquiries", "count"), col("inHouse", "In-house guest", "count"), col("external", "External", "count"), col("checkedOut", "Checked-out guest", "count"), col("closed", "Closed", "count"), col("quickPct", "Closed within 6 min", "pct")], rows: dayRows },
    };
  },
  crisis(q) {
    const xs = history().cases.filter((k) => inRange(k.occurredAt, q) && (!q.f.code || k.code === q.f.code) && (!q.f.status || k.status === q.f.status));
    const done = xs.filter((k) => k.status === "resolved");
    const by = (key, labels) => Object.entries(groupBy(xs, (k) => k[key] ?? "")).map(([k, v]) => ({ label: k ? labels[k] ?? k : "Not given", count: v.length })).sort((a, b) => b.count - a.count);
    return {
      headline: fig("count", "cases", xs.length, "count"),
      summary: [fig("count", "Cases", xs.length, "count"), fig("open", "Still open", xs.length - done.length, "count"), fig("closeAvg", "Average time to close", hours(avg(done.map((k) => k.resolvedAt - k.occurredAt))), "h"), fig("called", "BFP/911 called", xs.filter((k) => k.called).length, "count")],
      options: { code: Object.entries(CODES).map(([value, label]) => ({ value, label })), status: Object.entries(CR_STATUS).map(([value, label]) => ({ value, label })) },
      byCode: by("code", CODES), byCategory: by("category", CATS), byLocation: by("location", PLACES),
      capped: xs.length > MAX_ROWS, empty: xs.length === 0,
      table: { columns: [col("no", "Case"), col("code", "Code"), col("category", "Category"), col("location", "Where"), col("occurred", "Occurred", "time"), col("closed", "Closed", "time"), col("hours", "Time to close", "h"), col("called", "BFP/911 called"), col("status", "Status")],
        rows: [...xs].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, MAX_ROWS).map((k) => ({ no: `CR-${String(k.no).padStart(4, "0")}`, code: CODES[k.code] ?? k.code, category: k.category ? CATS[k.category] : "—", location: PLACES[k.location] ?? "—", occurred: k.occurredAt, closed: k.resolvedAt, hours: k.resolvedAt ? hours(k.resolvedAt - k.occurredAt) : null, called: k.called ? "Yes" : "No", status: CR_STATUS[k.status] })) },
    };
  },
};

/* ---------- CSV, as Azl_Module_Reports::csv ---------- */
const cell = (v) => {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  let s = String(v);
  if (s && "=+-@\t\r".includes(s[0])) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const UNIT = { min: " (min)", h: " (hours)", pct: " (%)", php: " (PHP)" };
const stampOf = (ms) => new Date(ms + OFF).toISOString().slice(0, 16).replace("T", " ");
const csv = (t) => "﻿" + [t.columns.map((c) => cell(c.label + (UNIT[c.unit] ?? ""))).join(","), ...t.rows.map((r) => t.columns.map((c) => cell(c.unit === "time" && typeof r[c.key] === "number" ? stampOf(r[c.key]) : r[c.key])).join(","))].join("\r\n") + "\r\n";

export default {
  id: "reports",
  routes: {
    "GET /reports/<id>": (url, x) => {
      if (x.level("reports") === "none") return { status: 403, data: { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." } };
      const id = url.pathname.split("/").pop();
      if (!IDS.includes(id)) return { status: 404, data: { ok: false, code: "azl_invalid", error: "Unknown report." } };
      const q = params(url, id);
      if (q.error) return { status: 400, data: { ok: false, code: "azl_invalid", error: q.error } };
      const head = { ok: true, report: id, title: TITLES[id], range: { from: q.from, to: q.to, days: q.days }, filters: q.f };
      if (id === "overview") return { ...head, headlines: Object.fromEntries(IDS.slice(1).map((r) => [r, REPORTS[r]({ ...q, f: {} }, x).headline])) };
      const out = { ...head, ...REPORTS[id](q, x) };
      if (q.format !== "csv") return out;
      const name = `azalea-mock-${TITLES[id].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${q.from}-to-${q.to}.csv`;
      return { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` }, raw: csv(out.table) };
    },
  },
};
