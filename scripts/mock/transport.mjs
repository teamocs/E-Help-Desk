// Transport sample server extension (see README.md here). Mirrors azalea-ehelpdesk/includes/Modules/Transport.php.
import { randomUUID } from "node:crypto";

const min = 60_000, hour = 3_600_000;
const VEHICLES = [{ key: "van_1", label: "Van 1", active: true }, { key: "van_2", label: "Van 2", active: true }, { key: "shuttle", label: "Shuttle", active: true }];
let trips = null;
let n = 6;
const OFFSET = 8 * hour; // Asia/Manila

/** The hotel-local date and time ("2026-10-31", "14:00") as one moment, or null when not a real one. */
function hotelMoment(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? ""), t = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!m || !t) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) - OFFSET;
  const back = new Date(ms + OFFSET).toISOString();
  return back.startsWith(`${date}T${time}`) ? ms : null;
}

function seed() {
  const t = Date.now();
  const trip = (no, vehicle, driver, dest, purpose, passengers, status, extra) => ({ id: randomUUID(), no, vehicleKey: VEHICLES.find((v) => v.label === vehicle).key, vehicle, driver, dest, purpose, passengers, status, createdAt: t - 4 * hour, ...extra });
  trips = [
    trip("TR-0005", "Van 1", "Joel Dizon", "Baguio Cathedral", "Guest tour", "The Santos family (4)", "scheduled", { schedAt: t + 26 * hour }),
    trip("TR-0004", "Shuttle", "Danny", "Loakan Airport", "VIP pickup", "Ms. Tan, VIP", "scheduled", { schedAt: t + 90 * min }),
    trip("TR-0003", "Van 2", "Jun", "SM Baguio", "Guest transfer", "Room 412", "en_route", { depAt: t - 25 * min }),
    trip("TR-0002", "Van 1", "Danny", "Burnham Park", "Guest tour", "Mr. & Mrs. Lee", "arrived", { depAt: t - 5 * hour, arrAt: t - 4 * hour }),
    trip("TR-0001", "Van 2", "Jun", "Loakan Airport", "Guest pickup", "Room 305", "arrived", { depAt: t - 9 * hour, arrAt: t - 8 * hour }),
  ];
}
const find = (id) => trips.find((x) => x.id === id);
const fields = (c) => {
  const v = VEHICLES.find((x) => x.key === c.vehicle && x.active);
  const f = Object.fromEntries(["driver", "dest", "purpose", "passengers"].map((k) => [k, typeof c[k] === "string" ? c[k].trim() : ""]));
  if (!f.dest) return "Destination required";
  if (!v) return "Choose a vehicle.";
  return { ...f, vehicleKey: v.key, vehicle: v.label };
};
const create = (c, x, status, extra) => {
  if (!trips) seed();
  const f = fields(c);
  if (typeof f === "string") return { ok: false, error: f };
  trips.unshift({ id: c.tripId, no: `TR-${String(n++).padStart(4, "0")}`, ...f, status, createdAt: x.t, ...extra });
};
const step = (c, from, to, col, wrong, x) => {
  const t = find(c.tripId);
  if (!t) return { ok: false, error: "Unknown trip" };
  if (t.status !== from) return { ok: false, error: wrong[t.status] };
  Object.assign(t, { status: to, [col]: x.t });
};

export default {
  id: "transport",
  commandModule: Object.fromEntries(["logTrip", "scheduleTrip", "editTrip", "departTrip", "arriveTrip", "cancelTrip"].map((k) => [k, "transport"])),
  commands: {
    logTrip: (c, x) => create(c, x, "en_route", { depAt: x.t }),
    scheduleTrip: (c, x) => {
      const at = hotelMoment(c.date, c.time);
      if (at === null) return { ok: false, error: "Choose a date and a time." };
      return create(c, x, "scheduled", { schedAt: at });
    },
    departTrip: (c, x) => step(c, "scheduled", "en_route", "depAt", { en_route: "This trip has already left.", arrived: "This trip has already arrived.", cancelled: "This trip was cancelled." }, x),
    arriveTrip: (c, x) => step(c, "en_route", "arrived", "arrAt", { scheduled: "This trip has not left yet. Depart it first.", arrived: "This trip has already arrived.", cancelled: "This trip was cancelled." }, x),
    cancelTrip: (c) => {
      const t = find(c.tripId);
      if (!t) return { ok: false, error: "Unknown trip" };
      if (t.status !== "scheduled") return { ok: false, error: "Only a scheduled trip can be cancelled." };
      t.status = "cancelled";
    },
    editTrip: (c) => {
      const t = find(c.tripId);
      if (!t) return { ok: false, error: "Unknown trip" };
      if (!["scheduled", "en_route"].includes(t.status)) return { ok: false, error: "A trip that has arrived or was cancelled cannot be changed." };
      const f = c.vehicle === t.vehicleKey ? { ...fields({ ...c, vehicle: VEHICLES[0].key }), vehicleKey: t.vehicleKey, vehicle: t.vehicle } : fields(c);
      if (typeof f === "string") return { ok: false, error: f };
      Object.assign(t, f);
      if (t.status === "scheduled") {
        const at = hotelMoment(c.date, c.time);
        if (at === null) return { ok: false, error: "Choose a date and a time." };
        t.schedAt = at;
      }
    },
  },
  snapshot: () => {
    if (!trips) seed();
    return { trips, vehicles: VEHICLES };
  },
};
