import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const guard = auth.middleware({ loginUrl: "/sign-in" });

export default function proxy(request: NextRequest) {
  // Server actions check the session themselves.
  if (request.headers.has("Next-Action")) return;
  return guard(request);
}

// The dashboard and the desk are protected. The demo at "/" stays public.
export const config = { matcher: ["/dashboard/:path*", "/app/:path*"] };
