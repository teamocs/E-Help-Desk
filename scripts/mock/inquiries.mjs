// Sample server extension for Inquiries: realistic data and the four commands, answering like Azl_Module_Inquiries.
const min = 60_000, hour = 3_600_000, day = 24 * hour;
const WORD = { logInquiry: "Logged", noteInquiry: "Noted", closeInquiry: "Closed", reopenInquiry: "Reopened" };

/** Two more help-desk officers than the base fixture has, so the HDO list and the names look real. */
function officers(staff) {
  for (const [id, name, initials] of [["s-rizza", "Rizza Santos", "RS"], ["s-frankie", "Frankie Dela Cruz", "FD"]]) {
    if (!staff.some((p) => p.id === id)) staff.push({ id, name, initials, role: "hdo", title: "Desk Officer", dept: "frontdesk", onShift: true });
  }
}

function seed(db) {
  if (db.inquiries) return;
  const now = Date.now();
  const row = (n, name, type, room, desc, hdo, status, ago, extra = {}) => ({ id: `inq-${n}`, no: `I-${String(n).padStart(4, "0")}`, name, type, room, desc, hdo, status, createdAt: now - ago, history: [{ at: now - ago, by: hdo, what: "Logged" }], ...extra });
  db.inquiries = [
    row(1, "Mr. Santos", "in_house", "412", "Asked for a late checkout at 2 p.m. on Saturday. Has a flight at 6.", "s-maria", "active", 40 * min),
    row(2, "Maria Cruz", "external", undefined, "Reservation Dec 20-23: wants a quote for two rooms with breakfast, and whether the pool is open.", "s-rizza", "active", 95 * min),
    row(3, "James Lee", "checked_out", "301", "Left a phone charger in the room. Asks us to keep it until his driver collects it.", "s-maria", "noted", 3 * hour, { history: [{ at: now - 3 * hour, by: "s-maria", what: "Logged" }, { at: now - 2 * hour, by: "s-maria", what: "Noted" }] }),
    row(4, "Room 412", "in_house", "412", "WiFi password", "s-frankie", "done", 5 * hour, { closedAt: now - 5 * hour + 3 * min, quick: true, history: [{ at: now - 5 * hour, by: "s-frankie", what: "Logged" }, { at: now - 5 * hour + 3 * min, by: "s-frankie", what: "Closed" }] }),
    row(5, "Anna Reyes", "external", undefined, "Wedding venue: asked about the garden for 80 guests in March.", "s-rizza", "done", 26 * hour, { closedAt: now - 26 * hour + 5 * min, quick: true, history: [{ at: now - 26 * hour, by: "s-rizza", what: "Logged" }, { at: now - 26 * hour + 5 * min, by: "s-rizza", what: "Closed" }] }),
    row(6, "Mrs. Tan", "in_house", "208", "Wanted the spa menu and a booking for Sunday morning.", "s-maria", "done", 30 * hour, { closedAt: now - 30 * hour + 22 * min, quick: false, history: [{ at: now - 30 * hour, by: "s-maria", what: "Logged" }, { at: now - 30 * hour + 22 * min, by: "s-maria", what: "Closed" }] }),
  ];
  db.inqSeq = 6;
}

export default {
  id: "inquiries",
  commandModule: { logInquiry: "inquiries", noteInquiry: "inquiries", closeInquiry: "inquiries", reopenInquiry: "inquiries" },
  commands: {
    logInquiry: (c, x) => {
      seed(x.db);
      if (!["in_house", "external", "checked_out"].includes(c.contactType)) return { ok: false, error: "Choose who is asking: in-house guest, external or checked-out guest" };
      if (!String(c.name ?? "").trim()) return { ok: false, error: "Enter the name of who is asking" };
      if (!String(c.desc ?? "").trim()) return { ok: false, error: "Describe the inquiry" };
      if (x.db.inquiries.some((i) => i.id === c.inquiryId)) return { ok: false, error: "This inquiry was already logged" };
      const n = ++x.db.inqSeq;
      x.db.inquiries.unshift({ id: c.inquiryId, no: `I-${String(n).padStart(4, "0")}`, name: String(c.name).trim(), type: c.contactType, room: c.room || undefined, desc: String(c.desc).trim(), hdo: c.hdo ?? x.by, status: "active", createdAt: x.t, history: [{ at: x.t, by: x.by, what: "Logged" }] });
    },
    ...Object.fromEntries([["noteInquiry", ["active"], "noted", "Already noted or closed"], ["closeInquiry", ["active", "noted"], "done", "Already closed"], ["reopenInquiry", ["noted", "done"], "active", "Already open"]].map(([type, from, to, why]) => [type, (c, x) => {
      seed(x.db);
      const i = x.db.inquiries.find((r) => r.id === c.inquiryId);
      if (!i) return { ok: false, error: "Unknown inquiry" };
      if (!from.includes(i.status)) return { ok: false, error: why };
      Object.assign(i, { status: to, closedAt: to === "done" ? x.t : undefined, quick: to === "done" ? x.t - i.createdAt <= 6 * min : false });
      i.history.push({ at: x.t, by: x.by, what: WORD[type] });
    }])),
  },
  snapshot: (x) => {
    seed(x.db);
    officers(x.staff);
    const list = x.db.inquiries.filter((i) => i.status !== "done" || (i.closedAt ?? i.createdAt) > Date.now() - 14 * day);
    return { list, counts: { active: list.filter((i) => i.status === "active").length, noted: list.filter((i) => i.status === "noted").length } };
  },
};
