import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SEED_CATALOG } from "../../domain/catalog";
import { app, initialState, resetApp, setUI, ui } from "../../domain/store";
import type { Item, Request, State } from "../../domain/types";
import { inquiryForm } from "../inquiries/data";
import { reminderForm } from "../reminders/data";
import { visibleModules } from "../registry";
import { Dashboard } from "./Dashboard";
import { QUICK_ACTIONS, buildCards, computeStats, dashActions, fmtMinutes, responseCards } from "./model";

const MIN = 60_000;
/** 2026-10-31 04:00 in Manila (UTC+8); the UTC date is still Oct 30. */
const NOW = Date.parse("2026-10-30T20:00:00Z");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let n = 0;
const item = (status: Item["status"], o: Partial<Item> = {}): Item => ({ id: `i${++n}`, requestId: `r${n}`, name: `Thing ${n}`, qty: 1, dept: "housekeeping", status, createdAt: NOW - 5 * MIN, heldMs: 0, slaMin: 10, events: [], ...o });
const reqOf = (it: Item): Request => ({ id: it.requestId, ticket: `T-${String(n).padStart(4, "0")}`, room: "412", source: "guest", loggedBy: "s-maria", createdAt: it.createdAt, itemIds: [it.id] });

function load(items: Item[], modules: Record<string, unknown> = {}, extra: Partial<State> = {}, now = NOW) {
  app.set(() => ({
    ...initialState(now),
    me: "s-maria",
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    requests: items.map(reqOf),
    wos: [],
    cleaning: [],
    modules,
    ...extra,
  }));
  return app.get();
}

const T0 = NOW - 3 * 3600_000;
const FIXED = () => [
  item("new"), // 5 min unacknowledged: overdue
  item("relayed", { ackAt: NOW - MIN }),
  item("on_site", { ackAt: NOW - 30 * MIN }), // 30 min on a 10 min target: overdue
  item("on_hold", { ackAt: NOW - 20 * MIN, holdSince: NOW - 10 * MIN }), // held: not overdue
  // relay 1 min, 8 min of work minus 3 min held = 5 min on a 6 min target: within
  item("done", { createdAt: T0, ackAt: T0 + MIN, doneAt: T0 + 9 * MIN, heldMs: 3 * MIN, slaMin: 6 }),
  // relay 3 min, 20 min on a 10 min target: not within
  item("done", { createdAt: T0, ackAt: T0 + 3 * MIN, doneAt: T0 + 23 * MIN, slaMin: 10 }),
  item("cant_do"), // closed, not done: counts nowhere
];
const MODS = () => ({
  inquiries: { list: [{ status: "active" }, { status: "active" }, { status: "noted" }, { status: "done" }], counts: { active: 2, noted: 1 } },
  housestatus: { logs: [{ status: "monitoring" }, { status: "pending" }, { status: "closed" }] },
  reminders: { list: [
    { id: "a", status: "pending", dueAt: NOW - MIN, createdAt: 1 }, { id: "b", status: "pending", dueAt: NOW + 5 * MIN, createdAt: 1 },
    { id: "c", status: "pending", createdAt: 1 }, { id: "d", status: "completed", dueAt: NOW - 9 * MIN, createdAt: 1 },
  ] },
  crisis: { cases: [
    { id: "c1", status: "active", createdAt: Date.parse("2026-10-30T17:00:00Z") }, // 01:00 Oct 31 local: today (c3, resolved, is today too: any status counts)
    { id: "c2", status: "monitoring", createdAt: Date.parse("2026-10-30T15:00:00Z") }, // 23:00 Oct 30 local: yesterday (UTC says today)
    { id: "c3", status: "resolved", createdAt: NOW - MIN },
  ] },
  transport: { vehicles: [], trips: [
    { id: "t1", status: "en_route", depAt: NOW - 3600_000, createdAt: NOW - 3600_000 },
    { id: "t2", status: "scheduled", schedAt: Date.parse("2026-10-31T01:00:00Z"), createdAt: NOW - 9 * 3600_000 }, // 09:00 Oct 31 local (UTC: also Oct 31, so UTC would miss it)
    { id: "t3", status: "arrived", depAt: Date.parse("2026-10-30T10:00:00Z"), createdAt: 1 }, // 18:00 Oct 30 local: yesterday (UTC says today)
    { id: "t4", status: "cancelled", schedAt: NOW, createdAt: NOW },
  ] },
  workorders: { local: { add: [], patch: {} } },
});
const WOS = () => [
  { id: "w1", no: "WO-1", status: "reported", targetEnd: Date.parse("2026-10-29T00:00:00+08:00"), audit: [] },
  { id: "w2", no: "WO-2", status: "in_progress", targetEnd: Date.parse("2026-11-02T00:00:00+08:00"), audit: [] },
  { id: "w3", no: "WO-3", status: "done", targetEnd: Date.parse("2026-10-01T00:00:00+08:00"), audit: [] },
] as never;
const CLEAN = () => [{ id: "c1", room: "101", type: "Regular", status: "ready" }, { id: "c2", room: "102", type: "Regular", status: "ready" }, { id: "c3", room: "103", type: "Regular", status: "done" }] as never;

