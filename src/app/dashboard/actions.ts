"use server";

import { auth } from "@/lib/auth/server";
import { tx } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export type ActionResult = { ok: true } | { ok: false; error: string };

const NOT_SIGNED_IN: ActionResult = { ok: false, error: "Sign in first." };

async function sessionUser() {
  const { data: session } = await auth.getSession();
  const u = session?.user;
  return u ? { id: u.id, email: u.email, verified: !!u.emailVerified } : null;
}

/** The SQL functions raise plain messages meant for people (SQLSTATE P0001). Anything else stays in the log. */
function failure(e: unknown): ActionResult {
  if (e instanceof Error && (e as { code?: string }).code === "P0001") return { ok: false, error: e.message };
  console.error("dashboard action failed", e);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** First sign-in with no invite: create a hotel and become its owner. */
export async function createHotel(orgName: string, propertyName: string): Promise<ActionResult> {
  const u = await sessionUser();
  if (!u) return NOT_SIGNED_IN;
  if (typeof orgName !== "string" || typeof propertyName !== "string") return { ok: false, error: "Enter a hotel name and a property name." };
  try {
    await tx(null, (q) => q("select * from create_org($1, $2, $3, $4, $5)", [u.id, u.email, u.verified, orgName, propertyName]));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Which hotel the caller owns, from the session. The browser never says which hotel. */
async function ownedOrg() {
  const u = await sessionUser();
  if (!u) return null;
  const tenant = await tx(null, (q) => resolveTenant({ id: u.id, email: u.email, emailVerified: u.verified }, q));
  if (!tenant || tenant === "unverified" || tenant.role !== "owner") return null;
  return { user: u, orgId: tenant.orgId };
}

export async function inviteManager(email: string): Promise<ActionResult> {
  try {
    const o = await ownedOrg();
    if (!o) return { ok: false, error: "Only an owner can invite people." };
    await tx(o.orgId, (q) => q("select invite_member($1, $2, $3, 'manager')", [o.orgId, o.user.id, typeof email === "string" ? email : ""]));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeInvite(email: string): Promise<ActionResult> {
  try {
    const o = await ownedOrg();
    if (!o) return { ok: false, error: "Only an owner can revoke invites." };
    await tx(o.orgId, (q) => q("select revoke_invite($1, $2, $3)", [o.orgId, o.user.id, typeof email === "string" ? email : ""]));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** A manager leaves the hotel they were invited to. Owners cannot. */
export async function leaveHotel(): Promise<ActionResult> {
  const u = await sessionUser();
  if (!u) return NOT_SIGNED_IN;
  try {
    await tx(null, (q) => q("select leave_org($1)", [u.id]));
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
