// The page config the WordPress plugin prints before the bundle (window.AZL). See azalea-ehelpdesk/azalea-ehelpdesk.php.
import type { Level, Matrix } from "../modules/access";

export type AzlRole = "owner" | "manager" | "supervisor" | "device";
const LEVELS: Level[] = ["none", "read", "own", "full"];
const KINDS = ["owner", "manager", "supervisor", "hdo", "staff"];

/** {id: level} with only known levels; anything else is dropped (the server still refuses what it must). */
function levels(x: unknown): Record<string, Level> {
  const out: Record<string, Level> = {};
  if (x && typeof x === "object" && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x)) if (LEVELS.includes(v as Level)) out[k] = v as Level;
  }
  return out;
}

/** The role matrix from window.AZL.access, or undefined when missing (the desk's own copy is used then). */
function matrix(x: unknown): Matrix | undefined {
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined;
  const out: Matrix = {};
  for (const [id, row] of Object.entries(x)) {
    const r = levels(row);
    out[id] = Object.fromEntries(Object.entries(r).filter(([k]) => KINDS.includes(k)));
  }
  return out;
}

export interface AzlConfig {
  /** rest_url('azl-ehd/v1/'), e.g. https://site/wp-json/azl-ehd/v1/ or https://site/?rest_route=/azl-ehd/v1/ */
  restUrl: string;
  /** wp_create_nonce('wp_rest'), sent as X-WP-Nonce. */
  nonce: string;
  /** wp_login_url() back to /helpdesk/, shown when the WordPress session ends. */
  loginUrl: string;
  /** Poll interval in ms (settings: 5 to 30 s). */
  pollMs: number;
  /** This install's property. `id` only scopes the offline queue on this device. */
  property: { id: string; name: string };
  /** `modules`: what this account may see (module id => level); empty on a shared phone, where the PIN person decides. */
  user: { name: string; role: AzlRole; canManage: boolean; modules: Record<string, Level> };
  /** The server's role matrix: module id => actor kind => level. */
  access?: Matrix;
  /** The hotel's look. The colours come as --azl-* CSS variables in a <style> the plugin prints; this is the rest. */
  theme: { key: string; name: string; logoUrl: string };
  /** Plugin version, for support. */
  version: string;
}

const ROLES: AzlRole[] = ["owner", "manager", "supervisor", "device"];

/** Reads and checks window.AZL. Throws a plain message when the page was not served by the plugin. */
export function readConfig(w: { AZL?: unknown }): AzlConfig {
  const c = w.AZL as Partial<AzlConfig> | undefined;
  if (!c || typeof c.restUrl !== "string" || typeof c.nonce !== "string" || !c.user || !c.property) {
    throw new Error("The help desk settings are missing from this page.");
  }
  const pollMs = Number(c.pollMs);
  return {
    restUrl: c.restUrl,
    nonce: c.nonce,
    loginUrl: typeof c.loginUrl === "string" ? c.loginUrl : "/wp-login.php",
    pollMs: Number.isFinite(pollMs) ? Math.min(Math.max(pollMs, 5000), 30000) : 5000,
    property: { id: String(c.property.id ?? "site"), name: String(c.property.name ?? "") },
    user: {
      name: String(c.user.name ?? ""),
      role: ROLES.includes(c.user.role as AzlRole) ? (c.user.role as AzlRole) : "device",
      canManage: c.user.canManage === true,
      modules: levels(c.user.modules),
    },
    access: matrix(c.access),
    theme: {
      key: String(c.theme?.key ?? "baguio"),
      name: String(c.theme?.name || c.property.name || ""),
      // Only http(s) or site-relative logo addresses; anything else falls back to the bell mark.
      logoUrl: typeof c.theme?.logoUrl === "string" && /^(https?:\/\/|\/)/i.test(c.theme.logoUrl) ? c.theme.logoUrl : "",
    },
    version: String(c.version ?? ""),
  };
}
