"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

type Note = { tone: "ok" | "bad"; text: string } | null;

/** Email verification by 6-digit code. The code goes to the address, so only its owner can finish. */
export function Verify({ email }: { email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setNote(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    setBusy(false);
    if (error) return setNote({ tone: "bad", text: error.message ?? "Could not send the code. Try again." });
    setSent(true);
    setNote({ tone: "ok", text: `We sent a code to ${email}. It expires in 15 minutes.` });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp: code.trim() });
    setBusy(false);
    if (error) return setNote({ tone: "bad", text: error.message ?? "That code did not work. Check it or ask for a new one." });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <h1 className="t-title1">Verify your email</h1>
      <p className="t-sub c2" style={{ margin: "6px 0 16px" }}>
        We only link an invited owner or manager account after the email address is confirmed.
      </p>
      {note && (
        <div className={`banner ${note.tone === "bad" ? "bad" : "ok"}`} role={note.tone === "bad" ? "alert" : "status"} style={{ marginBottom: 12 }}>
          <span className="t-sub">{note.text}</span>
        </div>
      )}
      {!sent ? (
        <button type="button" className="btn btn-fill btn-lg btn-block" disabled={busy} onClick={send}>
          Email me a code
        </button>
      ) : (
        <form onSubmit={verify}>
          <div className="group">
            <div className="field-wrap">
              <label className="field-label" htmlFor="code">Verification code</label>
              <input
                id="code"
                name="code"
                className="field"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="6-digit code from your email"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button type="submit" className="btn btn-fill btn-lg btn-block" disabled={busy || !code.trim()}>
              Verify
            </button>
            <button type="button" className="btn btn-gray btn-block" disabled={busy} onClick={send}>
              Send a new code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
