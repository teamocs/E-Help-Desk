import Link from "next/link";
import { PageFrame } from "@/ui/frame";

export default function NotFound() {
  return (
    <PageFrame home="/">
      <h1 className="t-large">That page doesn’t exist</h1>
      <p className="t-body c2" style={{ margin: "8px 0 20px" }}>The link may be old or mistyped. Your hotel and its requests are not affected.</p>
      <div className="pf-cta">
        <Link href="/dashboard" className="btn btn-fill btn-lg btn-block">Go to your hotel</Link>
        <Link href="/" className="btn btn-gray btn-lg btn-block">See the demo</Link>
      </div>
    </PageFrame>
  );
}
