import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// PIN hashing. A 4-digit PIN has only 10,000 values, so the hash is keyed with a server-side pepper:
// a copy of the database alone cannot be brute-forced. The pepper comes from the Neon Auth cookie
// secret, so there is no extra environment variable to set. Rotating that secret invalidates every PIN.

export const PIN = /^\d{4}$/;

function pepper(): Buffer {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) throw new Error("NEON_AUTH_COOKIE_SECRET is not set");
  return createHmac("sha256", secret).update("ehelp-pin-pepper-v1").digest();
}

const derive = (pin: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    const keyed = createHmac("sha256", pepper()).update(pin).digest();
    scrypt(keyed, salt, 32, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** True when the PIN is easy to guess: one repeated digit, or a straight run like 1234 or 4321. */
export function isWeakPin(pin: string): boolean {
  if (!PIN.test(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1]! - d[0]!;
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `s1$${salt.toString("base64url")}$${(await derive(pin, salt)).toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [v, salt, key] = stored.split("$");
  if (v !== "s1" || !salt || !key || !PIN.test(pin)) return false;
  const want = Buffer.from(key, "base64url");
  const got = await derive(pin, Buffer.from(salt, "base64url"));
  return want.length === got.length && timingSafeEqual(want, got);
}
