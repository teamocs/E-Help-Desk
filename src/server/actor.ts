import { createHmac, timingSafeEqual } from "node:crypto";

// Who is acting right now: a signed cookie set after a correct PIN. It names the staff member and is
// bound to the signed-in user and the property, so a cookie from one account or hotel is useless in another.
// The server reads it on every command; the browser can ask to switch person but cannot claim to be one.

export const ACTOR_COOKIE = "ehelp_actor";
export const ACTOR_HOURS = 10; // one shift

export interface Actor {
  /** Neon Auth user id of the signed-in device account. */
  u: string;
  /** Property id. */
  p: string;
  /** Staff id. */
  s: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function key(): Buffer {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEON_AUTH_COOKIE_SECRET is not set");
  return createHmac("sha256", secret).update("ehelp-actor-cookie-v1").digest();
}

const mac = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export function signActor(a: Actor): string {
  const body = Buffer.from(JSON.stringify(a)).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** The actor in a cookie value, or null when it is missing, forged, expired or for someone else. */
export function readActor(token: string | undefined, user: string, property: string, now = Date.now()): Actor | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const a = JSON.parse(Buffer.from(body, "base64url").toString()) as Actor;
    if (typeof a.s !== "string" || a.u !== user || a.p !== property || typeof a.exp !== "number" || a.exp <= now) return null;
    return a;
  } catch {
    return null;
  }
}
