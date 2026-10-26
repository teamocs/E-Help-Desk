import { Pool } from "pg";

export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runtime traffic goes through Neon's pooler. APP_DATABASE_URL is the app_user login, never the owner.
function pooled(raw: string): string {
  const u = new URL(raw);
  if (!u.hostname.includes("-pooler")) u.hostname = u.hostname.replace(/^([^.]+)/, "$1-pooler");
  return u.toString();
}

let pool: Pool | undefined;
function getPool(): Pool {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is not set");
  pool ??= new Pool({ connectionString: pooled(url), max: 5 });
  return pool;
}

/**
 * One transaction as app_user. The org is set for this transaction only, so it cannot leak into
 * another request on a pooled connection. Pass null before the org is known (sign-in lookups);
 * with no org set, every table policy matches zero rows.
 */
export async function tx<T>(orgId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  if (orgId !== null && !UUID.test(orgId)) throw new Error("Invalid org id");
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_id', $1, true)", [orgId ?? ""]);
    const out = await fn((sql, params) => client.query(sql, params));
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
