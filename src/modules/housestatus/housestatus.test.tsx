import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, initialState, resetApp, setUI } from "../../domain/store";
import type { State } from "../../domain/types";
import { HouseStatusScreen } from "./HouseStatusScreen";
import housestatus from "./index";
import { badge, checkClose, checkLog, checkUpdate, clean, closeHouse, editHouse, logHouse, logsOf, reopenHouse, updateHouse, visible, withEdit, type HsLog } from "./model";
import { addDays, clock, dayName, hotelDate, hotelMoment, hotelTime, stamp, when } from "./time";

const log = (o: Partial<HsLog>): HsLog => ({ id: "l1", no: "HS-0001", narration: "Water pressure low", status: "monitoring", loggedBy: "s-maria", createdAt: Date.UTC(2026, 9, 30, 0, 0), updates: [], ...o });
const withLogs = (logs: HsLog[]) => app.set((s): State => ({ ...s, me: "s-maria", modules: { ...s.modules, housestatus: { logs } } }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

afterEach(() => { resetApp(); setUI({ account: { name: "", role: "owner", hotel: "", logoUrl: "" } }); });

describe("badge and filters", () => {
  it("the badge counts logs not closed, 0 with no data", () => {
    expect(badge(initialState())).toBe(0);
    withLogs([log({}), log({ id: "l2", status: "pending" }), log({ id: "l3", status: "closed" })]);
    expect(badge(app.get())).toBe(2);
    expect(housestatus.badge?.(app.get())).toBe(2);
  });
  it("filters by closed or not", () => {
    const all = [log({}), log({ id: "l2", status: "closed" })];
    expect(visible(all, "all")).toHaveLength(2);
    expect(visible(all, "open").map((l) => l.id)).toEqual(["l1"]);
    expect(visible(all, "closed").map((l) => l.id)).toEqual(["l2"]);
  });
});

describe("checks", () => {
  it("narration and update are required, and capped", () => {
    expect(checkLog({ narration: "  " }).narration).toBe("Incident narration is required.");
    expect(checkUpdate({ text: "" }).text).toBe("Update is required.");
    expect(clean(checkLog({ narration: "Lift out" }))).toBe(true);
    expect(checkLog({ narration: "x".repeat(2001) }).narration).toMatch(/under 2000/);
    expect(clean(checkClose({ note: "" }))).toBe(true);
    expect(checkClose({ note: "x".repeat(1999) }).note).toMatch(/under 1998/);
  });
});

describe("optimistic commands", () => {
  it("log, update, close, reopen and edit change the slice at once, like the server will", () => {
    app.set((s) => ({ ...s, me: "s-maria" }));
    logHouse({ narration: "  Lobby lift out  ", status: "pending" });
    let l = logsOf(app.get())[0];
    expect(l).toMatchObject({ no: "", narration: "Lobby lift out", status: "pending", loggedBy: "s-maria", updates: [] });
    updateHouse(l.id, "Technician called");
    closeHouse(l.id, "Fixed");
    l = logsOf(app.get())[0];
    expect(l.status).toBe("closed");
    expect(l.closedAt).toBeTypeOf("number");
    expect(l.updates.map((u) => u.text)).toEqual(["Technician called", "Closed: Fixed"]);
    reopenHouse(l.id);
    l = logsOf(app.get())[0];
    expect(l.status).toBe("monitoring");
    expect(l.closedAt).toBeUndefined();
    editHouse(l.id, { narration: "Lobby lift 2 out", status: "closed" });
    l = logsOf(app.get())[0];
    expect(l).toMatchObject({ narration: "Lobby lift 2 out", status: "closed" });
    expect(l.updates.at(-1)?.text).toBe("Edited: narration changed, status monitoring to closed");
    expect(badge(app.get())).toBe(0);
  });
  it("an edit that changes nothing adds no line", () => {
    const s = withEdit("l1", { narration: "Water pressure low", status: "monitoring" }, 5, "s-maria")({ logs: [log({})] });
    expect(s.logs[0].updates).toEqual([]);
  });
});

describe("the hotel's clock", () => {
  it("'today' is the Manila date, never the UTC date", () => {
    const ms = Date.UTC(2026, 9, 29, 20, 30); // 04:30 on Oct 30 in Manila, still Oct 29 in UTC
    expect(hotelDate(ms)).toBe("2026-10-30");
    expect(hotelTime(ms)).toBe("04:30");
    expect(dayName(ms, ms)).toBe("Today");
    expect(dayName(ms + 86400_000, ms)).toBe("Tomorrow");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(clock(Date.UTC(2026, 9, 30, 2, 0))).toBe("10:00 AM");
    expect(when(ms, ms)).toBe("04:30 AM");
    expect(stamp(ms)).toBe("Oct 30, 04:30 AM");
  });
  it("turns a local date and time into one moment and refuses what is not real", () => {
    expect(hotelMoment("2026-10-31", "14:00")).toBe(Date.UTC(2026, 9, 31, 6, 0));
    expect(hotelMoment("2026-02-30", "14:00")).toBeNull();
    expect(hotelMoment("2026-10-31", "25:00")).toBeNull();
    expect(hotelMoment("", "")).toBeNull();
  });
});

describe("screen", () => {
  it("shows the cards with number, status, narration, who, the updates and the buttons by status", () => {
    withLogs([
      log({ id: "a", no: "HS-0002", status: "pending", narration: "Lobby lift 2 out of service" }),
      log({ id: "b", status: "closed", closedAt: 1, updates: [{ at: Date.UTC(2026, 9, 30, 1, 0), by: "s-maria", text: "Pump reset, monitoring" }] }),
    ]);
    const html = renderToStaticMarkup(<HouseStatusScreen />);
    const t = text(html);
    for (const x of ["House Status", "Incident logs", "HS-0002", "Pending", "Lobby lift 2 out of service", "By Maria Santos", "Pump reset, monitoring", "+ Update", "Reopen", "New Log", "Not closed 1", "Closed 1"]) expect(t).toContain(x);
    expect(html).toContain('aria-label="Close HS-0002"');
    expect(html).not.toContain('aria-label="Close HS-0001"');
    expect(html).toContain('aria-label="Reopen HS-0001"');
  });
  it("says what it is for when empty, and offers the first log", () => {
    const t = text(renderToStaticMarkup(<HouseStatusScreen />));
    expect(t).toContain("No house status logs");
    expect(t).toContain("New Log");
  });
  it("a department staff phone sees the logs without any button to change them", () => {
    app.set((s) => ({ ...s, me: "s-joel" }));
    setUI({ account: { name: "Phone", role: "device", hotel: "", logoUrl: "" } });
    withLogs([log({})]);
    app.set((s) => ({ ...s, me: "s-joel" }));
    const html = renderToStaticMarkup(<HouseStatusScreen />);
    expect(html).toContain("Water pressure low");
    expect(html).not.toContain("New Log");
    expect(html).not.toContain("+ Update");
    expect(text(html)).toContain("You can read House Status");
  });
});
