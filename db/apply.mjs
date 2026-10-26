// Applies db/migrations/*.sql once each (tracked in schema_migrations), then db/seed.sql, as the
// database owner. On first run it also gives app_user a login password and saves APP_DATABASE_URL
// to the env file. Connection strings and passwords are never printed.
//
//   node --env-file=.env.neon-dev db/apply.mjs
import { randomBytes } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
// Migrations use the direct endpoint, not the pooler, so session state and DDL behave normally.
const url = process.env.DATABASE_URL.replace("-pooler", "");
const envFile = process.env.ENV_FILE ?? ".env.neon-dev";
const dir = join(process.cwd(), "db");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const files = readdirSync(join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await client.query("select 1 from schema_migrations where name = $1", [f]);
    if (done.rowCount) {
      console.log("skip   ", f);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, "migrations", f), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log("applied", f);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }

  await client.query(readFileSync(join(dir, "seed.sql"), "utf8"));
  console.log("seed ok");

  if (!process.env.APP_DATABASE_URL) {
    const pw = randomBytes(24).toString("hex");
    // pw is lowercase hex, so it is safe inside the literal.
    await client.query(`alter role app_user login password '${pw}'`);
    const u = new URL(url);
    u.username = "app_user";
    u.password = pw;
    appendFileSync(envFile, `\nAPP_DATABASE_URL=${u.toString()}\n`);
    console.log("app_user can now log in; APP_DATABASE_URL saved to", envFile);
  } else {
    console.log("app_user login already configured");
  }
} finally {
  await client.end();
}
