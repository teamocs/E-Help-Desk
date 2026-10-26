// Checks the row-level security rules on a real Neon branch, connecting as app_user over the
// POOLED endpoint exactly as the app will. Creates a throwaway second org and removes it at the end.
//
//   node --env-file=.env.neon-dev db/verify-neon.mjs
// Prints pass or fail per check. Never prints connection strings.
import pg from "pg";

const AZALEA = "a0a0a0a0-0000-4000-8000-000000000001";
const VERIFY = "e0e0e0e0-0000-4000-8000-000000000001";
const VERIFY_PROP = "e0e0e0e0-0000-4000-8000-000000000011";

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_URL and APP_DATABASE_URL must be set");

const pooled = (u) => {
  const x = new URL(u);
  if (!x.hostname.includes("-pooler")) x.hostname = x.hostname.replace(/^([^.]+)/, "$1-pooler");
  return x.toString();
};

const owner = new pg.Client({ connectionString: ownerUrl });
const app = new pg.Client({ connectionString: pooled(appUrl) });
let failed = 0;

async function check(name, fn) {
  try {
    const note = await fn();
    console.log("pass", name, note ? `(${note})` : "");
  } catch (e) {
    failed++;
    console.log("FAIL", name, "-", e.message.split("\n")[0]);
  }
}
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
};

/** One transaction as app_user with the org set for that transaction only. */
async function inOrg(org, sql, params = []) {
  await app.query("begin");
  try {
    await app.query("select set_config('app.org_id', $1, true)", [org ?? ""]);
    const r = await app.query(sql, params);
    await app.query("commit");
    return r;
  } catch (e) {
    await app.query("rollback");
    throw e;
  }
}

await owner.connect();
await app.connect();
try {
  await owner.query("insert into orgs (id, name) values ($1, 'Verify Org') on conflict do nothing", [VERIFY]);
  await owner.query("insert into properties (id, org_id, name) values ($1, $2, 'Verify Main') on conflict do nothing", [VERIFY_PROP, VERIFY]);
  await owner.query("insert into members (org_id, email, role) values ($1, 'verify@example.com', 'manager') on conflict do nothing", [VERIFY]);

  await check("pooled login works as app_user", async () => {
    const r = await app.query("select current_user as u, rolbypassrls as b from pg_roles where rolname = current_user");
    eq(r.rows[0].u, "app_user", "user");
    eq(r.rows[0].b, false, "bypassrls");
  });

  await check("owner is exempt and can read everything (seed ran)", async () => {
    const r = await owner.query("select count(*)::int as n from staff where org_id = $1", [AZALEA]);
    eq(r.rows[0].n, 8, "staff");
  });

  await check("org is set per transaction over the pooled endpoint", async () => {
    eq((await inOrg(AZALEA, "select count(*)::int as n from staff")).rows[0].n, 8, "azalea staff");
    eq((await inOrg(VERIFY, "select count(*)::int as n from staff")).rows[0].n, 0, "verify org staff");
  });

  await check("the org setting does not leak into the next transaction", async () => {
    await inOrg(AZALEA, "select 1");
    const r = await app.query("select count(*)::int as n from staff");
    eq(r.rows[0].n, 0, "rows with no org set");
    const s = await app.query("select coalesce(nullif(current_setting('app.org_id', true), ''), 'unset') as v");
    eq(s.rows[0].v, "unset", "setting after commit");
  });

  await check("no org set means no rows", async () => {
    eq((await inOrg(null, "select count(*)::int as n from properties")).rows[0].n, 0, "properties");
  });

  await check("cannot read PIN hashes or device tokens", async () => {
    for (const sql of ["select pin_hash from staff", "select token_hash from devices"]) {
      try {
        await inOrg(AZALEA, sql);
      } catch (e) {
        eq(e.code, "42501", "error code");
        continue;
      }
      throw new Error(`${sql} was allowed`);
    }
  });

  await check("cannot write another org's rows", async () => {
    try {
      await inOrg(AZALEA, "insert into properties (org_id, name) values ($1, 'Sneaky')", [VERIFY]);
    } catch (e) {
      eq(e.code, "42501", "error code");
      return;
    }
    throw new Error("insert into another org was allowed");
  });

  await check("a membership claim needs a verified email and works once", async () => {
    eq((await inOrg(null, "select * from claim_membership('verify@example.com', 'u-1', false)")).rowCount, 0, "unverified");
    eq((await inOrg(null, "select * from claim_membership('verify@example.com', 'u-1', true)")).rowCount, 1, "verified");
    eq((await inOrg(null, "select * from claim_membership('verify@example.com', 'u-2', true)")).rowCount, 0, "second claim");
  });

  await check("sign-in functions run before an org is set", async () => {
    eq((await inOrg(null, "select * from device_by_token('no-such-token')")).rowCount, 0, "unknown token");
    eq((await inOrg(null, "select * from member_for_user('u-1')")).rowCount, 1, "member lookup");
  });

  await check("Neon Auth user id type vs members.user_id", async () => {
    const r = await owner.query(
      "select data_type from information_schema.columns where table_schema = 'neon_auth' and table_name = 'user' and column_name = 'id'",
    );
    return r.rowCount ? `neon_auth.user.id is ${r.rows[0].data_type}; members.user_id is text` : "neon_auth schema not found on this branch";
  });
} finally {
  await owner.query("delete from orgs where id = $1", [VERIFY]).catch(() => {});
  await app.end();
  await owner.end();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
