import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, applySnapshot, resetApp, setUI } from "../../domain/store";
import { remote } from "../../domain/remote";
import { memoryOutbox } from "../../domain/outbox";
import type { AnyCommand, Snapshot } from "../../domain/contract";
import type { WorkOrder } from "../../domain/types";
import workorders from "./index";
import cleaningMod from "../cleaning/index";
import {
  NO_FILTERS, TRANSITIONS, applyFilters, assessWo, completeWo, dayMs, dayOf, deadline, holdWo, mergeWos, overdue, priorityKey, priorityLabel, reopenWo, reportWo, startWo, updateWo, type Wo,
} from "./model";
import { CLEAN_TRANSITIONS, clockIn, clockOut, fmtMinutes, logClean, mergeTasks, minutes, scheduleClean, typeLabel, type Task } from "../cleaning/model";
import { Maintenance, WoDetail } from "../../screens/Maintenance";
import { Housekeeping } from "../../screens/Housekeeping";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const php = (f: string) => readFileSync(new URL(`../../../azalea-ehelpdesk/includes/Modules/${f}`, import.meta.url), "utf8");

/** Reads `const TRANSITIONS = array( 'x' => array( array( 'a', 'b' ), 'c' ), ... );` out of a module's PHP file. */
function phpTransitions(src: string): Record<string, [string[], string | null]> {
  const block = /const TRANSITIONS = array\(([\s\S]*?)\n\t\);/.exec(src)![1];
  const out: Record<string, [string[], string | null]> = {};
  for (const m of block.matchAll(/'(\w+)'\s*=>\s*array\(\s*array\(([^)]*)\),\s*(null|'(\w+)')\s*\)/g)) {
    out[m[1]] = [[...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]), m[4] ?? null];
  }
  return out;
}

const wo = (over: Partial<Wo> = {}): Wo => ({ id: "w1", no: "WO-0001", area: "Room", loc: "Room 305", desc: "AC", priority: "high", dept: "engineering", status: "in_progress", reportedBy: "s-joel", encodedBy: "s-maria", createdAt: 0, audit: [], ...over });
const NOW = Date.parse("2026-10-30T12:00:00+08:00");

const OWNER = { name: "Mr. Reyes", role: "owner" as const, hotel: "", logoUrl: "" };
beforeEach(() => setUI({ account: OWNER }));
afterEach(() => {
  remote.disable();
  resetApp();
  setUI({ sheet: null, tab: "dashboard", selWo: undefined });
});

describe("work orders: rules", () => {
  it("the desk's transition table is the server's (Azl_Module_WorkOrders::TRANSITIONS)", () => {
    expect(phpTransitions(php("WorkOrders.php"))).toEqual(TRANSITIONS);
    expect(phpTransitions(php("Cleaning.php"))).toEqual(CLEAN_TRANSITIONS);
  });

  it("dates are the hotel's (Asia/Manila): 7 a.m. there is still yesterday in UTC", () => {
    const sevenAm = Date.parse("2026-10-30T07:00:00+08:00");
    expect(dayOf(sevenAm)).toBe("2026-10-30");
    expect(dayMs("2026-10-30")).toBe(Date.parse("2026-10-29T16:00:00Z"));
    expect(dayOf(dayMs("2026-10-30"))).toBe("2026-10-30");
  });

  it("the deadline follows an extension, and overdue means past that day in hotel time and not done", () => {
    const w = wo({ requestedDate: dayMs("2026-10-28"), targetEnd: dayMs("2026-11-02") });
    expect(dayOf(deadline(w)!)).toBe("2026-11-02");
    expect(overdue(w, NOW)).toBe(false); // the prototype would flag it (A.16 #4)
    expect(overdue(wo({ requestedDate: dayMs("2026-10-29") }), NOW)).toBe(true);
    expect(overdue(wo({ requestedDate: dayMs("2026-10-30") }), NOW)).toBe(false); // due today is not late yet
    expect(overdue(wo({ requestedDate: dayMs("2026-10-29"), status: "done" }), NOW)).toBe(false);
    expect(overdue(wo({ requestedDate: dayMs("2026-10-29"), status: "scheduled" }), NOW)).toBe(false);
    expect(overdue(wo({}), NOW)).toBe(false);
  });

  it("old priorities stay as stored and read as the prototype's: normal is Medium", () => {
    expect(priorityLabel("normal")).toBe("Medium");
    expect(priorityLabel("urgent")).toBe("Urgent");
    expect(priorityKey("normal")).toBe("medium");
    const list = [wo({ id: "a", priority: "normal" }), wo({ id: "b", priority: "medium", dept: "it" }), wo({ id: "c", priority: "low", status: "done" })];
    expect(applyFilters(list, { ...NO_FILTERS, priority: "medium" }, NOW).map((w) => w.id)).toEqual(["a", "b"]);
    expect(applyFilters(list, { ...NO_FILTERS, status: "open" }, NOW).map((w) => w.id)).toEqual(["a", "b"]);
    expect(applyFilters(list, { ...NO_FILTERS, dept: "it" }, NOW).map((w) => w.id)).toEqual(["b"]);
    expect(applyFilters([...list, wo({ id: "d", requestedDate: dayMs("2026-10-01") })], { ...NO_FILTERS, overdueOnly: true }, NOW).map((w) => w.id)).toEqual(["d"]);
  });
});

