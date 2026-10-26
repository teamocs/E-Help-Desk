"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createHotel } from "./actions";

/** Shown to a verified user who has no hotel and no invite. */
export function CreateHotel({ email }: { email: string }) {
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [property, setProperty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createHotel(org, property);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <h1 className="t-title1">Set up your hotel</h1>
      <p className="t-sub c2" style={{ margin: "6px 0 16px" }}>
        {email} has no hotel yet. Create one and you become its owner. If someone invited you instead, ask them to invite this address and sign in again.
      </p>
      {error && (
        <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>
          <span className="t-sub">{error}</span>
        </div>
      )}
      <div className="group">
        <div className="row">
          <input className="field" placeholder="Hotel or group name" aria-label="Hotel or group name" maxLength={80} value={org} onChange={(e) => setOrg(e.target.value)} required />
        </div>
        <div className="row">
          <input className="field" placeholder="First property, e.g. Boracay" aria-label="First property name" maxLength={80} value={property} onChange={(e) => setProperty(e.target.value)} required />
        </div>
      </div>
      <button type="submit" className="btn btn-fill btn-lg btn-block" style={{ marginTop: 14 }} disabled={busy || !org.trim() || !property.trim()}>
        {busy ? "Creating…" : "Create my hotel"}
      </button>
    </form>
  );
}
