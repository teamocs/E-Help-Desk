// The page config the WordPress plugin prints before the bundle (window.AZL). See azalea-ehelpdesk/azalea-ehelpdesk.php.

export type AzlRole = "owner" | "manager" | "supervisor" | "device";

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
  user: { name: string; role: AzlRole; canManage: boolean };
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
    },
    version: String(c.version ?? ""),
  };
}
