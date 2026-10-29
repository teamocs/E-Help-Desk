import { describe, expect, it } from "vitest";
import { tabsFor } from "./App";
import { connState } from "./ui/kit";

describe("tabs by role", () => {
  it("a shared phone gets the four work screens; everyone else also gets Insights and Settings", () => {
    expect(tabsFor("device").map((n) => n.tab)).toEqual(["requests", "maintenance", "housekeeping", "handover"]);
    for (const role of ["owner", "manager", "supervisor"] as const) {
      expect(tabsFor(role).map((n) => n.tab)).toEqual(["requests", "maintenance", "housekeeping", "handover", "insights", "settings"]);
    }
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
