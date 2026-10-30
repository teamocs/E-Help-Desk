// Cleaning in the mock desk (scripts/mock-wp.mjs): tasks in every state with clock times, and the module's commands
// (logClean, scheduleClean, clockIn, clockOut, editClean). The built-in cleanSet ("Mark ready") is mock-wp.mjs's own.
const DAY = 86_400_000;
const day = (n) => { const d = new Date(Date.now() + 8 * 3600_000 + n * DAY); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600_000; };
const m = (n) => Date.now() - n * 60_000;

let seeded = false;
function seed(db) {
  if (seeded) return;
  seeded = true;
  db.cleaning = [
    { id: "c1", room: "201", type: "regular", status: "done", assignee: "s-joel", role: "lead", clockIn: m(160), clockOut: m(133), createdAt: m(170) },
    { id: "c2", room: "202", type: "checkout", status: "done", assignee: "s-liza", role: "lead", schedDate: day(0), clockIn: m(150), clockOut: m(105), createdAt: m(1500) },
    { id: "c3", room: "301", type: "deep_clean", status: "in_progress", assignee: "s-joel", role: "lead", schedDate: day(0), clockIn: m(34), createdAt: m(1500) },
    { id: "c4", room: "305", type: "checkout", status: "ready", assignee: "s-liza", role: "backup", schedDate: day(0), createdAt: m(1500) },
    { id: "c5", room: "507", type: "checkout", status: "ready", schedDate: day(0), createdAt: m(1500) },
    { id: "c6", room: "611", type: "touch_up", status: "queued", role: "lead", createdAt: m(20) },
    { id: "c7", room: "408", type: "checkout", status: "scheduled", role: "lead", schedDate: day(1), createdAt: m(60) },
    { id: "c8", room: "903", type: "Deep clean", status: "scheduled", role: "lead", schedDate: day(1), createdAt: m(60) }, // a row from before wave 2: its label as written
  ];
}

const no = (msg) => ({ ok: false, error: msg });
const dateMs = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? Date.parse(`${d}T00:00:00+08:00`) : null);
const hk = (x, id) => x.staff.some((p) => p.id === id && p.dept === "housekeeping");
const find = (x, id) => x.db.cleaning.find((t) => t.id === id);

export default {
  id: "cleaning",
  commandModule: { logClean: "cleaning", scheduleClean: "cleaning", clockIn: "cleaning", clockOut: "cleaning", editClean: "cleaning" },
  commands: {
    logClean(c, x) {
      seed(x.db);
      if (!String(c.room ?? "").trim()) return no("Room required");
      if (c.attendantId && !hk(x, c.attendantId)) return no("Choose a room attendant from Housekeeping.");
      if (c.clockIn && !c.attendantId) return no("Choose the room attendant who clocks in.");
      x.db.cleaning.push({ id: c.taskId, room: c.room.trim(), type: c.cleanType, status: c.clockIn ? "in_progress" : "queued", assignee: c.attendantId, role: c.role, clockIn: c.clockIn ? x.t : undefined, createdAt: x.t });
    },
    scheduleClean(c, x) {
      seed(x.db);
      if (dateMs(c.date) == null) return no("Date required");
      if (!c.rooms?.length) return no("Add rooms");
      c.rooms.forEach((room, i) => x.db.cleaning.push({ id: c.taskIds[i], room, type: c.cleanType, status: "scheduled", role: "lead", schedDate: dateMs(c.date), createdAt: x.t }));
    },
    clockIn(c, x) {
      const t = find(x, c.taskId);
      if (!t) return no("Unknown cleaning task");
      if (!["ready", "queued"].includes(t.status)) return no(`Not possible while the room is ${t.status.replace("_", " ")}`);
      const who = c.attendantId ?? t.assignee;
      if (!who) return no("Choose the room attendant who clocks in.");
      Object.assign(t, { status: "in_progress", assignee: who, clockIn: x.t, clockOut: undefined }, c.role ? { role: c.role } : {});
    },
    clockOut(c, x) {
      const t = find(x, c.taskId);
      if (!t) return no("Unknown cleaning task");
      if (t.status !== "in_progress") return no(`Not possible while the room is ${t.status.replace("_", " ")}`);
      Object.assign(t, { status: "done", clockIn: t.clockIn ?? x.t, clockOut: x.t });
    },
    editClean(c, x) {
      const t = find(x, c.taskId);
      if (!t) return no("Unknown cleaning task");
      if (c.room) t.room = c.room;
      if (c.cleanType) t.type = c.cleanType;
      if (c.attendantId) t.assignee = c.attendantId;
      if (c.clearAttendant) delete t.assignee;
      if (c.role) t.role = c.role;
      if (c.schedDate) t.schedDate = dateMs(c.schedDate);
    },
  },
  snapshot: (x) => {
    seed(x.db);
    return {};
  },
};
