import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheets, Sidebar, TabBar } from "../App";
import { SEED_CATALOG } from "../domain/catalog";
import { app, initialState, moduleData, resetApp, runModuleCommand, setUI, ui } from "../domain/store";
import { remote } from "../domain/remote";
import { memoryOutbox } from "../domain/outbox";
import type { AnyCommand } from "../domain/contract";
import { Dashboard } from "./dashboard/Dashboard";
import { Crisis } from "./crisis/Crisis";
import { MODULES, visibleModules } from "./registry";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const all = () => visibleModules({ role: "owner", catalog: SEED_CATALOG });

afterEach(() => {
  remote.disable();
  resetApp();
  setUI({ sheet: null, tab: "dashboard" });
});

describe("rendered shell", () => {
  it("the sidebar lists the 11 labels in order, marks the current one, and shows the badges with 0", () => {
    const html = renderToStaticMarkup(<Sidebar nav={all()} current="crisis" />);
    const labels = [...html.matchAll(/class="side-label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Dashboard", "Requests", "Inquiries", "Cleaning", "Work Orders", "House Status", "Crisis Mgmt", "Transport", "Reminders", "Reports", "Configuration"]);
    expect(html).toMatch(/aria-current="page"[^>]*>.*?Crisis Mgmt/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="0 active"'); // Inquiries
    expect(html).toContain('aria-label="0 pending"'); // Reminders
    expect(html).toContain("New request");
    expect(html.match(/class="badge/g)).toHaveLength(6); // Requests, Inquiries, Work Orders, House Status, Crisis, Reminders
  });

  it("a department staff phone gets a shorter sidebar", () => {
    const nav = visibleModules({ role: "device", catalog: SEED_CATALOG, me: { role: "staff", dept: "housekeeping" } });
    const html = renderToStaticMarkup(<Sidebar nav={nav} current="requests" />);
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain("Reports");
  });

  it("the phone bar has four tabs and More; More opens a sheet with the other 7 and the paper kit", () => {
    const bar = text(renderToStaticMarkup(<TabBar nav={all()} current="reports" />));
    expect(bar.trim()).toMatch(/Dashboard .*Requests .*Cleaning .*Work Orders .*More/);
    expect(renderToStaticMarkup(<TabBar nav={all()} current="reports" />)).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*More/);
    setUI({ sheet: "more" });
    const more = text(renderToStaticMarkup(<Sheets nav={all()} mod={MODULES[0]} inspector={false} />));
    for (const label of ["Inquiries", "House Status", "Crisis Mgmt", "Transport", "Reminders", "Reports", "Configuration", "Paper kit"]) expect(more).toContain(label);
  });
});

describe("dashboard", () => {
  it("has the quick actions, the counts, recent tickets and the shift handover panel", () => {
    app.set(() => ({ ...initialState(Date.now()), me: "s-maria" }));
    const html = text(renderToStaticMarkup(<Dashboard />));
    for (const t of ["New Request", "New Inquiry", "New Reminder", "Log Cleaning", "Open", "Overdue", "On hold", "Work orders open", "Rooms ready", "Recent Tickets", "View all", "Shift handover", "Acknowledge handover"]) expect(html).toContain(t);
    const first = app.get().requests.filter((r) => r.itemIds.length).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(html).toContain(`${first.ticket}-1`);
  });

  it("with nothing logged says so and still offers a new request", () => {
    app.set((s) => ({ ...s, requests: [], items: {}, wos: [], cleaning: [] }));
    const html = text(renderToStaticMarkup(<Dashboard />));
    expect(html).toContain("No tickets yet");
  });
});

describe("crisis", () => {
  it("Crisis Mgmt lists the safety incidents as cards that open the existing alert, with a Log a case area", () => {
    app.set((s) => ({ ...s, incidents: [{ id: "x1", no: "INC-001", hazard: "smoke", rooms: ["412"], createdAt: Date.now(), text: "smoke in the hall", status: "active", log: [] }] }));
    const html = text(renderToStaticMarkup(<Crisis />));
    for (const t of ["CALL 911 / RADIO FIRST, THEN LOG.", "Log a case", "INC-001", "Smoke or fire", "Room 412", "Open the alert", "BFP/911 call not recorded"]) expect(html).toContain(t);
  });
});

describe("module data and commands", () => {
  it("a snapshot's module slices are kept and read with moduleData; an older server sends none", async () => {
    const { applySnapshot } = await import("../domain/store");
    const snap = { staff: [], requests: [], items: {}, wos: [], cleaning: [], incidents: [], handover: {}, seq: { t: 0, wo: 0, inc: 0, id: 0 } };
    applySnapshot({ ...snap, modules: { inquiries: { list: [1, 2] } } } as never);
    expect(moduleData<{ list: number[] }>(app.get(), "inquiries")?.list).toEqual([1, 2]);
    applySnapshot(snap as never);
    expect(app.get().modules).toEqual({});
  });

  it("runModuleCommand changes the slice at once and queues the command with a fresh opId through the outbox", async () => {
    const sent: AnyCommand[] = [];
    const outbox = memoryOutbox();
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox });
    runModuleCommand("inquiries", "logInquiry", { inquiryId: "i1", name: "Mr. Santos" }, (slice) => ({ list: [...((slice as { list?: string[] })?.list ?? []), "i1"] }));
    runModuleCommand("inquiries", "logInquiry", { inquiryId: "i2", name: "Ana" });
    expect(moduleData<{ list: string[] }>(app.get(), "inquiries")?.list).toEqual(["i1"]);
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent.map((c) => [c.type, (c as unknown as { inquiryId: string }).inquiryId])).toEqual([["logInquiry", "i1"], ["logInquiry", "i2"]]);
    expect(sent[0].opId).not.toBe(sent[1].opId);
    expect(sent[0].opId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ui.get().tab).toBe("dashboard");
  });
});
