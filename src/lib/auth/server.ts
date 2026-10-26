import { createNeonAuth } from "@neondatabase/auth/next/server";

// Managed Better Auth on the Neon branch. Sessions are cached in a signed, HTTP-only cookie.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});
