import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "../ui/icons";
import { canEditLists } from "./store";
import { showLists } from "../screens/Settings";
import {
  REQUEST_ICONS, SEED_CATALOG, activeDepartments, canEscalate, repairDepartments, deleteBlocker, deptLabel, deptShort, holdLabel, isCatalog, swipeHoldReason, usageText, validateList,
  type Catalog, type Draft,
} from "./catalog";
import { archiveQuestion, blankRow, deleteProblem, isDirty, listSummary, move, removePart, suggestShort, toPayload, toRows } from "./listEdit";
import { app, applySnapshot, escalate, logRequest, onSite, resetApp, setCatalog } from "./store";
import type { Snapshot } from "./contract";

const php = (f: string) => readFileSync(new URL(`../../azalea-ehelpdesk/includes/${f}`, import.meta.url), "utf8");
const clone = (): Catalog => structuredClone(SEED_CATALOG);

describe("catalog seed and the PHP side", () => {
  it("the seed matches Rules.php (departments and request types) and every icon a hotel can pick exists", () => {
    const rules = php("Rules.php");
    const depts = [...rules.matchAll(/'(\w+)'\s*=> array\( 'label' => '([^']+)', 'short' => '([^']+)', 'repairs' => (true|false) \)/g)].map((m) => [m[1], m[2], m[3], m[4] === "true"]);
    expect(depts).toEqual(SEED_CATALOG.departments.map((d) => [d.key, d.label, d.short, d.repairs]));
    const types = [...rules.matchAll(/'(\w+)'\s*=> array\( '([^']+)', '(\w+)', (\d+), '(\w+)' \)/g)].map((m) => [m[1], m[2], m[3], Number(m[4]), m[5]]);
    expect(types).toEqual(SEED_CATALOG.requestTypes.map((t) => [t.key, t.label, t.dept, t.slaMin, t.icon]));
    const phpIcons = /const ICONS = array\(([^)]*)\)/.exec(php("Catalog.php"))![1]!.match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
    expect(phpIcons).toEqual(REQUEST_ICONS.map((i) => i.name));
    for (const i of REQUEST_ICONS) expect(ICONS[i.name], i.name).toBeDefined();
    for (const t of SEED_CATALOG.requestTypes) expect(REQUEST_ICONS.some((i) => i.name === t.icon)).toBe(true);
  });
});

describe("catalog helpers", () => {
  const cat = clone();
  cat.departments.push({ key: "spa", label: "Spa", short: "SPA", repairs: false, active: false });

  it("labels tolerate archived and unknown keys", () => {
    expect(deptLabel("fnb", cat)).toBe("Food & Beverage");
    expect(deptShort("fnb", cat)).toBe("F&B");
    expect(deptLabel("spa", cat)).toBe("Spa");
    expect(deptLabel("laundry_room", cat)).toBe("laundry_room");
    expect(deptShort("laundry_room", cat)).toBe("LAUNDR");
    expect(holdLabel("dnd", cat)).toBe("Guest on Do Not Disturb");
    expect(holdLabel("old_reason", cat)).toBe("old reason");
    expect(activeDepartments(cat).map((d) => d.key)).not.toContain("spa");
  });

  it("swipe-to-hold uses Do Not Disturb while it is active, else the first active reason, else none", () => {
    const c = clone();
    expect(swipeHoldReason(c)).toBe("dnd");
    c.holdReasons = c.holdReasons.map((r) => (r.key === "dnd" ? { ...r, active: false } : r));
    expect(swipeHoldReason(c)).toBe("parts");
    c.holdReasons = c.holdReasons.map((r) => ({ ...r, active: false }));
    expect(swipeHoldReason(c)).toBeUndefined();
  });

  it("usage wording and delete blockers", () => {
    expect(usageText({ people: 3, requests: 12 })).toBe("3 people and 12 requests");
    expect(usageText({ people: 1, requests: 1, workOrders: 2 })).toBe("1 person, 1 request and 2 work orders");
    expect(usageText({})).toBe("");
    const usage = { departments: { it: { people: 1 } }, holdReasons: { dnd: { requests: 2 } } };
    expect(deleteBlocker("departments", "it", cat, usage)).toBe("Used by 1 person. Archive it instead.");
    expect(deleteBlocker("departments", "security", cat, usage)).toBe("Used by Noise complaint. Move or delete them first.");
    expect(deleteBlocker("departments", "spa", cat, usage)).toBe("");
    expect(deleteBlocker("holdReasons", "dnd", cat, usage)).toBe("Used by 2 requests on hold. Archive it instead.");
    expect(deleteBlocker("requestTypes", "towels", cat, usage)).toBe("");
  });

  it("isCatalog accepts only the full shape", () => {
    expect(isCatalog(SEED_CATALOG)).toBe(true);
    expect(isCatalog({ ...SEED_CATALOG, catalogRev: "1" })).toBe(false);
    expect(isCatalog({ catalogRev: 1, departments: [] })).toBe(false);
    expect(isCatalog(null)).toBe(false);
  });
});

