import { cookies } from "next/headers";
import { auth } from "@/lib/auth/server";
import { tx, type Q } from "@/lib/db";
import { resolveTenant, type Tenant } from "@/lib/tenant";
import { ACTOR_COOKIE, readActor } from "./actor";

export interface Member {
  name: string;
  role: Tenant["role"];
}

export interface Caller {
  tenant: Tenant;
  member: Member;
  userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Who is calling? The session says who; the database says which hotel they may use. */
export async function whoIsCalling(): Promise<Caller | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const tenant = await tx(null, (q) => resolveTenant({ id: user.id, email: user.email, emailVerified: !!user.emailVerified }, q));
  if (!tenant || tenant === "unverified") return null;
  return { tenant, member: { name: user.name || user.email, role: tenant.role }, userId: user.id };
}

/**
 * The staff member who has signed in with a PIN on this device, or null when the owner or manager account
 * is acting. Checked against the signed cookie, the user, the property, and that the person is still active.
 */
export async function actingStaff(q: Q, userId: string, propertyId: string): Promise<string | null> {
  const a = readActor((await cookies()).get(ACTOR_COOKIE)?.value, userId, propertyId);
  if (!a || !isUuid(a.s)) return null;
  const found = await q("select 1 from staff where id = $1 and active", [a.s]);
  return found.rows[0] ? a.s : null;
}
