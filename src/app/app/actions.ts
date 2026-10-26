"use server";

import { auth } from "@/lib/auth/server";
import { tx, type Q } from "@/lib/db";
import { resolveTenant, type Tenant } from "@/lib/tenant";
import type { Command, CommandResult, Snapshot } from "@/server/contract";
import { applyCommand } from "@/server/mutations";
import { loadSnapshot } from "@/server/snapshot";

export interface Member {
  name: string;
  role: Tenant["role"];
}
export interface Desk {
  snapshot: Snapshot;
  member: Member;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is calling? The session says who; the database says which hotel they may use. */
async function whoIsCalling(): Promise<{ tenant: Tenant; member: Member } | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const tenant = await tx(null, (q) => resolveTenant({ id: user.id, email: user.email, emailVerified: !!user.emailVerified }, q));
  if (!tenant || tenant === "unverified") return null;
  return { tenant, member: { name: user.name || user.email, role: tenant.role } };
}

async function pickProperty(q: Q, requested?: string): Promise<string | undefined> {
  if (requested && !UUID.test(requested)) return undefined;
  const r = requested
    ? await q("select id from properties where id = $1", [requested])
    : await q("select id from properties order by name limit 1");
  return r.rows[0]?.id;
}

/** The current state of one property, for the signed-in owner or manager. Null when not allowed. */
export async function loadDesk(propertyId?: string): Promise<Desk | null> {
  const who = await whoIsCalling();
  if (!who) return null;
  return tx(who.tenant.orgId, async (q) => {
    const pid = await pickProperty(q, propertyId);
    if (!pid) return null;
    return { snapshot: await loadSnapshot(q, who.tenant.orgId, pid), member: who.member };
  });
}

/** Apply one command. Each call is its own transaction with the org set, so RLS limits it to the hotel. */
export async function runCommand(propertyId: string, cmd: Command): Promise<CommandResult> {
  const who = await whoIsCalling();
  if (!who) return { ok: false, error: "Please sign in again." };
  if (!UUID.test(propertyId) || typeof cmd !== "object" || cmd === null || typeof cmd.type !== "string") {
    return { ok: false, error: "That request was not understood." };
  }
  return tx(who.tenant.orgId, (q) => applyCommand(q, { orgId: who.tenant.orgId, propertyId, actorStaffId: null }, cmd));
}