describe("validateList mirrors the server", () => {
  const c = clone();
  const items = (list: keyof Catalog) => toPayload(toRows(c, list as never));

  it("accepts the seed and refuses each broken rule with the index", () => {
    for (const l of ["departments", "requestTypes", "bundles", "holdReasons", "jobTitles", "woFindings"] as const) expect(validateList(l, items(l), c)).toBeNull();
    const d = items("departments");
    expect(validateList("departments", [...d, { label: " ", short: "X", active: true }], c)).toEqual({ index: 6, error: "Enter a name of 1 to 40 characters." });
    expect(validateList("departments", [...d, { label: "IT ", short: "X", active: true }], c)).toEqual({ index: 6, error: "“IT” is already in this list." });
    expect(validateList("departments", [...d, { label: "Spa", short: "TOOLONG", active: true }], c)?.error).toBe("Enter a short code of 1 to 6 characters.");
    expect(validateList("departments", d.map((x) => ({ ...x, active: false })), c)).toEqual({ error: "Keep at least one active department." });
    expect(validateList("departments", d.map((x) => (x.key === "it" ? { ...x, active: false } : x)), c)).toEqual({ index: 2, error: "IT is used by Wi-Fi issue and TV not working. Archive them or move them to another department first." });
    const t = { label: "Massage", dept: "housekeeping", slaMin: 30, icon: "spa", active: true };
    const ts = items("requestTypes");
    expect(validateList("requestTypes", [...ts, { ...t, slaMin: 0 }], c)?.error).toBe("Set a target of 1 to 1440 minutes.");
    expect(validateList("requestTypes", [...ts, { ...t, slaMin: NaN }], c)?.error).toBe("Set a target of 1 to 1440 minutes.");
    expect(validateList("requestTypes", [...ts, { ...t, icon: "siren" }], c)?.error).toBe("Pick an icon from the list.");
    expect(validateList("requestTypes", [...ts, { ...t, dept: "nowhere" }], c)?.error).toBe("Pick a department.");
    const part = { name: "Fix", dept: "engineering", slaMin: 20 };
    const b = { label: "Flood", hint: "", parts: [part, { ...part, after: 1 }], active: true };
    expect(validateList("bundles", [...items("bundles"), b], c)).toEqual({ index: 1, error: "Step 2 can only wait for an earlier step." });
    expect(validateList("bundles", [...items("bundles"), { ...b, parts: [] }], c)?.error).toBe("A bundle has 1 to 6 steps.");
    expect(validateList("jobTitles", Array.from({ length: 61 }, (_, i) => ({ label: `T${i}`, active: true })), c)?.error).toBe("Keep the list to 60 job titles.");
  });
});

describe("list editor logic", () => {
  const c = clone();

  it("rows round-trip to the payload; dirty only after a change", () => {
    const rows = toRows(c, "departments");
    expect(toPayload(rows)).toEqual(c.departments);
    expect(isDirty(rows, c, "departments")).toBe(false);
    expect(isDirty(move(rows, 0, 1), c, "departments")).toBe(true);
  });

  it("move swaps neighbours and ignores the edges", () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    const same = [1, 2, 3];
    expect(move(same, 0, -1)).toBe(same);
    expect(move(same, 2, 1)).toBe(same);
  });

  it("blank rows point at the first active department and have no key", () => {
    const off = clone();
    off.departments[0] = { ...off.departments[0]!, active: false };
    const t = blankRow("requestTypes", off) as Draft & { dept: string; uid: string };
    expect(t.key).toBeUndefined();
    expect(t.dept).toBe("engineering");
    expect(blankRow("bundles", off)).toMatchObject({ parts: [{ dept: "engineering", slaMin: 20 }] });
    expect(blankRow("jobTitles", off)).toMatchObject({ label: "", active: true });
    expect(blankRow("jobTitles", off).uid).not.toBe(blankRow("jobTitles", off).uid);
  });

  it("removing a bundle step fixes the other steps' waits", () => {
    const p = (after?: number) => ({ name: "x", dept: "it", slaMin: 5, ...(after == null ? {} : { after }) });
    expect(removePart([p(), p(0), p(1), p(0)], 1)).toEqual([p(), { ...p(), after: undefined }, p(0)]);
  });

  it("short codes, archive questions, delete problems and summaries", () => {
    expect(suggestShort("Spa & Wellness")).toBe("SW");
    expect(suggestShort("Laundry")).toBe("LAU");
    expect(suggestShort("Guest Relations Office Team")).toBe("GRO");
    expect(suggestShort("  ")).toBe("");
    const usage = { departments: { housekeeping: { people: 2, requests: 12 } }, holdReasons: {} };
    const hk = toRows(c, "departments")[0]!;
    expect(archiveQuestion("departments", hk, usage)).toBe("2 people and 12 requests use Housekeeping; they keep working and still show its name. Archive it so nobody picks it for new work?");
    expect(archiveQuestion("departments", toRows(c, "departments")[5]!, usage)).toBe("");
    expect(deleteProblem("departments", hk, c, usage)).toBe("Used by 2 people and 12 requests. Archive it instead.");
    expect(deleteProblem("departments", blankRow("departments", c), c, usage)).toBe("");
    const archived = clone();
    archived.holdReasons[0] = { ...archived.holdReasons[0]!, active: false };
    expect(listSummary(archived, "holdReasons")).toBe("4 active · 1 archived");
    expect(listSummary({ ...c, jobTitles: [] }, "jobTitles")).toBe("None yet");
  });
});

