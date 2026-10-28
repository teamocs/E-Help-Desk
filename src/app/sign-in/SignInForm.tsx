"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { AuthShell } from "@/ui/frame";
import { Verify } from "./Verify";

type Mode = "in" | "up";

/** Sign in or create an account. Everything the person needs is on screen: labels, rules, what happens next. */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const signingIn = mode === "in";

  function fail(message: string) {
    setError(message);
    // Move focus to the message so a screen reader announces it and a keyboard user lands on it.
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signingIn) {
        const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
        if (err) throw err;
        router.push("/dashboard");
        router.refresh();
      } else {
        const { error: err } = await authClient.signUp.email({ email: email.trim(), password, name: name.trim() || email.split("@")[0] });
        if (err) throw err;
        setVerifyFor(email.trim());
      }
    } catch (err) {
      fail((err as { message?: string })?.message ?? "Something went wrong. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (verifyFor) {
    return (
      <AuthShell>
        <Verify email={verifyFor} />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="t-title1">{signingIn ? "Sign in" : "Create your account"}</h1>
      <p className="t-sub lead-in">
        {signingIn
          ? "For owners, managers and shared-phone accounts. Staff don’t sign in here: they pick their name and enter a PIN on the shared phone."
          : "Use the email address you were invited with. If you are setting up a new hotel, you’ll do that next."}
      </p>

      {error && (
        <div className="banner bad" role="alert" tabIndex={-1} ref={errorRef} style={{ marginBottom: 12 }}>
          <span className="t-sub">{error}</span>
        </div>
      )}

      <form onSubmit={submit}>
        {!signingIn && (
          <div>
            <label className="field-label" htmlFor="name">Your name</label>
            <input id="name" name="name" className="field" autoComplete="name" placeholder="Maria Santos" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div style={{ marginTop: signingIn ? 0 : 12 }}>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" name="email" className="field" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" placeholder="you@yourhotel.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="password">Password</label>
          <div className="field-row">
            <input
              id="password"
              name="password"
              className="field"
              type={show ? "text" : "password"}
              autoComplete={signingIn ? "current-password" : "new-password"}
              spellCheck={false}
              autoCapitalize="none"
              minLength={8}
              placeholder={signingIn ? "Your password" : "At least 8 characters"}
              aria-describedby={signingIn ? undefined : "password-rule"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className="btn btn-gray" aria-pressed={show} onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {!signingIn && <p id="password-rule" className="t-foot c2" style={{ margin: "6px 2px 0" }}>Use at least 8 characters.</p>}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          <button type="submit" className="btn btn-fill btn-lg btn-block" disabled={busy}>
            {busy ? (signingIn ? "Signing in…" : "Creating account…") : signingIn ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            className="btn btn-plain"
            onClick={() => {
              setError(null);
              setMode(signingIn ? "up" : "in");
            }}
          >
            {signingIn ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