describe("work orders: optimistic changes and what is sent", () => {
  it("report, assess, start, update, hold, complete, reopen: the list changes at once and the commands carry the new fields", async () => {
    const sent: AnyCommand[] = [];
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox: memoryOutbox() });
    const before = app.get().wos.length;
    const no = reportWo({ area: "Room", loc: "Room 305", desc: "AC compressor", priority: "urgent", dept: "engineering", reporterDept: "housekeeping", reporterId: "s-joel", requestedDate: "2026-11-02" }, app.get());
    expect(no).toBe(`WO-${String(app.get().seq.wo + 1).padStart(4, "0")}`);
    const w = mergeWos(app.get())[0];
    expect(w).toMatchObject({ no, status: "reported", priority: "urgent", reporterDept: "housekeeping", requestedDate: dayMs("2026-11-02") });
    expect(mergeWos(app.get())).toHaveLength(before + 1);
    expect(workorders.badge!(app.get())).toBe(mergeWos(app.get()).filter((x) => x.status !== "done").length);

    assessWo(w.id, { assessment: "Seized", assignType: "outsource", contractor: "CoolAir HVAC", targetEnd: "2026-11-05", estCost: 15000 });
    startWo(w.id, false);
    updateWo(w.id, { text: "Parts ordered", newDeadline: "2026-11-08", extendReason: "Parts delayed" });
    holdWo(w.id, "Waiting for parts");
    let cur = mergeWos(app.get()).find((x) => x.id === w.id)!;
    expect(cur).toMatchObject({ status: "on_hold", holdReason: "Waiting for parts", contractor: "CoolAir HVAC", estCost: 15000, targetEnd: dayMs("2026-11-08") });
    expect(cur.updates!.map((u) => u.text)).toEqual(["Parts ordered\nDeadline: 2026-11-05 → 2026-11-08 (Parts delayed)", "On hold: Waiting for parts"]);
    startWo(w.id, true);
    completeWo(w.id, { actualCost: 14500, notes: "Replaced" });
    cur = mergeWos(app.get()).find((x) => x.id === w.id)!;
    expect(cur).toMatchObject({ status: "done", actualCost: 14500, completionNotes: "Replaced" });
    reopenWo(w.id);
    expect(mergeWos(app.get()).find((x) => x.id === w.id)!.status).toBe("assessed");

    for (let i = 0; i < 100 && sent.length < 8; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent.map((c) => c.type)).toEqual(["reportWo", "assessWo", "startWo", "updateWo", "holdWo", "startWo", "completeWo", "reopenWo"]);
    expect(sent[0]).toMatchObject({ woId: w.id, requestedDate: "2026-11-02", reporterId: "s-joel" });
    expect(sent[0]).not.toHaveProperty("schedDate");
    expect(sent[1]).toMatchObject({ woId: w.id, assignType: "outsource", contractor: "CoolAir HVAC", targetEnd: "2026-11-05", estCost: 15000 });
    expect(sent[4]).toMatchObject({ type: "holdWo", reason: "Waiting for parts" });
    expect(sent[6]).toMatchObject({ type: "completeWo", actualCost: 14500, notes: "Replaced" });
    expect(new Set(sent.map((c) => c.opId)).size).toBe(8);
  });

  it("the next snapshot replaces the unconfirmed changes with the server's work orders", () => {
    reportWo({ area: "Room", loc: "", desc: "Leak", priority: "low", dept: "engineering", reporterDept: "engineering", requestedDate: "2026-11-02" }, app.get());
    const s = app.get();
    expect(mergeWos(s).some((w) => w.desc === "Leak")).toBe(true);
    const snap = { property: { id: "p", name: "P" }, properties: [], staff: s.staff, requests: s.requests, items: s.items, wos: [] as WorkOrder[], cleaning: s.cleaning, incidents: [], seq: s.seq, at: 0, handover: {}, modules: { workorders: {} } } as Snapshot;
    applySnapshot(snap);
    expect(mergeWos(app.get())).toEqual([]);
  });
});

