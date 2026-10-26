import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { tx } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { Verify } from "../sign-in/Verify";
import { SignOut } from "./SignOut";

export default function DashboardPage() {
  return (
    <main className="lockwrap" id="main">
      <div style={{ width: "min(640px, 100%)" }}>
        <Suspense fallback={<p className="c2">Loading your account…</p>}>
          <Account />
        </Suspense>
      </div>
    </main>
  );
}

async function Account() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/sign-in");
  const { id, email, emailVerified } = session.user;

  const tenant = await tx(null, (q) => resolveTenant({ id, email, emailVerified: !!emailVerified }, q));

  if (tenant === "unverified") {
    return (
      <>
        <Verify email={email} />
        <div style={{ marginTop: 16 }}><SignOut /></div>
      </>
    );
  }

  if (!tenant) {
    return (
      <>
        <h1 className="t-title1">No hotel linked yet</h1>
        <p className="t-body c2" style={{ margin: "8px 0 20px" }}>
          {email} has not been invited to a hotel. Ask the owner to invite this address, then sign in again.
        </p>
        <SignOut />
      </>
    );
  }

  // From here every query runs with the org set, so it can only see this hotel.
  const data = await tx(tenant.orgId, async (q) => ({
    org: (await q("select name from orgs")).rows[0]?.name as string,
    properties: (await q("select name from properties order by name")).rows as { name: string }[],
    staff: (await q("select dept, count(*)::int as n from staff where active group by dept order by dept")).rows as { dept: string | null; n: number }[],
  }));

  return (
    <>
      <h1 className="t-title1">{data.org}</h1>
      <p className="t-sub c2" style={{ margin: "6px 0 0" }}>
        Signed in as {email} · {tenant.role}
      </p>

      <h2 className="group-title">Properties</h2>
      <div className="group">
        {data.properties.map((p) => (
          <div key={p.name} className="row">{p.name}</div>
        ))}
      </div>

      <h2 className="group-title">Active staff by department</h2>
      <div className="group">
        {data.staff.map((s) => (
          <div key={s.dept ?? "management"} className="row">
            <span className="grow" style={{ textTransform: "capitalize" }}>{s.dept ?? "Management"}</span>
            <span className="c2">{s.n}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
        <Link href="/app" className="btn btn-fill btn-lg btn-block">Open the desk</Link>
        <Link href="/" className="btn btn-gray btn-block">Open the demo</Link>
        <SignOut />
      </div>
    </>
  );
}
