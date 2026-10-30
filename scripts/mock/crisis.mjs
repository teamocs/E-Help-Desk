// Crisis Mgmt for the mock desk (scripts/mock-wp.mjs): sample cases (active, monitored, closed, one linked to the
// sample safety alert INC-001) and the case commands, with the same refusals as includes/Modules/Crisis.php where
// it matters to the screens. Not the authority: the role check (close needs full access) is the mock's matrix.
const min = 60_000, hour = 60 * min, day = 24 * hour;
const now = Date.now();
const up = (text, ago, by = "s-maria") => ({ at: now - ago, by, text });
let cases = null;
const seed = () => [
  { id: "c0000000-0000-4000-8000-000000000004", no: "CR-0004", code: "guest_complaint", category: "noise", reportedBy: "FO Staff 2", whoType: "in_house_guest", who: "Ms. Tan", location: "room", place: "405", what: "Noise from the next room after 11 PM", occurredAt: now - 20 * min, status: "active", incidentId: null, called911: null, loggedBy: "s-maria", createdAt: now - 18 * min, updates: [up("Security asked the next room to keep it down", 10 * min)] },
  { id: "c0000000-0000-4000-8000-000000000003", no: "CR-0003", code: "power_outage", category: null, reportedBy: "Engineering", whoType: null, who: null, location: "back_office", place: null, what: null, occurredAt: now - 2 * hour, status: "monitoring", incidentId: null, called911: null, loggedBy: "s-ramon", createdAt: now - 2 * hour, updates: [up("Monitoring: generator running, utility says 3 hours", 100 * min, "s-ramon")] },
  { id: "c0000000-0000-4000-8000-000000000002", no: "CR-0002", code: "other", category: null, reportedBy: "Room 220", whoType: "in_house_guest", who: null, location: "room", place: "220", what: "Flooding: “Water under the door”", occurredAt: now - 50 * min, status: "resolved", resolution: "Burst hose under the sink replaced, room dried", resolvedAt: now - 15 * min, incidentId: "x1", called911: null, loggedBy: "s-maria", createdAt: now - 49 * min, updates: [up("Opened from safety alert INC-001", 49 * min), up("Closed: Burst hose under the sink replaced, room dried", 15 * min, "s-liza")] },
  { id: "c0000000-0000-4000-8000-000000000001", no: "CR-0001", code: "medical_emergency", category: null, reportedBy: "FO Staff 1", whoType: "in_house_guest", who: "Mr. Park", location: "lobby", place: null, what: "Guest fainted in the lobby", occurredAt: now - 3 * day, status: "resolved", resolution: "Guest released from hospital", resolvedAt: now - 2 * day, incidentId: null, called911: { by: "s-maria", at: new Date(now - 3 * day + 3 * min).toISOString() }, loggedBy: "s-maria", createdAt: now - 3 * day, updates: [up("BFP/911 called", 3 * day - 3 * min), up("Ambulance called", 3 * day - 5 * min), up("Closed: Guest released from hospital", 2 * day, "s-liza")] },
];
const all = () => (cases ??= seed());
const find = (id) => all().find((c) => c.id === id);
const fail = (error) => ({ ok: false, error });
const text = (v) => (typeof v === "string" ? v.trim() : "");
const FIELDS = ["code", "category", "reportedBy", "whoType", "who", "location", "place", "what"];
const pick = (c) => Object.fromEntries(FIELDS.map((k) => [k, text(c[k]) || null]));
const note = (k, x, t) => k.updates.push({ at: x.t, by: x.by, text: t });

