// Removes ONE hotel by exact name and owner email, in a transaction. Everything under it (properties,
// members, staff, requests, events, handovers...) goes with it through ON DELETE CASCADE.
// Usage: node --env-file=.env.neon-main db/remove-test-hotel.mjs "Azalea test" giyaadmin@gmail.com
import pg from "pg";

const [name, ownerEmail] = process.argv.slice(2);
if (!name || !ownerEmail) throw new Error('usage: remove-test-hotel.mjs "<hotel name>" <owner email>');

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL });
await c.connect();
try {
  await c.query("begin");
  const found = (
    await c.query(
      `select o.id from orgs o
        where o.name = $1
          and exists (select 1 from members m where m.org_id = o.id and m.role = 'owner' and lower(m.email) = lower($2))`,
      [name, ownerEmail],
    )
  ).rows;
  if (found.length !== 1) throw new Error(`expected exactly 1 matching hotel, found ${found.length}; nothing deleted`);
  const { rowCount } = await c.query("delete from orgs where id = $1", [found[0].id]);
  await c.query("commit");
  console.error(`deleted ${rowCount} hotel "${name}"`);
} catch (e) {
  await c.query("rollback");
  console.error(String(e.message ?? e));
  process.exitCode = 1;
} finally {
  await c.end();
}