describe("work orders: screens", () => {
  it("the list shows every column's information on a phone card, with the overdue marker and the actions for each status", () => {
    applySnapshot({ ...base(), wos: [
      wo({ id: "a", no: "WO-0011", status: "reported", requestedDate: dayMs("2020-01-01"), reporterDept: "housekeeping" }),
      wo({ id: "b", no: "WO-0012", status: "in_progress", assignType: "outsource", contractor: "CoolAir HVAC", priority: "normal" }),
      wo({ id: "c", no: "WO-0013", status: "scheduled", schedDate: dayMs("2030-01-01") }),
    ] as unknown as WorkOrder[] });
    const html = renderToStaticMarkup(<Maintenance />);
    const t = text(html);
    expect(t).toContain("Report Work Order");
    expect(t).toMatch(/WO-0011.*Reported.*Joel Dizon Housekeeping.*\(overdue\).*Assess/);
    expect(t).toMatch(/WO-0012.*Medium.*Outsourced: CoolAir HVAC.*Hold.*Complete/);
    expect(t).toMatch(/WO-0013.*Scheduled.*\(scheduled\).*Open/);
    expect(html).toContain('aria-label="Filter by status"');
    expect(t).toContain("Overdue 1");
  });

  it("the record pane shows assessment, cost, actual times, the updates thread and the audit, then the buttons for its status", () => {
    applySnapshot({ ...base(), wos: [wo({
      id: "a", status: "on_hold", assessment: "Seized", assessedBy: "s-ramon", estCost: 15000, actualStart: NOW, holdReason: "Parts",
      updates: [{ at: NOW, by: "s-ramon", text: "Parts ordered" }], audit: [{ at: NOW, by: "s-maria", what: "Reported" }],
    })] as unknown as WorkOrder[] });
    const t = text(renderToStaticMarkup(<WoDetail id="a" />));
    expect(t).toMatch(/On hold: Parts.*Assessment Seized.*Ramon Cruz.*Estimated ₱15,000.*Actual ₱—.*Updates \(1\).*Parts ordered.*Audit trail.*Reported/);
    expect(t).toMatch(/Edit.*Update.*Resume/);
    expect(t).not.toMatch(/bCompleteb/);
  });

  it("a viewer with read access sees no actions", () => {
    setUI({ account: { name: "x", role: "supervisor", hotel: "", logoUrl: "", modules: { workorders: "read" } } });
    applySnapshot({ ...base(), wos: [wo({ id: "a", status: "reported" })] as unknown as WorkOrder[] });
    const t = text(renderToStaticMarkup(<Maintenance />));
    expect(t).not.toContain("Report Work Order");
    expect(t).not.toMatch(/Assess/);
    expect(text(renderToStaticMarkup(<WoDetail id="a" />))).not.toContain("Edit");
  });
});

