import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, resetApp, setUI } from "../../domain/store";
import type { State } from "../../domain/types";
import { TransportScreen } from "./TransportScreen";
import transport from "./index";
import { arriveTrip, cancelTrip, checkTrip, clean, departTrip, editTrip, isDriver, logTrip, scheduleTrip, sortTrips, tripsOf, visible, type Trip, type TripInput, type Vehicle } from "./model";

const VEH: Vehicle[] = [{ key: "van_1", label: "Van 1", active: true }, { key: "old", label: "Old van", active: false }];
const trip = (o: Partial<Trip>): Trip => ({ id: "t1", no: "TR-0001", vehicleKey: "van_1", vehicle: "Van 1", driver: "Danny", dest: "Caticlan Airport", purpose: "Guest pickup", passengers: "Mr. & Mrs. Lee", status: "arrived", createdAt: 1, ...o });
const withTrips = (trips: Trip[]) => app.set((s): State => ({ ...s, me: "s-maria", modules: { ...s.modules, transport: { trips, vehicles: VEH } } }));
const input = (o: Partial<TripInput> = {}): TripInput => ({ vehicle: "van_1", driver: "Joel Dizon", dest: "Airport", purpose: "", passengers: "", date: "2026-10-31", time: "14:00", ...o });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

afterEach(() => { resetApp(); setUI({ account: { name: "", role: "owner", hotel: "", logoUrl: "" } }); });

describe("module", () => {
  it("has no sidebar badge, like the prototype", () => expect(transport.badge).toBeUndefined());
});

describe("order and filters", () => {
  it("on the road first, then scheduled soonest first, then finished latest first", () => {
    const sorted = sortTrips([
      trip({ id: "a", no: "TR-0001", status: "arrived", arrAt: 10 }),
      trip({ id: "b", no: "TR-0002", status: "scheduled", schedAt: 500 }),
      trip({ id: "c", no: "TR-0003", status: "en_route", depAt: 100 }),
      trip({ id: "d", no: "TR-0004", status: "scheduled", schedAt: 300 }),
      trip({ id: "e", no: "TR-0005", status: "cancelled", createdAt: 50 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["c", "d", "b", "e", "a"]);
  });
  it("filters by status", () => {
    const all = [trip({ id: "a" }), trip({ id: "b", status: "en_route" })];
    expect(visible(all, "en_route").map((t) => t.id)).toEqual(["b"]);
    expect(visible(all, "all")).toHaveLength(2);
  });
  it("a driver is the staff member whose name is the trip's driver", () => {
    expect(isDriver(trip({ driver: "joel dizon " }), "Joel Dizon")).toBe(true);
    expect(isDriver(trip({ driver: "Danny" }), "Joel Dizon")).toBe(false);
    expect(isDriver(trip({ driver: "" }), undefined)).toBe(false);
  });
});

describe("checks", () => {
  it("needs a destination and an active vehicle; a schedule needs a real date and time", () => {
    expect(checkTrip(input({ dest: " " }), false, VEH).dest).toBe("Destination required");
    expect(checkTrip(input({ vehicle: "" }), false, VEH).vehicle).toBe("Choose a vehicle.");
    expect(checkTrip(input({ vehicle: "old" }), false, VEH).vehicle).toBe("Choose a vehicle.");
    expect(clean(checkTrip(input({ vehicle: "old" }), false, VEH, "old"))).toBe(true); // an edit keeps its removed vehicle
    expect(checkTrip(input({ date: "" }), true, VEH).when).toBe("Choose a date and a time.");
    expect(checkTrip(input({ dest: "x".repeat(161) }), false, VEH).dest).toMatch(/under 160/);
    expect(clean(checkTrip(input(), true, VEH))).toBe(true);
  });
});

describe("optimistic commands", () => {
  it("log, schedule, depart, arrive, edit and cancel change the slice at once", () => {
    withTrips([]);
    logTrip(input({ date: undefined }));
    scheduleTrip(input({ dest: "D'Mall" }));
    let [sched, out] = tripsOf(app.get());
    expect(out).toMatchObject({ status: "en_route", vehicle: "Van 1", dest: "Airport", no: "" });
    expect(out.depAt).toBeTypeOf("number");
    expect(sched).toMatchObject({ status: "scheduled", dest: "D'Mall", schedAt: Date.UTC(2026, 9, 31, 6, 0) });
    arriveTrip(out.id);
    departTrip(sched.id);
    editTrip(sched.id, input({ dest: "Burnham Park", time: "15:30" }));
    [sched, out] = tripsOf(app.get());
    expect(out.status).toBe("arrived");
    expect(out.arrAt).toBeTypeOf("number");
    expect(sched).toMatchObject({ status: "en_route", dest: "Burnham Park", schedAt: Date.UTC(2026, 9, 31, 6, 0) }); // en route: the due time stays
    cancelTrip(sched.id);
    expect(tripsOf(app.get())[0].status).toBe("cancelled");
  });
});

describe("screen", () => {
  it("lists the trips with the filter counts and the action each status needs", () => {
    withTrips([trip({ id: "a" }), trip({ id: "b", no: "TR-0002", status: "en_route", depAt: Date.now() - 600000 }), trip({ id: "c", no: "TR-0003", status: "scheduled", schedAt: Date.now() + 3600000 })]);
    const html = renderToStaticMarkup(<TransportScreen />);
    const t = text(html);
    for (const x of ["Transport Log", "Log Trip", "Schedule Trip", "All 3", "Scheduled 1", "En Route 1", "Arrived 1", "TR-0002", "Caticlan Airport", "Mr. &amp; Mrs. Lee"]) expect(t).toContain(x);
    expect(html).toContain('aria-label="Mark arrived TR-0002"');
    expect(html).toContain('aria-label="Depart TR-0003"');
    expect(html).not.toContain('aria-label="Depart TR-0001"');
  });
  it("says what it is for when empty", () => {
    const t = text(renderToStaticMarkup(<TransportScreen />));
    expect(t).toContain("No trips yet");
  });
  it("a driver's phone shows only the buttons of their own trips and no way to log or schedule", () => {
    setUI({ account: { name: "Phone", role: "device", hotel: "", logoUrl: "" } });
    app.set((s) => ({ ...s, me: "s-joel" }));
    withTrips([trip({ id: "a", no: "TR-0001", status: "scheduled", driver: "Joel Dizon", schedAt: 1 }), trip({ id: "b", no: "TR-0002", status: "scheduled", driver: "Danny", schedAt: 2 })]);
    app.set((s) => ({ ...s, me: "s-joel" }));
    const html = renderToStaticMarkup(<TransportScreen />);
    expect(html).toContain('aria-label="Depart TR-0001"');
    expect(html).not.toContain('aria-label="Depart TR-0002"');
    expect(html).not.toContain("Log Trip");
    expect(text(html)).toContain("where you are the driver");
  });
});
