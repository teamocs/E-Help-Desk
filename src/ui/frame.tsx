"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./kit";

// The frame for every page outside the desk: sign-in, verification, hotel setup, the account dashboard,
// and the not-found and error pages. It gives each one the same header, a skip link, a main landmark
// and a footer, so no page is a bare form floating in the middle of the screen.

function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className="pf-brand">
      <span className="brand-mark"><Icon name="bell" size={18} weight="fill" /></span>
      <span translate="no">
        Azalea
        <small>e-Helpdesk</small>
      </span>
    </Link>
  );
}

function Footer() {
  return (
    <footer className="pf-foot">
      <Link href="/">See the demo</Link>
    </footer>
  );
}

/** A signed-in or neutral page: header (with an optional right side), content column, footer. */
export function PageFrame({ children, right, home = "/dashboard" }: { children: ReactNode; right?: ReactNode; home?: string }) {
  return (
    <div className="pf">
      <a className="skip" href="#main">Skip to content</a>
      <header className="pf-head">
        <Brand href={home} />
        <span className="grow" />
        {right}
      </header>
      <main className="pf-main" id="main" tabIndex={-1}>{children}</main>
      <Footer />
    </div>
  );
}

const POINTS = [
  { icon: "plus", title: "Log a guest request in seconds", text: "Towels, repairs, late checkout. It goes straight to the right team." },
  { icon: "waves", title: "Keeps working when the Wi-Fi drops", text: "Changes are saved on the phone and sent once the connection is back." },
  { icon: "user", title: "Every action names who did it", text: "Staff sign in with a PIN on a shared phone. Managers use their own login." },
];

/** Sign-in, sign-up, verification and hotel setup: a short product panel beside one task card. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="pf">
      <a className="skip" href="#main">Skip to content</a>
      <header className="pf-head">
        <Brand href="/" />
        <span className="grow" />
      </header>
      <div className="pf-auth-grid">
        <aside className="pf-side" aria-label="About e-Helpdesk">
          <h2>Service requests and maintenance, handled by the right person.</h2>
          <ul className="pf-points">
            {POINTS.map((p) => (
              <li key={p.title}>
                <span className="pf-ico"><Icon name={p.icon} size={20} /></span>
                <span><b>{p.title}</b><span>{p.text}</span></span>
              </li>
            ))}
          </ul>
        </aside>
        <main className="pf-auth-main" id="main" tabIndex={-1}>
          <div className="pf-card">{children}</div>
        </main>
      </div>
      <Footer />
    </div>
  );
}

export function RoleChip({ role }: { role: string }) {
  return <span className="role-chip">{role === "device" ? "Shared phone" : role}</span>;
}

/** One number an operator can act on. `tone` colours it when the number needs attention. */
export function Stat({ value, label, tone }: { value: number; label: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
