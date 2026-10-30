import { describe, expect, it } from "vitest";
import { SEED_CATALOG } from "./domain/catalog";
import { initialState } from "./domain/store";
import { LABELS, MATRIX } from "./modules/access";
import { MODULES, badgeText, levelFor, visibleModules, type Viewer } from "./modules/registry";
import { connState } from "./ui/kit";

const ids = (v: Viewer) => visibleModules(v).map((m) => m.id);
const ALL = ["dashboard", "requests", "inquiries", "cleaning", "workorders", "housestatus", "crisis", "transport", "reminders", "reports", "config"];

describe("sidebar from the registry", () => {
  it("is the prototype's 11 items, in its order, with its labels and our icons", () => {
    expect(MODULES.map((m) => m.id)).toEqual(ALL);
    expect(MODULES.map((m) => m.label)).toEqual(["Dashboard", "Requests", "Inquiries", "Cleaning", "Work Orders", "House Status", "Crisis Mgmt", "Transport", "Reminders", "Reports", "Configuration"]);
    expect(MODULES.map((m) => m.icon)).toEqual(["gauge", "clip", "chat", "broom", "wrench", "note", "siren", "van", "bell", "chart", "gear"]);
    expect(Object.fromEntries(MODULES.map((m) => [m.id, m.label]))).toEqual(LABELS);
  });

  it("owners, managers and supervisors see all 11 (from the matrix, and from the server's list when sent)", () => {
    for (const role of ["owner", "manager", "supervisor"] as const) {
      expect(ids({ role, catalog: SEED_CATALOG })).toEqual(ALL);
    }
    const sup = { role: "supervisor" as const, catalog: SEED_CATALOG };
    expect(levelFor(MODULES[9], sup)).toBe("read");
    expect(levelFor(MODULES[10], sup)).toBe("read");
    // The server's own list wins, and leaves out what the account may not see.
    expect(ids({ role: "manager", catalog: SEED_CATALOG, accountModules: { dashboard: "full", requests: "full" } })).toEqual(["dashboard", "requests"]);
  });

  it("a shared phone shows what the PIN person's job role may see; nobody signed in sees nothing", () => {
    const phone = (me?: Viewer["me"]) => ids({ role: "device", catalog: SEED_CATALOG, me });
    expect(phone()).toEqual([]);
    expect(phone({ role: "hdo", dept: "frontdesk" })).toEqual(["dashboard", "requests", "inquiries", "cleaning", "workorders", "housestatus", "crisis", "transport", "reminders", "config"]);
    expect(phone({ role: "staff", dept: "housekeeping" })).toEqual(["requests", "cleaning", "workorders", "housestatus", "crisis", "transport", "config"]);
    expect(phone({ role: "staff", dept: "engineering" })).toEqual(["requests", "workorders", "housestatus", "crisis", "transport", "config"]);
    expect(phone({ role: "supervisor", dept: "housekeeping" })).toEqual(ALL);
  });

  it("follows each hotel's lists: a department that stops handling repairs leaves Work Orders read-only for its staff", () => {
    const boracay = { ...SEED_CATALOG, departments: SEED_CATALOG.departments.map((d) => (d.key === "engineering" ? { ...d, label: "Maintenance", repairs: false } : d)) };
    const eng = { role: "device" as const, me: { role: "staff" as const, dept: "engineering" } };
    expect(levelFor(MODULES[4], { ...eng, catalog: SEED_CATALOG })).toBe("full");
    expect(levelFor(MODULES[4], { ...eng, catalog: boracay })).toBe("read");
  });

  it("the server's matrix (window.AZL.access) replaces the desk's copy", () => {
    const access = { ...MATRIX, reports: { ...MATRIX.reports, supervisor: "none" as const } };
    expect(ids({ role: "supervisor", catalog: SEED_CATALOG, access })).not.toContain("reports");
  });
});

describe("badges", () => {
  it("count what the prototype counts; modules without data yet show 0; the rest have none", () => {
    const s = initialState(Date.now());
    const items = Object.values(s.items);
    const want: Record<string, number | undefined> = {
      requests: items.filter((i) => ["new", "relayed", "on_site", "on_hold"].includes(i.status)).length,
      inquiries: 0,
      workorders: s.wos.filter((w) => w.status !== "done").length,
      housestatus: 0,
      crisis: s.incidents.filter((i) => i.status === "active").length,
      reminders: 0,
    };
    expect(want.requests).toBeGreaterThan(0);
    for (const m of MODULES) expect([m.id, m.badge?.(s)]).toEqual([m.id, want[m.id]]);
    const withAlert = { ...s, incidents: [{ id: "x", no: "INC-001", hazard: "smoke" as const, rooms: ["1"], createdAt: 0, text: "smoke", status: "active" as const, log: [] }] };
    expect(MODULES[6].badge?.(withAlert)).toBe(1);
  });

  it("show 0 like the prototype (one constant hides it)", () => {
    expect(badgeText(0)).toBe("0");
    expect(badgeText(4)).toBe("4");
  });
});

describe("phone bar", () => {
  it("is Dashboard, Requests, Cleaning and Work Orders; More holds the other 7", () => {
    expect(MODULES.filter((m) => m.phoneTab).map((m) => m.label)).toEqual(["Dashboard", "Requests", "Cleaning", "Work Orders"]);
    expect(MODULES.filter((m) => !m.phoneTab).length).toBe(7);
  });
});

describe("connection chip", () => {
  it("says Online, Syncing or Offline with the number of changes waiting", () => {
    expect(connState(true, { pending: 0, offline: false }, false)).toEqual({ tone: "ok", text: "Online" });
    expect(connState(true, { pending: 2, offline: false }, false)).toEqual({ tone: "ok", text: "Syncing 2" });
    expect(connState(false, { pending: 3, offline: false }, false)).toEqual({ tone: "warn", text: "Offline · 3 waiting" });
    expect(connState(true, { pending: 0, offline: true }, false).text).toBe("Offline");
    expect(connState(true, { pending: 0, offline: false }, true).text).toBe("Offline");
  });
});
