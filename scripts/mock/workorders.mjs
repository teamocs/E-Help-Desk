// Work Orders in the mock desk (scripts/mock-wp.mjs): richer sample data (every status, an overdue job, an outsourced
// one with progress notes, a preventive one waiting as Scheduled) and the module's own commands. The built-in
// assessWo, startWo, holdWo, completeWo and reopenWo are answered by mock-wp.mjs itself, which keeps only their
// status and cost: the new fields they carry (hold reason, notes, targets, who) show until the next refresh only.
const DAY = 86_400_000;
/** Midnight in Manila (UTC+8), n days from today, as epoch ms: how the plugin stores dates. */
const day = (n) => { const d = new Date(Date.now() + 8 * 3600_000 + n * DAY); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600_000; };
const h = (n) => Date.now() - n * 3600_000;
const ev = (what, at, by = "s-maria") => ({ at, by, what });

let seeded = false;
function seed(db) {
  if (seeded) return;
  seeded = true;
  db.wos = [
    { id: "w7", no: "WO-0007", area: "Staff House", loc: "Staff quarters 2F", desc: "Exhaust fan replacement (preventive)", priority: "low", dept: "engineering", status: "scheduled", reportedBy: "s-ramon", encodedBy: "s-maria", reporterDept: "engineering", createdAt: h(4), requestedDate: day(10), schedDate: day(7), audit: [ev("Scheduled", h(4))], updates: [] },
    { id: "w6", no: "WO-0006", area: "Public Area", loc: "Lobby restroom", desc: "Hand dryer not working", priority: "medium", dept: "engineering", status: "reported", reportedBy: "s-joel", encodedBy: "s-maria", reporterDept: "housekeeping", createdAt: h(1.2), requestedDate: day(2), audit: [ev("Reported by Joel Dizon (Housekeeping)", h(1.2))], updates: [] },
    { id: "w1", no: "WO-0005", area: "Room", loc: "Room 1208", desc: "Bathroom exhaust fan rattles", priority: "high", dept: "engineering", status: "assessed", reportedBy: "s-liza", encodedBy: "s-maria", reporterDept: "housekeeping", createdAt: h(3), requestedDate: day(1), assessment: "Worn part, replace", assignType: "inhouse", assignee: "s-ramon", assessedBy: "s-ramon", assessedAt: h(2), targetStart: day(0), targetEnd: day(1), estCost: 1800, audit: [ev("Reported by Liza Abad-Fernandez de la Cruz (Housekeeping)", h(3)), ev("Assessed", h(2), "s-ramon")], updates: [] },
    { id: "w3", no: "WO-0004", area: "Room", loc: "Room 305", desc: "AC compressor not functioning", priority: "urgent", dept: "engineering", status: "in_progress", reportedBy: "s-maria", encodedBy: "s-maria", reporterDept: "frontdesk", createdAt: h(80), requestedDate: day(-2), assessment: "Compressor seized. Full replacement needed.", assignType: "outsource", contractor: "CoolAir HVAC", assessedBy: "s-ramon", assessedAt: h(78), targetStart: day(-3), targetEnd: day(-1), estCost: 15000, actualStart: h(70),
      audit: [ev("Reported by Maria Santos (Front Desk)", h(80)), ev("Assessed", h(78), "s-ramon"), ev("Work started", h(70), "s-ramon"), ev("Progress update", h(30), "s-ramon"), ev("Outsourced: CoolAir HVAC", h(30), "s-ramon")],
      updates: [{ at: h(48), by: "s-ramon", text: "Parts ordered, ETA 2 days" }, { at: h(30), by: "s-ramon", text: "Compressor needs a specialist\nOutsourced: CoolAir HVAC" }] },
    { id: "w4", no: "WO-0003", area: "Public Area", loc: "4th floor corridor", desc: "Replace corridor light fixtures", priority: "medium", dept: "engineering", status: "on_hold", reportedBy: "s-ramon", encodedBy: "s-maria", reporterDept: "engineering", createdAt: h(50), requestedDate: day(4), assessment: "Worn part, replace", assignType: "inhouse", assignee: "s-ramon", assessedBy: "s-ramon", assessedAt: h(48), estCost: 6400, actualStart: h(40), holdReason: "Waiting for the LED panels from the supplier",
      audit: [ev("Reported by Ramon Cruz (Engineering)", h(50)), ev("Assessed", h(48), "s-ramon"), ev("Work started", h(40), "s-ramon"), ev("Put on hold", h(30), "s-ramon")],
      updates: [{ at: h(30), by: "s-ramon", text: "On hold: Waiting for the LED panels from the supplier" }] },
    { id: "w2", no: "WO-0002", area: "Room", loc: "Room 412", desc: "Wi-Fi access point keeps dropping", priority: "normal", dept: "it", status: "reported", reportedBy: "s-maria", encodedBy: "s-maria", createdAt: h(5), audit: [ev("Escalated from request", h(5))], updates: [] },
    { id: "w5", no: "WO-0001", area: "Public Area", loc: "Main stairwell", desc: "Repaint stairwell railing", priority: "low", dept: "engineering", status: "done", reportedBy: "s-ramon", encodedBy: "s-maria", reporterDept: "engineering", createdAt: h(96), requestedDate: day(-1), assessment: "Needs repainting", assignType: "inhouse", assignee: "s-ramon", assessedBy: "s-ramon", assessedAt: h(95), estCost: 4000, actualCost: 4350, actualStart: h(60), actualEnd: h(40), completionNotes: "Two coats, railing dry by evening",
      audit: [ev("Reported by Ramon Cruz (Engineering)", h(96)), ev("Assessed", h(95), "s-ramon"), ev("Work started", h(60), "s-ramon"), ev("Completed", h(40), "s-ramon")],
      updates: [{ at: h(40), by: "s-ramon", text: "Completed: Two coats, railing dry by evening" }] },
  ];
  db.seq.wo = 7;
}

