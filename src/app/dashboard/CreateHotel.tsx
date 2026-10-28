"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createHotel } from "./actions";

/** Shown to a verified user who has no hotel and no invite. */
export function CreateHotel({ email }: { email: string }) {
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [property, setProperty] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createHotel(org, property, code);
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
        <div className="field-wrap">
          <label className="field-label" htmlFor="org">Hotel or group name</label>
          <input id="org" name="organization" className="field" autoComplete="organization" placeholder="Azalea Hotels" maxLength={80} value={org} onChange={(e) => setOrg(e.target.value)} required />
        </div>
        <div className="field-wrap">
          <label className="field-label" htmlFor="property">First property</label>
          <input id="property" name="property" className="field" autoComplete="off" placeholder="Azalea Boracay" maxLength={80} value={property} onChange={(e) => setProperty(e.target.value)} required />
        </div>
        <div className="field-wrap">
          <label className="field-label" htmlFor="code">Setup code</label>
          <input id="code" name="setup-code" className="field" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste the code you were given" aria-describedby="code-help" value={code} onChange={(e) => setCode(e.target.value.trim())} required />
          <p id="code-help" className="t-foot c2" style={{ margin: "6px 2px 0" }}>New hotels are set up with a one-time code from OCS. Don’t have one yet? Ask OCS, or ask your hotel’s owner to invite you instead.</p>
        </div>
      </div>
      <button type="submit" className="btn btn-fill btn-lg btn-block" style={{ marginTop: 14 }} disabled={busy || !org.trim() || !property.trim() || !code}>
        {busy ? "Creating your hotel…" : "Create my hotel"}
      </button>
    </form>
  );
}
