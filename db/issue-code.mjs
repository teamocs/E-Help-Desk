// Issues one invite code that lets a hotel owner create their hotel (migration 0007). Run as the
// database owner; stores only the sha256 hash and prints the plain code ONCE to stdout. It cannot be
// shown again: if it is lost, issue a new one. Connection strings are never printed.
//
//   node --env-file=.env.neon-dev db/issue-code.mjs --uses 1 --days 14 --note "Rose Hotel, Maria Cruz"
//
//   --uses N    how many hotels the code can create (default 1, max 100)
//   --days D    days until it expires (default 14, max 90)
//   --note TXT  who it is for, kept with the hash (max 200 characters)
//
// Production uses --env-file=.env.neon-main; only an operator does that.
import { parseArgs } from "node:util";
import pg from "pg";
import { insertCode } from "./signup-code.mjs";

const { values } = parseArgs({
  options: {
    uses: { type: "string", default: "1" },
    days: { type: "string", default: "14" },
    note: { type: "string", default: "" },
  },
});
const uses = Number(values.uses);
const days = Number(values.days);
const note = values.note.trim();
if (!Number.isInteger(uses) || uses < 1 || uses > 100) throw new Error("--uses must be a whole number from 1 to 100");
if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("--days must be a whole number from 1 to 90");
if (note.length > 200) throw new Error("--note must be 200 characters or fewer");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (pass --env-file)");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL.replace("-pooler", "") });
await client.connect();
try {
  const r = await insertCode((sql, params) => client.query(sql, params), { uses, days, note });
  console.error(`code ${r.id}: ${uses} use(s), expires ${new Date(r.expiresAt).toISOString()}${note ? `, note "${note}"` : ""}`);
  console.log(r.code);
} finally {
  await client.end();
}