const fixed = () => computeStats(load(FIXED(), MODS(), { wos: WOS(), cleaning: CLEAN() }));

beforeEach(() => { n = 0; });
afterEach(() => {
  resetApp();
  setUI({ sheet: null, tab: "dashboard", access: undefined, account: { name: "", role: "device", hotel: "", logoUrl: "" } });
  inquiryForm.set(() => ({ open: false }));
  reminderForm.set(() => ({ open: false }));
});

describe("dashboard numbers", () => {
  it("counts requests: open, by status, overdue (own target), on hold", () => {
    expect(fixed().requests).toEqual({ open: 4, fresh: 1, relayed: 1, onSite: 1, hold: 1, overdue: 2 });
  });

  it("counts every module's card from the snapshot", () => {
    const st = fixed();
    expect(st.inquiries).toBe(3);
    expect(st.houseLogs).toBe(2);
    expect(st.reminders).toEqual({ pending: 3, overdue: 1 });
    expect(st.roomsReady).toBe(2);
    expect(st.wos).toEqual({ notDone: 2, overdue: 1 });
    expect(st.crisis).toEqual({ unresolved: 2, today: 2 });
    expect(st.trips).toEqual({ today: 2, enRoute: 1 });
  });

  it("response cards: average relay, average completion with hold removed, percent within each item's own target", () => {
    const r = fixed().response;
    expect(r).toEqual({ n: 2, avgRelayMs: 2 * MIN, avgCompleteMs: 12.5 * MIN, withinPct: 50 });
    const [relay, complete, within] = responseCards(r);
    expect([relay.value, relay.tone, relay.sub]).toEqual(["2.0 min", "ok", "Within the 2 minute target"]);
    expect(complete.value).toBe("12.5 min");
    expect([within.value, within.tone]).toEqual(["50%", "bad"]);
  });

  it("the within-target card is green from 80%", () => {
    const eight = Array.from({ length: 5 }, (_, i) => item("done", { createdAt: T0, ackAt: T0, doneAt: T0 + (i < 4 ? 5 : 15) * MIN, slaMin: 10 }));
    const r = computeStats(load(eight)).response;
    expect(r.withinPct).toBe(80);
    expect(responseCards(r)[2].tone).toBe("ok");
  });

  it("a hold lasting past the target does not count against it", () => {
    const r = computeStats(load([item("done", { createdAt: T0, ackAt: T0, doneAt: T0 + 40 * MIN, heldMs: 35 * MIN, slaMin: 10 })])).response;
    expect(r.withinPct).toBe(100);
  });

  it("nothing finished yet is a dash, not a red 0%", () => {
    const r = computeStats(load([item("new")])).response;
    const cards = responseCards(r);
    expect(cards.map((c) => c.value)).toEqual(["—", "—", "—"]);
    expect(cards.every((c) => c.tone === "")).toBe(true);
    expect(cards[0].sub).toBe("No finished items yet");
  });

  it("formats averages in minutes, hours past 60", () => {
    expect(fmtMinutes(54_000)).toBe("0.9 min");
    expect(fmtMinutes(65 * MIN)).toBe("1h 05m");
    expect(fmtMinutes(null)).toBe("—");
  });
});

describe("the hotel's day, not UTC's", () => {
  const BEFORE = Date.parse("2026-10-30T15:59:30Z"); // 23:59:30 Oct 30 in Manila
  const AFTER = Date.parse("2026-10-30T16:00:30Z"); // 00:00:30 Oct 31
  const trip = { id: "t", status: "arrived", depAt: Date.parse("2026-10-30T15:59:00Z"), createdAt: 1 };
  const crisis = { id: "c", status: "active", createdAt: Date.parse("2026-10-30T15:59:00Z") };
  const at = (now: number) => computeStats(load([], { crisis: { cases: [crisis] }, transport: { vehicles: [], trips: [trip] } }, {}, now));

  it("a trip and a case at 23:59 are today until midnight in Manila", () => {
    expect(at(BEFORE).trips.today).toBe(1);
    expect(at(BEFORE).crisis.today).toBe(1);
  });
  it("and yesterday one minute later (UTC would still call them today)", () => {
    expect(at(AFTER).trips.today).toBe(0);
    expect(at(AFTER).crisis.today).toBe(0);
    expect(at(AFTER).crisis.unresolved).toBe(1);
  });
});

