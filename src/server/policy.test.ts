import { describe, expect, it } from "vitest";
import { canInvite, canLeave, canManageStaff, needsStaff } from "./policy";

describe("role policy", () => {
  it("lets owners and managers manage staff, but not a device account", () => {
    expect(canManageStaff("owner")).toBe(true);
    expect(canManageStaff("manager")).toBe(true);
    expect(canManageStaff("device")).toBe(false);
  });

  it("lets only owners invite", () => {
    expect(canInvite("owner")).toBe(true);
    expect(canInvite("manager")).toBe(false);
    expect(canInvite("device")).toBe(false);
  });

  it("lets only managers leave a hotel", () => {
    expect(canLeave("manager")).toBe(true);
    expect(canLeave("owner")).toBe(false);
    expect(canLeave("device")).toBe(false);
  });

  it("makes a device account sign in a staff member before any command", () => {
    expect(needsStaff("device", null)).toBe(true);
    expect(needsStaff("device", "staff-1")).toBe(false);
    expect(needsStaff("manager", null)).toBe(false);
    expect(needsStaff("owner", null)).toBe(false);
  });
});
