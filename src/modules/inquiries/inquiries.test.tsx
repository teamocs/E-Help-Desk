import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { app, initialState, resetApp } from "../../domain/store";
import { remote } from "../../domain/remote";
import { memoryOutbox } from "../../domain/outbox";
import type { AnyCommand } from "../../domain/contract";
import { MODULES } from "../registry";
import { Inquiries } from "./Inquiries";
import { InquiryDetail } from "./InquiryDetail";
import { NO_FILTER, closeInquiry, filterInquiries, inquiriesOf, inquiryBadge, logInquiry, noteInquiry, preset, reopenInquiry, sortInquiries, type Inquiry } from "./data";
import { addDays, clock, dayKey, dayStart, fromInput, toInput, when } from "./hotelTime";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const MIN = 60_000;
const inq = (n: number, status: Inquiry["status"], createdAt: number, extra: Partial<Inquiry> = {}): Inquiry => ({ id: `i${n}`, no: `I-000${n}`, name: `Guest ${n}`, type: "in_house", desc: `Question ${n}`, status, createdAt, history: [{ at: createdAt, by: "s-maria", what: "Logged" }], ...extra });
const seed = (list: Inquiry[], now = Date.now()) => app.set(() => ({ ...initialState(now), me: "s-maria", modules: { inquiries: { list, counts: { active: 0, noted: 0 } } } }));

afterEach(() => {
  remote.disable();
  resetApp();
});

