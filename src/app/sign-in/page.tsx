"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Verify } from "./Verify";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "in") {
        const { error: err } = await authClient.signIn.email({ email, password });
        if (err) throw err;
        router.push("/dashboard");
        router.refresh();
      } else {
        const { error: err } = await authClient.signUp.email({ email, password, name: name.trim() || email.split("@")[0] });
        if (err) throw err;
        setVerifyFor(email);
      }
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lockwrap" id="main">
      <div style={{ width: "min(420px, 100%)" }}>
        {verifyFor ? (
          <Verify email={verifyFor} />
        ) : (
          <>
            <h1 className="t-title1">{mode === "in" ? "Sign in" : "Create your account"}</h1>
            <p className="t-sub c2" style={{ margin: "6px 0 16px" }}>
              For owners and managers. Staff use their PIN on a device that is already signed in.
            </p>
            {error && (
              <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>
                <span className="t-sub">{error}</span>
              </div>
            )}
            <form onSubmit={submit}>
              <div className="group">
                {mode === "up" && (
                  <div className="row">
                    <input className="field" autoComplete="name" placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                <div className="row">
                  <input className="field" type="email" autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="row">
                  <input
                    className="field"
                    type="password"
                    autoComplete={mode === "in" ? "current-password" : "new-password"}
                    placeholder="Password"
                    aria-label="Password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <button type="submit" className="btn btn-fill btn-lg btn-block" disabled={busy}>
                  {mode === "in" ? "Sign in" : "Create account"}
                </button>
                <button type="button" className="btn btn-plain" onClick={() => { setError(null); setMode(mode === "in" ? "up" : "in"); }}>
                  {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
                </button>
              </div>
            </form>
          </>
        )}
        <p className="t-foot c2" style={{ marginTop: 24, textAlign: "center" }}>
          <Link href="/">Back to the demo</Link>
        </p>
      </div>
    </main>
  );
}
