// Invite codes for creating a hotel (migration 0007). Shared by db/issue-code.mjs and the tests so both
// hash exactly as create_org() does in SQL:
//   sha256 hex of the code with everything but letters and digits removed, upper-cased.
// A code is 20 random bytes (160 bits) in base32, shown in groups of four. Only the hash is stored.
import { createHash, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A new random code, e.g. "K7QD-2MXA-...". 160 bits; never store or log it. */
export function newCode() {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join("-");
}

/** Same normalisation and hash as create_org(): sha256 hex of the upper-cased letters and digits. */
export function hashCode(code) {
  const norm = String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return createHash("sha256").update(norm, "utf8").digest("hex");
}

/**
 * Store a new code (hash only) and return the plain code once. `q` is any (sql, params) => {rows}
 * function run as the database owner: pg's client.query or PGlite's db.query.
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} q
 * @param {{ uses: number, days: number, note?: string }} opts
 */
export async function insertCode(q, { uses, days, note = "" }) {
  const code = newCode();
  const r = await q(
    "insert into signup_codes (code_hash, uses_left, expires_at, note) values ($1, $2, now() + make_interval(days => $3), $4) returning id, expires_at",
    [hashCode(code), uses, days, note],
  );
  return { code, id: r.rows[0].id, expiresAt: r.rows[0].expires_at };
}
