import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { tx } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { loadSummary } from "@/server/summary";
import { PageFrame } from "@/ui/frame";
import { Account, type AccountData } from "./Account";
import type { TeamMember } from "./Team";

export const metadata: Metadata = { title: "Your hotel" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageFrame><p className="c2" role="status">Loading your hotel…</p></PageFrame>}>
      <Loaded />
    </Suspense>
  );
}

async function load(): Promise<AccountData> {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/sign-in");
  const { id, email, emailVerified } = session.user;

  const tenant = await tx(null, (q) => resolveTenant({ id, email, emailVerified: !!emailVerified }, q));
  if (tenant === "unverified") return { kind: "unverified", email };
  if (!tenant) return { kind: "no-hotel", email };

  // From here every query runs with the org set, so it can only see this hotel.
  const data = await tx(tenant.orgId, async (q) => ({
    hotel: (await q("select name from orgs")).rows[0]?.name as string,
    // A shared-phone account only needs the way into the desk, so it skips the counts and the people list.
    summary: tenant.role === "device" ? [] : await loadSummary(q),
    staff: (await q("select dept, count(*)::int as n from staff where active group by dept order by dept")).rows as { dept: string | null; n: number }[],
    team: tenant.role === "device" ? [] : ((await q("select email, role, user_id is not null as claimed from members order by role desc, email")).rows as TeamMember[]),
  }));

  return { kind: "member", email, role: tenant.role, ...data };
}

async function Loaded() {
  return <Account data={await load()} />;
}