describe("cleaning", () => {
  it("the duration is whole minutes between clock in and out, running while cleaning", () => {
    const t: Task = { id: "c", room: "201", type: "regular", status: "done", clockIn: 0, clockOut: 27 * 60_000 + 59_000 };
    expect(minutes(t, 0)).toBe(27);
    expect(minutes({ ...t, status: "in_progress", clockOut: undefined }, 5 * 60_000)).toBe(5);
    expect(minutes({ ...t, clockIn: undefined }, 0)).toBeNull();
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(125)).toBe("2h 5m");
  });

  it("types read from the hotel's list; an old row's label shows as written", () => {
    const cat = app.get().catalog;
    expect(typeLabel("deep_clean", cat)).toBe("Deep Clean");
    expect(typeLabel("Deep clean", cat)).toBe("Deep clean");
    expect(typeLabel("vip_setup", { ...cat, cleaningTypes: [{ key: "vip_setup", label: "VIP Welcome", active: false }] } as never)).toBe("VIP Welcome");
  });

  it("log, schedule, clock in and out change the table at once and send the module's commands", async () => {
    const sent: AnyCommand[] = [];
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox: memoryOutbox() });
    logClean({ room: "201", cleanType: "regular", attendantId: "s-joel", role: "lead", clockIn: true });
    scheduleClean({ rooms: ["305", "408"], date: "2026-11-01", cleanType: "checkout" });
    const tasks = mergeTasks(app.get());
    const logged = tasks.find((t) => t.room === "201" && t.type === "regular")!;
    expect(logged).toMatchObject({ status: "in_progress", assignee: "s-joel", role: "lead" });
    expect(tasks.filter((t) => t.status === "scheduled" && t.schedDate === dayMs("2026-11-01")).map((t) => t.room)).toEqual(["305", "408"]);
    clockOut(logged.id);
    const queued = tasks.find((t) => t.room === "305" && t.status === "scheduled")!;
    clockIn(queued.id, "s-joel", "backup");
    expect(mergeTasks(app.get()).find((t) => t.id === logged.id)!.status).toBe("done");
    expect(mergeTasks(app.get()).find((t) => t.id === queued.id)).toMatchObject({ status: "in_progress", role: "backup" });
    for (let i = 0; i < 100 && sent.length < 4; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent.map((c) => c.type)).toEqual(["logClean", "scheduleClean", "clockOut", "clockIn"]);
    expect(sent[1]).toMatchObject({ rooms: ["305", "408"], date: "2026-11-01", cleanType: "checkout" });
    expect((sent[1] as unknown as { taskIds: string[] }).taskIds).toHaveLength(2);
    expect(cleaningMod.badge).toBeUndefined();
  });

  it("the table shows type, RA with role, status, sched, clock times and duration, and the right action per state", () => {
    applySnapshot({ ...base(), cleaning: [
      { id: "a", room: "201", type: "regular", status: "done", assignee: "s-joel", role: "lead", clockIn: NOW - 27 * 60_000, clockOut: NOW },
      { id: "b", room: "305", type: "checkout", status: "ready", assignee: "s-joel", role: "backup" },
      { id: "c", room: "408", type: "Deep clean", status: "scheduled", schedDate: dayMs("2026-11-01") },
    ] as never });
    const t = text(renderToStaticMarkup(<Housekeeping />));
    expect(t).toContain("Log Cleaning");
    expect(t).toContain("Schedule Rooms");
    expect(t).toMatch(/Room 201 · Regular.*Done.*Joel Dizon \(Lead\).*27m/);
    expect(t).toMatch(/Room 305 · Checkout.*Ready.*\(Backup\).*Clock In/);
    expect(t).toMatch(/Room 408 · Deep clean.*Scheduled.*Nov 1, 2026.*Mark ready/);
  });
});

function base() {
  const s = app.get();
  return { property: { id: "p", name: "P" }, properties: [], staff: s.staff, requests: s.requests, items: s.items, wos: s.wos, cleaning: s.cleaning, incidents: [], seq: s.seq, at: 0, handover: {}, modules: {} } as Snapshot;
}
