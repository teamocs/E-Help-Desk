import Link from "next/link";
import type { MemberRole } from "@/server/policy";
import type { PropertySummary } from "@/server/summary";
import { AuthShell, PageFrame, RoleChip, Stat } from "@/ui/frame";
import { Verify } from "../sign-in/Verify";
import { CreateHotel } from "./CreateHotel";
import { SignOut } from "./SignOut";
import { Team, type TeamMember } from "./Team";

// Every state of the account page, from one data object. page.tsx loads the data; this only draws it, so each
// role can be previewed without signing in. Roles: owner (everything), manager (the desk and staff),
// device (a shared phone: one way into the desk, nothing else).

export type AccountData =
  | { kind: "unverified"; email: string }
  | { kind: "no-hotel"; email: string }
  | {
      kind: "member";
      email: string;
      role: MemberRole;
      hotel: string;
      summary: PropertySummary[];
      staff: { dept: string | null; n: number }[];
      team: TeamMember[];
    };

const INTRO: Record<MemberRole, string> = {
  owner: "You own this hotel account. You can invite managers and shared phones.",
  manager: "You can run the desk and manage staff on your own phone.",
  device: "This phone is the hotel’s shared account. Staff pick their name and enter a PIN to work.",
};

const DEPT_LABELS: Record<string, string> = { it: "IT", frontdesk: "Front desk", housekeeping: "Housekeeping", engineering: "Engineering" };
const deptLabel = (d: string | null) => (d ? (DEPT_LABELS[d] ?? d.charAt(0).toUpperCase() + d.slice(1)) : "Management");

function RightNow({ summary }: { summary: PropertySummary[] }) {
  if (summary.length === 0) return <div className="group"><div className="pf-empty">No properties yet.</div></div>;
  const many = summary.length > 1;
  return (
    <div className="pf-prop">
      {summary.map((p) => (
        <section key={p.id} aria-label={many ? p.name : "This property"}>
          {many && <h3>{p.name}</h3>}
          <div className="stat-grid">
            <Stat value={p.open} label="Open requests" />
            <Stat value={p.overdue} label="Past target time" tone={p.overdue > 0 ? "warn" : undefined} />
            <Stat value={p.workOrders} label="Open work orders" />
            <Stat value={p.incidents} label="Active safety alerts" tone={p.incidents > 0 ? "bad" : undefined} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function Account({ data }: { data: AccountData }) {
  if (data.kind === "unverified") {
    return (
      <AuthShell>
        <Verify email={data.email} />
        <div style={{ marginTop: 16 }}><SignOut /></div>
      </AuthShell>
    );
  }

  if (data.kind === "no-hotel") {
    return (
      <AuthShell>
        <CreateHotel email={data.email} />
        <div style={{ marginTop: 16 }}><SignOut /></div>
      </AuthShell>
    );
  }

  const { email, role, hotel, summary, staff, team } = data;
  const runsTheDesk = role !== "device";

  return (
    <PageFrame
      right={
        <div className="pf-who">
          <span className="t-sub c2" title={email}>{email}</span>
          <RoleChip role={role} />
          <SignOut compact />
        </div>
      }
    >
      <div className="pf-title">
        <div>
          <h1 className="t-large">{hotel}</h1>
          <p className="t-sub c2">{INTRO[role]}</p>
          <p className="t-foot c2" style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>Signed in as {email}</p>
        </div>
      </div>

      <div className="pf-cta">
        <Link href="/app" className="btn btn-fill btn-lg btn-block">
          {runsTheDesk ? "Open the desk" : "Open the desk and sign in with a PIN"}
        </Link>
        {runsTheDesk && <Link href="/" className="btn btn-gray btn-lg btn-block">Try the demo</Link>}
      </div>

      {!runsTheDesk && (
        <section className="pf-section" aria-labelledby="how">
          <h2 className="group-title" id="how">How it works on this phone</h2>
          <ol className="group pf-steps">
            <li>Open the desk.</li>
            <li>Pick your name and enter your four-digit PIN. Every request you log or update carries your name.</li>
            <li>When someone else takes over, open Settings and tap Switch person. Forgot your PIN? A manager can set a new one.</li>
          </ol>
        </section>
      )}

      {runsTheDesk && (
        <>
          <section className="pf-section" aria-labelledby="now">
            <h2 className="group-title" id="now">Right now</h2>
            <RightNow summary={summary} />
            <p className="t-foot c2" style={{ margin: "8px 4px 0" }}>Counts are as of this page load. The desk itself updates live.</p>
          </section>

          <section className="pf-section" aria-labelledby="people">
            <Team members={team} isOwner={role === "owner"} canLeave={role === "manager"} />
          </section>

          <section className="pf-section" aria-labelledby="staff">
            <h2 className="group-title" id="staff">Staff by department</h2>
            <div className="group">
              {staff.length === 0 && <div className="pf-empty">No staff yet. Open the desk, then add people in Settings.</div>}
              {staff.map((s) => (
                <div key={s.dept ?? "management"} className="row">
                  <span className="grow">{deptLabel(s.dept)}</span>
                  <span className="c2">{s.n}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </PageFrame>
  );
}