describe("role gating", () => {
  it("only owners and managers on their own account get the Lists section", () => {
    expect(canEditLists("owner")).toBe(true);
    expect(canEditLists("manager")).toBe(true);
    expect(canEditLists("supervisor")).toBe(false);
    expect(canEditLists("device")).toBe(false);
    expect(showLists("owner", true)).toBe(true);
    expect(showLists("manager", true)).toBe(true);
    expect(showLists("owner", false)).toBe(false);
    expect(showLists("supervisor", true)).toBe(false);
    expect(showLists("device", true)).toBe(false);
  });
});

describe("the store follows the catalog", () => {
  beforeEach(() => resetApp(1_800_000_000_000));

  it("applySnapshot restores the catalog, with the seed when a server sends none", () => {
    const custom = { ...clone(), catalogRev: 4, departments: [...clone().departments, { key: "spa", label: "Spa", short: "SPA", repairs: false, active: true }] };
    const snap = { property: { id: "1", name: "A" }, properties: [], staff: [], requests: [], items: {}, wos: [], cleaning: [], incidents: [], handover: {}, seq: { t: 0, wo: 0, inc: 0, id: 0 }, at: 1 } as Snapshot;
    applySnapshot({ ...snap, catalog: custom });
    expect(app.get().catalog).toEqual(custom);
    applySnapshot(snap);
    expect(app.get().catalog).toBe(SEED_CATALOG);
  });

  it("logRequest uses custom request types and bundles and skips archived ones", () => {
    const c = clone();
    c.departments.push({ key: "spa", label: "Spa", short: "SPA", repairs: false, active: true });
    c.requestTypes.push({ key: "massage", label: "Massage", dept: "spa", slaMin: 60, icon: "spa", active: true });
    c.requestTypes = c.requestTypes.map((t) => (t.key === "towels" ? { ...t, active: false } : t));
    c.bundles.push({ key: "spa_day", label: "Spa day", hint: "", parts: [{ name: "Spa: massage", dept: "spa", slaMin: 90 }, { name: "Spa: tidy", dept: "housekeeping", slaMin: 20, after: 0 }], active: true });
    setCatalog(c);
    const id = logRequest({ room: "701", presets: ["massage", "towels"], bundle: "spa_day" });
    const req = app.get().requests.find((r) => r.id === id)!;
    const its = req.itemIds.map((i) => app.get().items[i]!);
    expect(its.map((i) => [i.name, i.dept, i.slaMin])).toEqual([["Massage", "spa", 60], ["Spa: massage", "spa", 90], ["Spa: tidy", "housekeeping", 20]]);
    expect(its[2]!.dependsOn).toBe(its[1]!.id);
  });
});

describe("repairs flag", () => {
  beforeEach(() => resetApp(1_800_000_000_000));

  it("only active departments that handle repairs take new work orders; new departments default to no", () => {
    const c = clone();
    expect(repairDepartments(c).map((d) => d.key)).toEqual(["engineering", "it"]);
    c.departments.push({ key: "grounds", label: "Grounds", short: "GRD", repairs: true, active: false });
    expect(canEscalate("grounds", c)).toBe(false);
    expect(canEscalate("housekeeping", c)).toBe(false);
    expect(canEscalate("it", c)).toBe(true);
    expect(blankRow("departments", c)).toMatchObject({ repairs: false });
  });

  it("validation: a boolean flag, and one active repairs department while work orders are open", () => {
    const c = clone();
    const d = toPayload(toRows(c, "departments"));
    const none = d.map((x) => ({ ...x, repairs: false }));
    expect(validateList("departments", none, c, 0)).toBeNull();
    expect(validateList("departments", none, c, 2)).toEqual({ error: "2 open work orders need a department that handles repairs. Keep at least one active one." });
    expect(validateList("departments", [...d, { label: "Spa", short: "SPA", repairs: "yes" as unknown as boolean, active: true }], c)).toEqual({ index: 6, error: "Choose whether it handles repairs." });
  });

  it("the store escalates by the flag", () => {
    const c = clone();
    c.departments = c.departments.map((x) => (x.key === "engineering" ? { ...x, repairs: false } : x.key === "housekeeping" ? { ...x, repairs: true } : x));
    setCatalog(c);
    const ac = logRequest({ room: "702", presets: ["ac", "towels"] });
    const [acItem, towels] = app.get().requests.find((r) => r.id === ac)!.itemIds;
    onSite(acItem!);
    onSite(towels!);
    expect(escalate(acItem!)).toBe(false);
    expect(escalate(towels!)).toBe(true);
    expect(app.get().wos[0]!.dept).toBe("housekeeping");
  });
});
