import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, initialState, resetApp, setUI, ui } from "../../domain/store";
import { remote } from "../../domain/remote";
import { memoryOutbox } from "../../domain/outbox";
import type { AnyCommand } from "../../domain/contract";
import type { Incident } from "../../domain/types";
import { Safety } from "../../screens/Safety";
import { Crisis } from "./Crisis";
import crisis from "./index";
import { SEED_LISTS, casesOf, closeCase, crisisUI, emptyFields, fromLocalInput, keyOf, logCase, openCase, openCaseFromAlert, problemOf, toLocalInput, unresolvedCount, when, type CrisisCase } from "./model";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const t0 = Date.parse("2026-10-30T13:50:00Z"); // 9:50 PM in Manila
const alert = (over: Partial<Incident> = {}): Incident => ({ id: "x1", no: "INC-001", hazard: "smoke", rooms: ["412"], createdAt: t0, text: "smoke in the hall", status: "active", log: [], ...over });
const kase = (over: Partial<CrisisCase> = {}): CrisisCase => ({
  id: "c1", no: "CR-0001", code: "medical_emergency", category: null, reportedBy: "FO Staff 1", whoType: "in_house_guest", who: "Mr. Park", location: "lobby", place: null,
  what: "Guest fainted in lobby", occurredAt: t0, status: "active", resolution: null, resolvedAt: null, incidentId: null, incident: null, called911: null,
  loggedBy: "Maria Santos", createdAt: t0, updates: [{ at: t0 + 60_000, by: "Maria Santos", text: "Ambulance called" }], ...over,
});
const withCases = (cases: CrisisCase[], incidents: Incident[] = []) => app.set((s) => ({ ...s, incidents, modules: { ...s.modules, crisis: { cases } } }));
const asOwner = () => setUI({ account: { name: "Mr. Reyes", role: "owner", hotel: "", logoUrl: "", modules: { crisis: "full" } } });
const asDesk = (role: "hdo" | "supervisor") => {
  setUI({ account: { name: "Front desk phone", role: "device", hotel: "", logoUrl: "", modules: {} } });
  app.set((s) => ({ ...s, me: "p1", staff: [...s.staff.filter((p) => p.id !== "p1"), { id: "p1", name: "Pat Cruz", initials: "PC", role, title: "Desk", dept: "frontdesk", onShift: true }] as never }));
};
async function capture(): Promise<AnyCommand[]> {
  const sent: AnyCommand[] = [];
  remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox: memoryOutbox() });
  return sent;
}
const settle = async (sent: AnyCommand[], n: number) => { for (let i = 0; i < 60 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 5)); };

afterEach(() => {
  remote.disable();
  resetApp();
  openCase(undefined);
  setUI({ sheet: null, tab: "dashboard", account: { name: "", role: "device", hotel: "", logoUrl: "" } });
});

