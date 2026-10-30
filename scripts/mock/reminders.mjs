// Sample server extension for Reminders: realistic data and the two commands, answering like Azl_Module_Reminders.
const min = 60_000, hour = 3_600_000;
const LINKS = ["request", "workorder", "inquiry", "housestatus", "crisis"];

function seed(db) {
  if (db.reminders) return;
  const now = Date.now();
  const r = (id, desc, assignee, dueAt, extra = {}) => ({ id, desc, assignee, dueAt, status: "pending", createdAt: now - 4 * hour, createdBy: "s-maria", ...extra });
  db.reminders = [
    r("rem-1", "Follow up Engineering — 305 AC", "s-rizza", now - 90 * min, { notes: "Parts?", link: { type: "request", id: "r2", label: "T-0102" } }),
    r("rem-2", "Call James Lee — charger", "s-maria", now - 20 * min, { notes: "Room 301. His driver collects it today." }),
    r("rem-3", "VIP Room 501", "s-maria", now + 2 * hour, { notes: "3 PM setup" }),
    r("rem-4", "Send the Dec 20-23 quote to Maria Cruz", undefined, now + 20 * hour, { link: { type: "inquiry", id: "inq-2", label: "I-0002" }, notes: "Two rooms with breakfast." }),
    r("rem-5", "Restock lobby brochures", undefined, undefined),
    r("rem-6", "Pool check", "s-maria", now - 6 * hour, { status: "completed", completedAt: now - 5 * hour, completedBy: "s-maria", notes: "Done" }),
  ];
}
const sort = (list) => [...list.filter((x) => x.status === "pending").sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt), ...list.filter((x) => x.status !== "pending")];

export default {
  id: "reminders",
  commandModule: { addReminder: "reminders", doneReminder: "reminders" },
  commands: {
    addReminder: (c, x) => {
      seed(x.db);
      if (!String(c.desc ?? "").trim()) return { ok: false, error: "Describe what needs following up" };
      if (c.dueAt != null && !Number.isInteger(c.dueAt)) return { ok: false, error: "Choose a valid date and time" };
      if (c.linkType != null && (!LINKS.includes(c.linkType) || !c.linkId)) return { ok: false, error: "Choose what to link the reminder to, or None" };
      if (c.assignee && !x.staff.some((p) => p.id === c.assignee && p.role !== "staff")) return { ok: false, error: "Choose someone from the help desk, or All HD Staff" };
      if (x.db.reminders.some((q) => q.id === c.reminderId)) return { ok: false, error: "This reminder was already added" };
      x.db.reminders.push({ id: c.reminderId, desc: String(c.desc).trim(), assignee: c.assignee, dueAt: c.dueAt, notes: c.notes || undefined, status: "pending", createdAt: x.t, createdBy: x.by, link: c.linkType ? { type: c.linkType, id: c.linkId, label: c.linkLabel ?? c.linkType } : undefined });
    },
    doneReminder: (c, x) => {
      seed(x.db);
      const q = x.db.reminders.find((y) => y.id === c.reminderId);
      if (!q) return { ok: false, error: "Unknown reminder" };
      if (q.status !== "pending") return { ok: false, error: "This reminder is already done" };
      Object.assign(q, { status: "completed", completedAt: x.t, completedBy: x.by });
    },
  },
  snapshot: (x) => {
    seed(x.db);
    const list = sort(x.db.reminders.filter((q) => q.status === "pending" || q.completedAt > Date.now() - 7 * 24 * hour));
    return { list, counts: { pending: list.filter((q) => q.status === "pending").length } };
  },
};
