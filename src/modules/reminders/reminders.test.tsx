import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, initialState, resetApp } from "../../domain/store";
import { remote } from "../../domain/remote";
import { memoryOutbox } from "../../domain/outbox";
import type { AnyCommand } from "../../domain/contract";
import { MODULES } from "../registry";
import { Reminders } from "./Reminders";
import { addReminder, assignable, doneReminder, filterReminders, isOverdue, linkOptions, reminderBadge, remindersOf, type Reminder } from "./data";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const HOUR = 3_600_000;
const rem = (n: number, status: Reminder["status"], dueAt: number | undefined, extra: Partial<Reminder> = {}): Reminder => ({ id: `r${n}`, desc: `Reminder ${n}`, status, dueAt, createdAt: 1, ...extra });
const seed = (list: Reminder[]) => app.set(() => ({ ...initialState(), me: "s-maria", modules: { reminders: { list, counts: { pending: 0 } } } }));

afterEach(() => {
  remote.disable();
  resetApp();
});

describe("overdue, filters and the badge", () => {
  const now = Date.now();
  it("overdue is pending and past its time; completed, undated and future ones are not", () => {
    expect(isOverdue(rem(1, "pending", now - 1), now)).toBe(true);
    expect(isOverdue(rem(2, "pending", now + HOUR), now)).toBe(false);
    expect(isOverdue(rem(3, "pending", undefined), now)).toBe(false);
    expect(isOverdue(rem(4, "completed", now - HOUR), now)).toBe(false);
  });
  it("filters All, Pending and Completed; the badge is pending", () => {
    seed([rem(1, "pending", now), rem(2, "completed", now), rem(3, "pending", undefined)]);
    const list = remindersOf(app.get());
    expect(filterReminders(list, "all")).toHaveLength(3);
    expect(filterReminders(list, "pending").map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(filterReminders(list, "completed").map((r) => r.id)).toEqual(["r2"]);
    expect(reminderBadge(app.get())).toBe(2);
    expect(MODULES.find((m) => m.id === "reminders")!.badge!(app.get())).toBe(2);
    doneReminder("r1");
    expect(reminderBadge(app.get())).toBe(1);
    expect(remindersOf(app.get()).find((r) => r.id === "r1")).toMatchObject({ status: "completed", completedBy: "s-maria" });
  });
  it("only help-desk-and-above staff can be assigned", () => {
    const staff = [{ role: "hdo", id: "a" }, { role: "staff", id: "b" }, { role: "supervisor", id: "c" }, { role: "hdo", id: "member" }] as never[];
    expect(assignable(staff).map((p: { id: string }) => p.id)).toEqual(["a", "c"]);
  });
});

describe("links and commands", () => {
  it("offers the requests, work orders and inquiries the desk holds, and any other module's records that have an id and a number", () => {
    app.set(() => ({
      ...initialState(), me: "s-maria",
      modules: { inquiries: { list: [{ id: "q1", no: "I-0001", name: "Ana", type: "external", desc: "x", status: "active", createdAt: 1, history: [] }, { id: "q2", no: "", name: "Saving", type: "external", desc: "x", status: "active", createdAt: 1, history: [] }], counts: { active: 1, noted: 0 } }, housestatus: { list: [{ id: "h1", no: "HS-0003" }, { id: 7 }] } },
    }));
    const opts = linkOptions(app.get());
    expect(opts.find((o) => o.type === "request")?.text).toMatch(/^T-\d+ Room \d+/);
    expect(opts.find((o) => o.type === "workorder")?.text).toMatch(/^WO-\d+ /);
    expect(opts.filter((o) => o.type === "inquiry").map((o) => o.text)).toEqual(["I-0001 Ana"]);
    expect(opts.filter((o) => o.type === "housestatus")).toEqual([{ key: "housestatus:h1", type: "housestatus", id: "h1", label: "HS-0003", text: "HS-0003" }]);
  });

  it("addReminder shows the card at once, soonest first, and sends no link keys when there is none", async () => {
    const sent: AnyCommand[] = [];
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox: memoryOutbox() });
    const now = Date.now();
    seed([rem(1, "pending", now + 5 * HOUR), rem(2, "completed", now)]);
    const id = addReminder({ desc: " Pool check ", assignee: "", dueAt: now + HOUR, link: null, notes: " " });
    expect(remindersOf(app.get()).map((r) => r.id)).toEqual([id, "r1", "r2"]);
    addReminder({ desc: "Linked", assignee: "s-rizza", dueAt: null, link: { key: "request:q", type: "request", id: "q", label: "T-0102", text: "T-0102 Room 305" }, notes: "Parts?" });
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent[0]).toMatchObject({ type: "addReminder", reminderId: id, desc: "Pool check", dueAt: now + HOUR });
    for (const k of ["assignee", "notes", "linkType", "linkId", "linkLabel"]) expect(sent[0]).not.toHaveProperty(k);
    expect(sent[1]).toMatchObject({ assignee: "s-rizza", linkType: "request", linkId: "q", linkLabel: "T-0102", notes: "Parts?" });
    expect(sent[1]).not.toHaveProperty("dueAt");
  });
});

describe("the screen", () => {
  it("has the prototype's wording: filters, New Reminder, All HD Staff, OVERDUE, the link tag, notes and Done on pending cards only", () => {
    const now = Date.now();
    seed([
      rem(1, "pending", now - HOUR, { assignee: "s-maria", notes: "Parts?", link: { type: "request", id: "x", label: "T-0102" } }),
      rem(2, "pending", now + 24 * HOUR),
      rem(3, "completed", now - 5 * HOUR, { completedAt: now - HOUR }),
    ]);
    const raw = renderToStaticMarkup(<Reminders />);
    const html = text(raw);
    for (const w of ["Reminders", "Follow-ups", "New Reminder", "All", "Pending", "Completed", "All HD Staff", "OVERDUE", "Request T-0102", "Parts?", "2 pending · 1 overdue", "completed"]) expect(html).toContain(w);
    expect(raw.match(/aria-label="Done: /g)).toHaveLength(2);
    expect(raw).toContain("is-late");
    expect(raw).toContain("is-done");
  });

  it("with nothing says what it is for", () => {
    app.set(() => ({ ...initialState(), me: "s-maria" }));
    expect(text(renderToStaticMarkup(<Reminders />))).toContain("No reminders");
  });
});