const find = (x, id) => x.db.wos.find((w) => w.id === id);
const no = (msg) => ({ ok: false, error: msg });
const dateMs = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? Date.parse(`${d}T00:00:00+08:00`) : null);
const iso = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);

export default {
  id: "workorders",
  commandModule: { reportWo: "workorders", editWo: "workorders", updateWo: "workorders", openWo: "workorders" },
  commands: {
    reportWo(c, x) {
      seed(x.db);
      if (!String(c.desc ?? "").trim()) return no("Description required.");
      if (dateMs(c.requestedDate) == null) return no("Date required.");
      const n = ++x.db.seq.wo;
      const sched = dateMs(c.schedDate);
      x.db.wos.unshift({ id: c.woId, no: `WO-${String(n).padStart(4, "0")}`, area: c.area, loc: c.loc ?? "", desc: c.desc.trim(), priority: c.priority, dept: c.dept, status: sched ? "scheduled" : "reported",
        reportedBy: c.reporterId ?? "", encodedBy: c.encodedBy ?? x.by, reporterDept: c.reporterDept, requestedDate: dateMs(c.requestedDate), schedDate: sched ?? undefined, createdAt: x.t,
        audit: [x.ev(sched ? `Scheduled for ${c.schedDate}` : "Reported", x.t, x.by)], updates: [] });
    },
    editWo(c, x) {
      const w = find(x, c.woId);
      if (!w) return no("Unknown work order");
      for (const k of ["area", "loc", "desc", "priority", "dept", "contractor"]) if (c[k] != null) w[k] = c[k];
      if (c.assigneeId) w.assignee = c.assigneeId;
      if (c.clearAssignee) delete w.assignee;
      if (c.requestedDate) w.requestedDate = dateMs(c.requestedDate);
      w.audit.push(x.ev("Edited", x.t, x.by));
    },
    updateWo(c, x) {
      const w = find(x, c.woId);
      if (!w) return no("Unknown work order");
      if (!["in_progress", "on_hold"].includes(w.status)) return no(`Not possible while the work order is ${w.status.replace("_", " ")}`);
      if (!String(c.text ?? "").trim()) return no("Required.");
      const lines = [c.text.trim()];
      if (c.newDeadline) {
        const old = w.targetEnd ?? w.requestedDate;
        lines.push(`Deadline: ${old == null ? "none" : iso(old)} → ${c.newDeadline}${c.extendReason ? ` (${c.extendReason})` : ""}`);
        w.targetEnd = dateMs(c.newDeadline);
      }
      if (c.contractor) {
        if (w.assignType === "outsource") return no("This work order is already outsourced.");
        lines.push(`Outsourced: ${c.contractor}`);
        Object.assign(w, { assignType: "outsource", contractor: c.contractor, assignee: undefined }, c.estCost != null ? { estCost: c.estCost } : {});
      }
      (w.updates ??= []).push({ at: x.t, by: c.byId ?? x.by, text: lines.join("\n") });
      w.audit.push(x.ev("Progress update", x.t, x.by));
    },
    openWo(c, x) {
      const w = find(x, c.woId);
      if (!w) return no("Unknown work order");
      if (w.status !== "scheduled") return no(`Not possible while the work order is ${w.status.replace("_", " ")}`);
      w.status = "reported";
      w.audit.push(x.ev("Opened", x.t, x.by));
    },
  },
  snapshot: (x) => {
    seed(x.db);
    return {};
  },
};
