"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteMember, leaveHotel, revokeInvite } from "./actions";

export interface TeamMember {
  email: string;
  role: string;
  claimed: boolean;
}

/** Everyone with a login to this hotel: owners, managers and shared phones. Only an owner sees the invite form and the revoke buttons. */
export function Team({ members, isOwner, canLeave }: { members: TeamMember[]; isOwner: boolean; canLeave: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "device">("manager");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(job: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const r = await job();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    await run(() => inviteMember(email, role));
    setEmail("");
  }

  return (
    <>
      <h2 className="group-title" id="people">People with a login</h2>
      <div className="group">
        {members.map((m) => (
          <div key={m.email} className="row">
            <span className="grow" style={{ overflowWrap: "anywhere" }}>
              {m.email}
              <span className="t-foot c2" style={{ display: "block", textTransform: "capitalize" }}>
                {m.role === "device" ? "Shared phone" : m.role}
                {m.claimed ? "" : " · invited, not signed in yet"}
              </span>
            </span>
            {isOwner && !m.claimed && (
              <button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={() => run(() => revokeInvite(m.email))}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
      {canLeave && (
        <div style={{ marginTop: 12 }}>
          {error && (
            <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>
              <span className="t-sub">{error}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-gray btn-block"
            disabled={busy}
            onClick={() => window.confirm("Leave this hotel? An owner will need to invite you again to get back in.") && run(leaveHotel)}
          >
            Leave this hotel
          </button>
        </div>
      )}
      {isOwner && (
        <form onSubmit={invite} style={{ marginTop: 12 }}>
          {error && (
            <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>
              <span className="t-sub">{error}</span>
            </div>
          )}
          <div className="group">
            <div className="row">
              <input className="field" type="email" placeholder="Email address" aria-label="Email address to invite" autoComplete="off" spellCheck={false} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="row">
              <select className="field" aria-label="Account type" value={role} onChange={(e) => setRole(e.target.value as "manager" | "device")}>
                <option value="manager">Manager (their own phone)</option>
                <option value="device">Shared phone (staff sign in with a PIN)</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-fill btn-block" style={{ marginTop: 10 }} disabled={busy || !email.trim()}>
            Send invite
          </button>
          <p className="t-foot c2" style={{ marginTop: 8 }}>
            They sign up at this site with that address, verify it, and are linked to this hotel. A shared-phone account needs a real mailbox the front desk can read, such as frontdesk@yourhotel.com.
          </p>
        </form>
      )}
    </>
  );
}
