import type { Q } from "./db";

export interface Tenant {
  orgId: string;
  role: "owner" | "manager";
}

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Maps a signed-in Neon Auth user to an org.
 * - Already linked: return it.
 * - Not linked and the email is not verified: ask for verification. Nothing is claimed.
 * - Not linked and verified: claim the invited membership for that email, once.
 * - Otherwise: not invited.
 * Runs with no org set (`tx(null, ...)`) because the org is what we are looking for.
 */
export async function resolveTenant(user: AuthUser, q: Q): Promise<Tenant | "unverified" | null> {
  const known = await q("select org_id, role from member_for_user($1)", [user.id]);
  if (known.rows[0]) return { orgId: known.rows[0].org_id, role: known.rows[0].role };
  if (!user.emailVerified) return "unverified";
  const claimed = await q("select org_id, role from claim_membership($1, $2, true)", [user.email, user.id]);
  return claimed.rows[0] ? { orgId: claimed.rows[0].org_id, role: claimed.rows[0].role } : null;
}
