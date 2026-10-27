"use server";

import { cookies } from "next/headers";
import { tx } from "@/lib/db";
import { ACTOR_COOKIE, ACTOR_HOURS, signActor } from "@/server/actor";
import { canManageStaff } from "@/server/policy";
import { actingStaff, isUuid, whoIsCalling } from "@/server/session";
import { changePin, checkPin, createStaff, deactivateStaff, type Outcome, type StaffInput } from "@/server/staff";

const SIGN_IN_AGAIN = { ok: false, error: "Please sign in again." } as const;
const NOT_UNDERSTOOD = { ok: false, error: "That request was not understood." } as const;
const NO_MATCH = { ok: false, error: "That name and PIN do not match." } as const;
const DEVICE_DENIED = { ok: false, error: "Shared-phone accounts cannot change staff. Ask a manager." } as const;
const MANAGER_ONLY = { ok: false, error: "Switch back to the manager account to change staff." } as const;

// Staff changes need the owner or manager account acting, not a staff member on a shared device.
// The device account is the trust root: "back to manager" has no PIN yet (see docs/ORCHESTRATION.md).

export async function addStaff(propertyId: string, input: StaffInput, pin: string): Promise<Outcome<{ id: string }>> {
  const who = await whoIsCalling();
  if (!who) return SIGN_IN_AGAIN;
  if (!canManageStaff(who.tenant.role)) return DEVICE_DENIED;
  if (!isUuid(propertyId) || typeof input !== "object" || input === null || typeof pin !== "string") return NOT_UNDERSTOOD;
  const clean: StaffInput = { name: String(input.name), title: String(input.title), role: String(input.role), dept: input.dept === null ? null : String(input.dept) };
  return tx(who.tenant.orgId, async (q) => {
    if (await actingStaff(q, who.userId, propertyId)) return MANAGER_ONLY;
    return createStaff(q, who.tenant.orgId, clean, pin);
  });
}

export async function setStaffPin(propertyId: string, staffId: string, pin: string): Promise<Outcome> {
  const who = await whoIsCalling();
  if (!who) return SIGN_IN_AGAIN;
  if (!canManageStaff(who.tenant.role)) return DEVICE_DENIED;
  if (!isUuid(propertyId) || !isUuid(staffId) || typeof pin !== "string") return NOT_UNDERSTOOD;
  return tx(who.tenant.orgId, async (q) => {
    if (await actingStaff(q, who.userId, propertyId)) return MANAGER_ONLY;
    return changePin(q, staffId, pin);
  });
}

export async function removeStaff(propertyId: string, staffId: string): Promise<Outcome> {
  const who = await whoIsCalling();
  if (!who) return SIGN_IN_AGAIN;
  if (!canManageStaff(who.tenant.role)) return DEVICE_DENIED;
  if (!isUuid(propertyId) || !isUuid(staffId)) return NOT_UNDERSTOOD;
  return tx(who.tenant.orgId, async (q) => {
    if (await actingStaff(q, who.userId, propertyId)) return MANAGER_ONLY;
    return deactivateStaff(q, staffId);
  });
}

/** Check a staff PIN and, if right, make that person the acting staff member on this device for one shift. */
export async function pinSignIn(propertyId: string, staffId: string, pin: string): Promise<Outcome<{ staffId: string }>> {
  const who = await whoIsCalling();
  if (!who) return SIGN_IN_AGAIN;
  if (!isUuid(propertyId) || !isUuid(staffId) || typeof pin !== "string") return NO_MATCH;
  const result = await tx(who.tenant.orgId, async (q) => {
    const prop = await q("select 1 from properties where id = $1", [propertyId]);
    return prop.rows[0] ? checkPin(q, staffId, who.userId, pin) : NO_MATCH;
  });
  if (!result.ok) return result;
  (await cookies()).set(ACTOR_COOKIE, signActor({ u: who.userId, p: propertyId, s: staffId, exp: Date.now() + ACTOR_HOURS * 3600_000 }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACTOR_HOURS * 3600,
  });
  return { ok: true, staffId };
}

/** Back to the owner or manager account acting. */
export async function pinSignOut(): Promise<{ ok: true }> {
  (await cookies()).delete(ACTOR_COOKIE);
  return { ok: true };
}
