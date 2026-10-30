// House Status sample server extension (see README.md here). Mirrors azalea-ehelpdesk/includes/Modules/HouseStatus.php.
import { randomUUID } from "node:crypto";

const min = 60_000, hour = 3_600_000;
let logs = null; // newest first, like the server's slice
let n = 4;

function seed() {
  const t = Date.now();
  const hdo = "s-maria";
  logs = [
    { id: randomUUID(), no: "HS-0003", narration: "Generator test scheduled for 2 PM, lights may flicker for a few minutes.", status: "monitoring", loggedBy: hdo, createdAt: t - 40 * min, updates: [{ at: t - 15 * min, by: "s-ramon", text: "Engineering is on site and running the test." }] },
    { id: randomUUID(), no: "HS-0002", narration: "Lobby lift 2 out of service", status: "pending", loggedBy: hdo, createdAt: t - 3 * hour, updates: [{ at: t - 2 * hour, by: "s-ramon", text: "Technician called, arriving after lunch." }] },
    { id: randomUUID(), no: "HS-0001", narration: "Water pressure low on the 3rd floor since 8 AM", status: "closed", loggedBy: hdo, createdAt: t - 26 * hour, closedAt: t - 22 * hour, updates: [{ at: t - 25 * hour, by: "s-ramon", text: "Engineering checking the pump." }, { at: t - 24 * hour, by: hdo, text: "Pump reset, monitoring." }, { at: t - 22 * hour, by: hdo, text: "Closed: Pressure back to normal" }] },
  ];
}
const find = (id) => logs.find((l) => l.id === id);
const text = (v, what, max = 2000) => (typeof v === "string" && v.trim() ? (v.trim().length > max ? `Keep the ${what} under ${max} characters.` : null) : `${what === "narration" ? "Incident narration" : "Update"} is required.`);

export default {
  id: "housestatus",
  commandModule: { logHouse: "housestatus", updateHouse: "housestatus", closeHouse: "housestatus", reopenHouse: "housestatus", editHouse: "housestatus" },
  commands: {
    logHouse: (c, x) => {
      if (!logs) seed();
      if (!["monitoring", "pending"].includes(c.status)) return { ok: false, error: "Choose Monitoring or Pending." };
      const bad = text(c.narration, "narration");
      if (bad) return { ok: false, error: bad };
      logs.unshift({ id: c.houseId, no: `HS-${String(n++).padStart(4, "0")}`, narration: c.narration.trim(), status: c.status, loggedBy: x.by ?? "", createdAt: x.t, updates: [] });
    },
    updateHouse: (c, x) => {
      const l = find(c.houseId);
      if (!l) return { ok: false, error: "Unknown log" };
      const bad = text(c.text, "update");
      if (bad) return { ok: false, error: bad };
      if (l.status === "closed") return { ok: false, error: "This log is closed. Reopen it to add an update." };
      l.updates.push({ at: x.t, by: x.by ?? "system", text: c.text.trim() });
    },
    closeHouse: (c, x) => {
      const l = find(c.houseId);
      if (!l) return { ok: false, error: "Unknown log" };
      if (l.status === "closed") return { ok: false, error: "This log is already closed." };
      const note = typeof c.note === "string" ? c.note.trim() : "";
      Object.assign(l, { status: "closed", closedAt: x.t });
      l.updates.push({ at: x.t, by: x.by ?? "system", text: note ? `Closed: ${note}` : "Closed" });
    },
    reopenHouse: (c, x) => {
      const l = find(c.houseId);
      if (!l) return { ok: false, error: "Unknown log" };
      if (l.status !== "closed") return { ok: false, error: "This log is not closed." };
      l.status = "monitoring";
      delete l.closedAt;
      l.updates.push({ at: x.t, by: x.by ?? "system", text: "Reopened" });
    },
    editHouse: (c, x) => {
      const l = find(c.houseId);
      if (!l) return { ok: false, error: "Unknown log" };
      if (!["monitoring", "pending", "closed"].includes(c.status)) return { ok: false, error: "Choose Monitoring, Pending or Closed." };
      const bad = text(c.narration, "narration");
      if (bad) return { ok: false, error: bad };
      const what = [l.narration !== c.narration.trim() && "narration changed", l.status !== c.status && `status ${l.status} to ${c.status}`].filter(Boolean);
      if (!what.length) return { ok: false, error: "Nothing was changed." };
      if (c.status === "closed") l.closedAt ??= x.t; else delete l.closedAt;
      Object.assign(l, { narration: c.narration.trim(), status: c.status });
      l.updates.push({ at: x.t, by: x.by ?? "system", text: `Edited: ${what.join(", ")}` });
    },
  },
  snapshot: (x) => {
    if (!logs) seed();
    return { logs, open: logs.filter((l) => l.status !== "closed").length };
  },
};