describe("cards and the role matrix", () => {
  it("every card carries the number computed for it and opens its module", () => {
    const { stats, tiles } = buildCards(fixed(), () => true);
    const v = (c: { key: string; value: number }[]) => Object.fromEntries(c.map((x) => [x.key, x.value]));
    expect(v(stats)).toEqual({ open: 4, overdue: 2, hold: 1, inquiries: 3, house: 2, reminders: 3, rooms: 2 });
    expect(v(tiles)).toEqual({ crisis: 2, transport: 2, wos: 2 });
    expect([...stats, ...tiles].map((c) => c.module)).toEqual(["requests", "requests", "requests", "inquiries", "housestatus", "reminders", "cleaning", "crisis", "transport", "workorders"]);
    expect(stats.find((c) => c.key === "reminders")!.sub).toBe("1 overdue");
    expect(tiles.find((c) => c.key === "crisis")!.sub).toBe("Unresolved, 2 logged today");
  });

  it("a card of a module the viewer cannot see is not offered", () => {
    const hdo = visibleModules({ role: "device", catalog: SEED_CATALOG, me: { role: "hdo", dept: "frontdesk" } });
    expect(hdo.some((m) => m.id === "dashboard")).toBe(true);
    const only = (ids: string[]) => (m: string) => ids.includes(m);
    const cards = buildCards(fixed(), only(["requests", "workorders"]));
    expect(cards.stats.map((c) => c.key)).toEqual(["open", "overdue", "hold"]);
    expect(cards.tiles.map((c) => c.key)).toEqual(["wos"]);
  });

  it("the rendered Dashboard hides the cards, quick actions and table a restricted account may not use", () => {
    load(FIXED(), MODS(), { wos: WOS(), cleaning: CLEAN() });
    setUI({ account: { name: "Mgr", role: "manager", hotel: "x", logoUrl: "", modules: { dashboard: "full", workorders: "full" } } });
    const html = text(renderToStaticMarkup(<Dashboard />));
    expect(html).toContain("Work orders open");
    for (const t of ["Open requests", "Inquiries active", "Crisis Mgmt", "Trips today", "New Request", "New Inquiry", "Log Cleaning", "Recent Tickets", "Response times"]) expect(html).not.toContain(t);
    expect(html).toContain("Shift handover");
  });

  it("an owner sees every card, the quick actions and the one-line explanation", () => {
    load(FIXED(), MODS(), { wos: WOS(), cleaning: CLEAN() });
    setUI({ account: { name: "Owner", role: "owner", hotel: "x", logoUrl: "" } });
    const html = text(renderToStaticMarkup(<Dashboard />));
    for (const t of ["Open requests", "Overdue", "On hold", "Inquiries active", "House logs open", "Reminders pending", "Rooms ready", "Crisis Mgmt", "Trips today", "Work orders open", "New Request", "New Inquiry", "New Reminder", "Log Cleaning", "Targets differ by request type", "Average time to relay", "2.0 min", "12.5 min", "50%"]) expect(html).toContain(t);
  });
});

describe("quick actions open the modules' real forms", () => {
  it("lists the four, in the prototype's order, with its shortcuts", () => {
    expect(QUICK_ACTIONS.map((a) => [a.label, a.keys, a.module])).toEqual([["New Request", "R", "requests"], ["New Inquiry", "I", "inquiries"], ["New Reminder", "M", "reminders"], ["Log Cleaning", "C", "cleaning"]]);
  });
  const run = (key: string) => QUICK_ACTIONS.find((a) => a.key === key)!.run();

  it("New Request opens the composer", () => { run("request"); expect(ui.get().sheet).toBe("composer"); });
  it("New Inquiry goes to Inquiries with the form open", () => { run("inquiry"); expect(ui.get().tab).toBe("inquiries"); expect(inquiryForm.get().open).toBe(true); });
  it("New Reminder goes to Reminders with the form open", () => { run("reminder"); expect(ui.get().tab).toBe("reminders"); expect(reminderForm.get().open).toBe(true); });
  it("Log Cleaning goes to Cleaning", () => { run("cleaning"); expect(ui.get().tab).toBe("cleaning"); });
});

describe("Recent Tickets", () => {
  it("offers Relay, On Site and Done by status, as the prototype does", () => {
    const items = Object.fromEntries([item("new"), item("relayed"), item("on_site"), item("on_hold"), item("done")].map((i) => [i.id, i]));
    const a = (id: string) => dashActions(items[id], items);
    expect(Object.keys(items).map(a)).toEqual([["relay"], ["onSite", "done"], ["done"], [], []]);
  });

  it("renders the prototype's columns and the row actions with names", () => {
    load(FIXED(), MODS());
    setUI({ account: { name: "Owner", role: "owner", hotel: "x", logoUrl: "" } });
    const html = renderToStaticMarkup(<Dashboard />);
    for (const h of ["Code", "Room", "Item", "Qty", "Dept", "Source", "Status", "Created"]) expect(html).toMatch(new RegExp(`<th[^>]*>${h}<`));
    expect(html).toContain('aria-label="Relay: ');
    expect(html).toContain('aria-label="On Site: ');
    expect(text(html)).toContain("Oct 31");
  });

  it("says what to do on a quiet system with no tickets", () => {
    load([]);
    setUI({ account: { name: "Owner", role: "owner", hotel: "x", logoUrl: "" } });
    const html = text(renderToStaticMarkup(<Dashboard />));
    expect(html).toContain("No tickets yet");
    expect(html).toContain("Nothing waiting");
  });
});