export default {
  id: "crisis",
  commandModule: Object.fromEntries(["logCrisis", "updateCrisis", "monitorCrisis", "closeCrisis", "reopenCrisis", "editCrisis", "linkCrisisIncident", "recordCrisis911"].map((t) => [t, "crisis"])),
  commands: {
    logCrisis: (c, x) => {
      const f = pick(c), inc = c.incidentId ? x.db.incidents.find((i) => i.id === c.incidentId) : null;
      if (c.incidentId && !inc) return fail("Unknown safety alert");
      if (!f.code && !f.category && !inc) return fail("Choose a radio code or a complaint category");
      if (find(c.caseId)) return fail("This case already exists");
      const n = all().reduce((m, k) => Math.max(m, Number(k.no.slice(3))), 0) + 1;
      all().unshift({ id: c.caseId, no: `CR-${String(n).padStart(4, "0")}`, ...f, occurredAt: c.occurredAt ? Date.parse(c.occurredAt) : x.t, status: "active", resolution: null, resolvedAt: null, incidentId: inc?.id ?? null, called911: null, loggedBy: x.by, createdAt: x.t, updates: inc ? [{ at: x.t, by: x.by, text: `Opened from safety alert ${inc.no}` }] : [] });
    },
    updateCrisis: (c, x) => { const k = find(c.caseId); if (!k) return fail("Unknown case"); if (k.status === "resolved") return fail("This case is closed. Reopen it first."); if (!text(c.text)) return fail("Write the update"); note(k, x, text(c.text)); },
    monitorCrisis: (c, x) => { const k = find(c.caseId); if (!k) return fail("Unknown case"); if (k.status !== "active") return fail("This case is already being monitored"); if (!text(c.text)) return fail("Write the monitoring note"); k.status = "monitoring"; note(k, x, `Monitoring: ${text(c.text)}`); },
    closeCrisis: (c, x) => { const k = find(c.caseId); if (!k) return fail("Unknown case"); if (k.status === "resolved") return fail("This case is closed. Reopen it first."); if (!text(c.resolution)) return fail("Write the resolution"); Object.assign(k, { status: "resolved", resolution: text(c.resolution), resolvedAt: x.t }); note(k, x, `Closed: ${k.resolution}`); },
    reopenCrisis: (c, x) => { const k = find(c.caseId); if (!k) return fail("Unknown case"); if (k.status !== "resolved") return fail("This case is still open"); Object.assign(k, { status: "monitoring", resolution: null, resolvedAt: null }); note(k, x, "Reopened"); },
    editCrisis: (c, x) => {
      const k = find(c.caseId); if (!k) return fail("Unknown case");
      const f = pick(c);
      if (!f.code && !f.category && !k.incidentId) return fail("Choose a radio code or a complaint category");
      const changed = FIELDS.filter((n) => f[n] !== k[n]);
      const at = c.occurredAt ? Date.parse(c.occurredAt) : k.occurredAt;
      if (!changed.length && at === k.occurredAt) return fail("Nothing changed");
      Object.assign(k, f, { occurredAt: at });
      note(k, x, `Edited. ${changed.join(", ") || "time"} changed`);
    },
    linkCrisisIncident: (c, x) => { const k = find(c.caseId), inc = x.db.incidents.find((i) => i.id === c.incidentId); if (!k) return fail("Unknown case"); if (!inc) return fail("Unknown safety alert"); if (k.incidentId) return fail("This case is already linked to another alert"); k.incidentId = inc.id; note(k, x, `Linked to safety alert ${inc.no}`); },
    recordCrisis911: (c, x) => { const k = find(c.caseId); if (!k) return fail("Unknown case"); if (k.incidentId) return fail("Record the 911 call on the linked alert"); if (k.called911) return fail("The 911 call is already recorded for this case"); k.called911 = { by: x.by, at: c.at }; note(k, x, "BFP/911 called"); },
  },
  snapshot: (x) => {
    const name = (id) => x.staff.find((s) => s.id === id)?.name ?? "a manager";
    const list = all().filter((k) => k.status !== "resolved" || k.resolvedAt > Date.now() - 30 * day);
    const counts = { active: 0, monitoring: 0, resolved: 0 };
    list.forEach((k) => counts[k.status]++);
    return {
      cases: list.map((k) => {
        const inc = k.incidentId ? x.db.incidents.find((i) => i.id === k.incidentId) : null;
        return {
          ...k, loggedBy: name(k.loggedBy), called911: k.called911 ? { by: name(k.called911.by), at: k.called911.at } : null,
          incident: inc ? { id: inc.id, no: inc.no, hazard: inc.hazard, rooms: inc.rooms, status: inc.status, createdAt: inc.createdAt, called911: inc.called911 ?? null } : null,
          updates: k.updates.map((u) => ({ ...u, by: name(u.by) })),
        };
      }),
      counts: { ...counts, unresolved: counts.active + counts.monitoring },
    };
  },
};
