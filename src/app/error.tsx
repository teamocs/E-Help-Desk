"use client";

import Link from "next/link";
import { PageFrame } from "@/ui/frame";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageFrame home="/">
      <h1 className="t-large">Something went wrong</h1>
      <p className="t-body c2" style={{ margin: "8px 0 20px" }}>We couldn’t load this page. Nothing you entered has been lost on the server. Try again, or go back to your hotel.</p>
      <div className="pf-cta">
        <button type="button" className="btn btn-fill btn-lg btn-block" onClick={reset}>Try again</button>
        <Link href="/dashboard" className="btn btn-gray btn-lg btn-block">Go to your hotel</Link>
      </div>
    </PageFrame>
  );
}
