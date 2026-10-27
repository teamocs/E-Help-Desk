"use server";

import { tx, type Q } from "@/lib/db";
import type { Command, CommandResult, Snapshot } from "@/server/contract";
import { applyCommand } from "@/server/mutations";
import { needsStaff } from "@/server/policy";
import { actingStaff, isUuid, whoIsCalling, type Member } from "@/server/session";
import { loadSnapshot } from "@/server/snapshot";

export type { Member };
export interface Desk {
  snapshot: Snapshot;
  member: Member;
  /** The staff member signed in with a PIN on this device, or null when the owner or manager is acting. */
  actor: string | null;
}

async function pickProperty(q: Q, requested?: string): Promise<string | undefined> {
  if (requested && !isUuid(requested)) return undefined;
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
    return { snapshot: await loadSnapshot(q, who.tenant.orgId, pid), member: who.member, actor: await actingStaff(q, who.userId, pid) };
  });
}

/** Apply one command. Each call is its own transaction with the org set, so RLS limits it to the hotel. */
export async function runCommand(propertyId: string, cmd: Command): Promise<CommandResult> {
  const who = await whoIsCalling();
  if (!who) return { ok: false, error: "Please sign in again." };
  if (!isUuid(propertyId) || typeof cmd !== "object" || cmd === null || typeof cmd.type !== "string") {
    return { ok: false, error: "That request was not understood." };
  }
  return tx(who.tenant.orgId, async (q) => {
    const actorStaffId = await actingStaff(q, who.userId, propertyId);
    // A shared phone's own account may not act as itself: someone must sign in with a PIN first.
    if (needsStaff(who.tenant.role, actorStaffId)) return { ok: false, error: "Sign in with your PIN first." } as const;
    return applyCommand(q, { orgId: who.tenant.orgId, propertyId, actorStaffId }, cmd);
  });
}