describe("crisis page", () => {
  it("starts with CALL 911 / RADIO FIRST, THEN LOG, keeps the alert cards (with Open a case) and lists the cases", () => {
    asOwner();
    withCases([kase(), kase({ id: "c2", no: "CR-0002", code: "guest_complaint", category: "noise", status: "monitoring", what: null, incidentId: "x9" })], [alert(), alert({ id: "x9", no: "INC-002", status: "resolved" })]);
    const html = renderToStaticMarkup(<Crisis />);
    const t = text(html);
    expect(t.indexOf("CALL 911 / RADIO FIRST, THEN LOG.")).toBeLessThan(t.indexOf("INC-001"));
    for (const s of ["INC-001", "Smoke or fire", "Room 412", "Open the alert", "Staff notified (not BFP/911)", "BFP/911 call not recorded", "Open a case", "Case CR-0002"]) expect(t).toContain(s);
    for (const s of ["CR-0001 · 10-9 Medical Emergency", "Lobby", "Oct 30, 9:50 PM", "Guest fainted in lobby", "Reported by FO Staff 1", "CR-0002 · 10-28 Guest Complaint", "Noise", "What happened: not written yet", "Monitoring", "Log a case"]) expect(t).toContain(s);
    expect(html).toContain('class="cr-chip"'); // the linked alert chip on CR-0002
    expect(html).not.toMatch(/cr-card active[^"]*bad/); // cases stay calm: no alarm colour on a case
  });

  it("filters: Open by default; Closed shows the closed ones", () => {
    asOwner();
    withCases([kase(), kase({ id: "c3", no: "CR-0003", status: "resolved", resolution: "Guest released from hospital" })]);
    const t = text(renderToStaticMarkup(<Crisis />));
    expect(t).toContain("CR-0001");
    expect(t).not.toContain("CR-0003 ·");
    expect(t).toMatch(/Closed\s+1/);
  });

  it("with nothing yet says what the page is for and offers Log a case", () => {
    asOwner();
    const t = text(renderToStaticMarkup(<Crisis />));
    expect(t).toContain("No crisis cases and no safety alerts");
    expect(t).toContain("Log a case");
  });

  it("a case opens with its details, updates thread, 911 field and actions; a desk officer cannot close it", () => {
    asDesk("hdo");
    withCases([kase()]);
    openCase("c1");
    let t = text(renderToStaticMarkup(<Crisis />));
    for (const s of ["CR-0001", "In-house Guest", "Mr. Park (In-house Guest)", "Updates (1)", "Ambulance called", "BFP / 911 called by ____ at ____", "I called 911 just now", "Update", "Monitor", "Edit", "Close (supervisor or manager)", "needs a supervisor or manager"]) expect(t).toContain(s);
    expect(renderToStaticMarkup(<Crisis />)).toMatch(/disabled=""[^>]*>Close \(supervisor or manager\)/);
    // A supervisor's PIN on the same phone can close.
    asDesk("supervisor");
    t = text(renderToStaticMarkup(<Crisis />));
    expect(t).not.toContain("Close (supervisor or manager)");
    expect(t).toMatch(/Close/);
  });

  it("a linked case shows the alert and the alert's own 911 record (never a copy)", () => {
    asOwner();
    withCases([kase({ incidentId: "x1", incident: { id: "x1", no: "INC-001", hazard: "smoke", rooms: ["412"], status: "active", createdAt: t0, called911: null } })], [alert({ called911: { by: "Maria Santos", at: "2026-10-30T13:52:00.000Z" } })]);
    openCase("c1");
    const t = text(renderToStaticMarkup(<Crisis />));
    expect(t).toContain("Safety alert INC-001 · Smoke or fire · Room 412");
    expect(t).toContain("Staff notified (not BFP/911)");
    expect(t).toContain("BFP/911 called by Maria Santos at Oct 30, 9:52 PM");
    expect(t).not.toContain("Link a safety alert");
  });
});

describe("crisis rules", () => {
  it("open requires only a code (or a category); what happened may wait", () => {
    const codes = SEED_LISTS.crisisCodes;
    const f = emptyFields(Date.now() - 60_000);
    expect(problemOf(f, codes)).toBe("Choose a radio code or a complaint category");
    expect(problemOf({ ...f, code: "fire" }, codes)).toBeNull();
    expect(problemOf({ ...f, category: "noise" }, codes)).toBeNull();
    expect(problemOf(f, codes, true)).toBeNull(); // opened from an alert
    expect(problemOf({ ...f, code: "fire", category: "noise" }, codes)).toBe("A complaint category goes with a guest complaint code");
    expect(problemOf({ ...f, code: "guest_complaint", category: "noise" }, codes)).toBeNull();
    expect(problemOf({ ...f, code: "fire", occurred: "" }, codes)).toBe("Enter the date and time");
  });

  it("keys match the server's (made from the labels), times are Manila time", () => {
    expect(SEED_LISTS.crisisCodes.map((c) => c.key)).toContain("medical_emergency");
    expect(keyOf("Reception / Front Desk")).toBe("reception_front_desk");
    expect(keyOf("AC / Temperature")).toBe("ac_temperature");
    expect(when(t0)).toBe("Oct 30, 9:50 PM");
    expect(toLocalInput(t0)).toBe("2026-10-30T21:50");
    expect(fromLocalInput("2026-10-30T21:50")).toBe("2026-10-30T21:50:00+08:00");
    expect(Date.parse(fromLocalInput(toLocalInput(t0))!)).toBe(t0);
    expect(fromLocalInput("nope")).toBeNull();
  });

  it("badge: unresolved cases plus active alerts no open case covers (an alert and its case count once)", () => {
    app.set(() => initialState());
    withCases([kase(), kase({ id: "c2", status: "monitoring", incidentId: "x1" }), kase({ id: "c3", status: "resolved" })], [alert(), alert({ id: "x2" }), alert({ id: "x3", status: "resolved" })]);
    expect(unresolvedCount(app.get())).toBe(3); // c1, c2 (covers x1), x2
    expect(crisis.badge!(app.get())).toBe(3);
    withCases([], [alert()]);
    expect(crisis.badge!(app.get())).toBe(1); // until a case exists, the active alert still counts
  });
});

describe("crisis commands", () => {
  it("log, close and the rest go through the outbox with a fresh opId, and change the list at once", async () => {
    const sent = await capture();
    const id = logCase({ ...emptyFields(Date.now() - 60_000), code: "fire", what: "Kitchen hood" });
    expect(casesOf(app.get())[0]).toMatchObject({ id, no: "CR-0001", code: "fire", status: "active", what: "Kitchen hood" });
    closeCase(id, "  Put out with the extinguisher ");
    expect(casesOf(app.get())[0]).toMatchObject({ status: "resolved", resolution: "Put out with the extinguisher" });
    await settle(sent, 2);
    expect(sent.map((c) => c.type)).toEqual(["logCrisis", "closeCrisis"]);
    expect(sent[0]).toMatchObject({ caseId: id, code: "fire", what: "Kitchen hood" });
    expect(sent[0]).not.toHaveProperty("category"); // empty fields are left out
    expect((sent[0] as unknown as { occurredAt: string }).occurredAt).toMatch(/\+08:00$/);
    expect(sent[1]).toMatchObject({ caseId: id, resolution: "  Put out with the extinguisher " });
    expect(sent[0].opId).not.toBe(sent[1].opId);
  });

  it("Open a case on an alert: one tap, linked, pre-filled, and opened on the Crisis page; twice opens the same case", async () => {
    const sent = await capture();
    const inc = alert({ hazard: "medical", rooms: ["412", "414"], text: "hindi makahinga" });
    app.set((s) => ({ ...s, incidents: [inc] }));
    setUI({ sheet: "incident", focusSafetyId: "x1" });
    const id = openCaseFromAlert(inc);
    expect(casesOf(app.get())[0]).toMatchObject({ id, code: "medical_emergency", location: "room", place: "412, 414", incidentId: "x1", occurredAt: t0, what: "Medical distress: “hindi makahinga”" });
    expect(ui.get()).toMatchObject({ tab: "crisis", sheet: null });
    expect(crisisUI.get().open).toBe(id);
    expect(openCaseFromAlert(inc)).toBe(id);
    await settle(sent, 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "logCrisis", caseId: id, incidentId: "x1", code: "medical_emergency", place: "412, 414" });
  });
});

describe("the safety takeover", () => {
  it("keeps 911 first, the 911 field, Staff notified and the sign-off rule; adds only Open a case", () => {
    app.set((s) => ({ ...s, incidents: [alert()], me: "s-maria" }));
    setUI({ sheet: "incident", focusSafetyId: "x1" });
    let t = text(renderToStaticMarkup(<Safety />));
    for (const s of ["CALL 911 / RADIO FIRST, THEN LOG.", "Staff notified (not BFP/911)", "BFP / 911 called by ____ at ____", "I called 911 just now", "Acknowledge and keep open", "Downgrade to false alarm (logged)", "Resolve (manager sign-off required)", "Open a case (crisis log)"]) expect(t).toContain(s);
    withCases([kase({ no: "CR-0007", incidentId: "x1" })], [alert()]);
    t = text(renderToStaticMarkup(<Safety />));
    expect(t).toContain("Open case CR-0007");
  });
});