describe("the hotel's clock (Asia/Manila), never UTC's", () => {
  // 20:00 UTC on Oct 30 is 04:00 on Oct 31 in Manila: the UTC date is still "yesterday" for the hotel's first hours.
  const early = Date.UTC(2026, 9, 30, 20, 0);
  it("names the day, the time and the input value in hotel time", () => {
    expect(dayKey(early)).toBe("2026-10-31");
    expect(clock(early)).toBe("4:00 AM");
    expect(toInput(early)).toBe("2026-10-31T04:00");
    expect(fromInput("2026-10-31T04:00")).toBe(early);
    expect(fromInput("")).toBeNull();
    expect(fromInput("2026-13-45T99:00")).toBeNull();
    expect(dayStart("2026-10-31")).toBe(Date.UTC(2026, 9, 30, 16, 0));
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("shows time only for today, the date for another day", () => {
    expect(when(early, early + 3600_000)).toBe("4:00 AM");
    expect(when(early - 86_400_000, early)).toBe("Oct 30, 4:00 AM");
    expect(when(early - 400 * 86_400_000, early)).toMatch(/2025, /);
  });
});

describe("inquiry filters", () => {
  const now = Date.UTC(2026, 9, 30, 20, 30); // 4:30 AM on Oct 31 in Manila
  const list = [
    inq(1, "active", now - 30 * MIN), // 4:00 AM Oct 31 (today, hotel time) although the UTC date is Oct 30
    inq(2, "noted", now - 5 * 3600_000), // 11:30 PM Oct 30 in Manila
    inq(3, "done", now - 2 * 86_400_000, { closedAt: now - 2 * 86_400_000 + 2 * MIN, quick: true }),
    inq(4, "done", now - 9 * 86_400_000),
  ];
  const ids = (l: Inquiry[]) => l.map((i) => i.id);
  it("Today means the hotel's day: an inquiry logged at 4 AM local shows (the prototype's UTC bug hides it)", () => {
    expect(ids(filterInquiries(list, { status: "all", ...preset("today", now) }))).toEqual(["i1"]);
    expect(dayKey(now)).toBe("2026-10-31");
  });
  it("Week is today and the six days before; All clears the range", () => {
    expect(ids(filterInquiries(list, { status: "all", ...preset("week", now) }))).toEqual(["i1", "i2", "i3"]);
    expect(preset("all", now)).toEqual({ from: "", to: "" });
  });
  it("Active is everything not done (noted too); Done is done; both ends of a range are included", () => {
    expect(ids(filterInquiries(list, { ...NO_FILTER, status: "active" }))).toEqual(["i1", "i2"]);
    expect(ids(filterInquiries(list, { ...NO_FILTER, status: "done" }))).toEqual(["i3", "i4"]);
    expect(ids(filterInquiries(list, { status: "all", from: "2026-10-30", to: "2026-10-30" }))).toEqual(["i2"]);
  });
  it("sorts open ones first, newest first, then done ones", () => {
    expect(ids(sortInquiries(list))).toEqual(["i1", "i2", "i3", "i4"]);
    expect(ids(sortInquiries([list[2], list[1], list[0]]))).toEqual(["i1", "i2", "i3"]);
  });
});

describe("badge and commands", () => {
  it("the badge counts active plus noted, and follows an optimistic change", async () => {
    const t = Date.now();
    seed([inq(1, "active", t - MIN), inq(2, "noted", t - 2 * MIN), inq(3, "done", t - 3 * MIN)]);
    const mod = MODULES.find((m) => m.id === "inquiries")!;
    expect(mod.badge!(app.get())).toBe(2);
    expect(inquiryBadge(app.get())).toBe(2);
    closeInquiry("i1");
    expect(inquiryBadge(app.get())).toBe(1);
    expect(inquiriesOf(app.get()).find((i) => i.id === "i1")).toMatchObject({ status: "done", quick: true });
    reopenInquiry("i1");
    expect(inquiriesOf(app.get()).find((i) => i.id === "i1")).toMatchObject({ status: "active", quick: false });
    expect(inquiriesOf(app.get()).find((i) => i.id === "i1")?.closedAt).toBeUndefined();
  });

  it("Note only applies to an active inquiry; a quick close needs 6 minutes or less", () => {
    const t = Date.now();
    seed([inq(1, "noted", t), inq(2, "active", t - 7 * MIN)]);
    noteInquiry("i1");
    expect(inquiriesOf(app.get())[0].history).toHaveLength(1);
    closeInquiry("i2");
    expect(inquiriesOf(app.get())[1]).toMatchObject({ status: "done", quick: false });
  });

  it("logInquiry shows the row at once and sends one idempotent command with a fresh opId; a blank room and officer are left out", async () => {
    const sent: AnyCommand[] = [];
    remote.enable({ run: async (c) => { sent.push(c); return { ok: true, applied: true }; }, load: () => new Promise(() => {}) }, { snapshot: () => {}, error: () => {} }, { scope: "p", outbox: memoryOutbox() });
    app.set(() => ({ ...initialState(), me: "s-maria" }));
    const id = logInquiry({ type: "external", name: " Maria Cruz ", room: "  ", hdo: "", desc: " Quote " });
    expect(inquiriesOf(app.get())[0]).toMatchObject({ id, no: "", name: "Maria Cruz", type: "external", desc: "Quote", status: "active" });
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "logInquiry", inquiryId: id, contactType: "external", name: "Maria Cruz", desc: "Quote" });
    expect(sent[0]).not.toHaveProperty("room");
    expect(sent[0]).not.toHaveProperty("hdo");
    expect(sent[0].opId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("the screen", () => {
  const t = Date.now();
  const seeded = () => seed([inq(1, "active", t - 5 * MIN, { room: "412" }), inq(2, "noted", t - 6 * MIN), inq(3, "done", t - 9 * MIN, { quick: true, closedAt: t - 7 * MIN })]);

  it("has the prototype's wording: the New Inquiry button, All/Active/Done, From/To, Today/Week/All, and Note/Done/Undo as the status allows", () => {
    seeded();
    const html = text(renderToStaticMarkup(<Inquiries />));
    for (const w of ["Inquiries", "Guest &amp; external", "New Inquiry", "All", "Active", "Done", "From", "To", "Today", "Week", "I-0001", "Room 412", "in house", "active", "noted", "done", "2 open"]) expect(html).toContain(w);
    const raw = renderToStaticMarkup(<Inquiries />);
    expect(raw).toContain('aria-label="Note I-0001"');
    expect(raw).toContain('aria-label="Done I-0001"');
    expect(raw).not.toContain('aria-label="Undo I-0001"');
    expect(raw).toContain('aria-label="Undo I-0002"'); // noted: Undo and Done
    expect(raw).toContain('aria-label="Done I-0002"');
    expect(raw).toContain('aria-label="Undo I-0003"'); // done: Undo only
    expect(raw).not.toContain('aria-label="Done I-0003"');
    expect(raw).toContain("closed within 6 minutes");
  });

  it("with nothing logged says what the screen is for and offers the next step", () => {
    app.set(() => ({ ...initialState(), me: "s-maria" }));
    const html = text(renderToStaticMarkup(<Inquiries />));
    expect(html).toContain("No inquiries yet");
    expect(html).toContain("New Inquiry");
  });

  it("the detail pane shows everything, the history and the actions; a missing one says so", () => {
    seeded();
    const html = text(renderToStaticMarkup(<InquiryDetail id="i2" />));
    for (const w of ["I-0002", "In-house Guest", "Question 2", "History", "Logged", "Undo", "Done"]) expect(html).toContain(w);
    expect(text(renderToStaticMarkup(<InquiryDetail id="gone" />))).toContain("no longer in the list");
  });

  it("is a module the sidebar knows: label, icon, badge label and a detail pane", () => {
    const m = MODULES.find((x) => x.id === "inquiries")!;
    expect([m.label, m.icon, m.badgeLabel]).toEqual(["Inquiries", "chat", "active"]);
    expect(m.detail?.title).toBe("Inquiry");
  });
});
