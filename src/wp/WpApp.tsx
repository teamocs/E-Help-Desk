import { useEffect, useState, useSyncExternalStore } from "react";
import { AppChrome, Shell } from "../App";
import { remote } from "../domain/remote";
import { staffApi } from "../domain/staffApi";
import { app, applySnapshot, canEditLists, createStore, resetApp, setCatalog, setUI, toast, useUI } from "../domain/store";
import type { Role, Staff } from "../domain/types";
import { Lock } from "../screens/Lock";
import { AuthError, createWpApi, storageActor, type WpApi } from "./api";
import type { AzlConfig } from "./config";
import { startPolling } from "./poller";

// The desk inside WordPress: the snapshot, commands, PIN, staff and account calls go to the plugin's REST API,
// and the desk polls /poll for other people's changes.

/** Set when WordPress says the session ended (or the account may not open the desk). */
export const session = createStore({ lost: false });
const useLost = () => useSyncExternalStore(session.sub, () => session.get().lost, () => false);

const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const TITLE: Record<string, string> = { owner: "Hotel owner", manager: "Manager", supervisor: "Supervisor" };
const MANAGERS_ONLY = { ok: false, error: "Only the hotel owner or a manager can change staff." } as const;
const OWNER_ONLY = { ok: false, error: "Only the hotel owner can manage logins." } as const;
const LISTS_ONLY = { ok: false, error: "Only the hotel owner or a manager can change the lists." } as const;
const RETRY_MS = 5000;

export function makeApi(cfg: AzlConfig, fetchImpl?: typeof fetch): WpApi {
  return createWpApi(cfg, {
    fetch: fetchImpl,
    onAuthLost: () => session.set(() => ({ lost: true })),
    actor: storageActor(`azl-ehd:actor:${cfg.property.id}`, typeof localStorage === "undefined" ? undefined : localStorage),
  });
}

/** Wires the shared store to WordPress. Returns a function that undoes it. Exported for tests. */
export function connect(cfg: AzlConfig, api: WpApi, onLoadError: (message: string | null) => void, go: (url: string) => void = (u) => window.location.assign(u)): () => void {
  const role = cfg.user.role;
  const deviceOnly = role === "device";
  const staffAdmin = role === "owner" || role === "manager";
  // A shared phone has no manager identity: only staff who sign in with a PIN can act.
  const me: Staff | undefined = deviceOnly
    ? undefined
    : { id: "member", name: cfg.user.name, initials: initials(cfg.user.name), role: (role === "owner" ? "owner" : role) as Role, title: TITLE[role] ?? "Manager", onShift: true };
  let alive = true;
  let stopPoll: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const scope = `wp:${cfg.property.id}`;

  setUI({ account: { name: cfg.user.name, role, hotel: cfg.theme.name || cfg.property.name, logoUrl: cfg.theme.logoUrl, modules: cfg.user.modules }, access: cfg.access });
  remote.enable(
    { run: (cmd) => api.command(cmd), load: async () => (await api.snapshot()).snapshot },
    { snapshot: (s) => applySnapshot(s, me), error: (message) => toast(message, "error"), status: (sync) => setUI({ sync }) },
    { scope, stamp: (cmd) => api.stamp(cmd) },
  );
  staffApi.current = {
    signIn: (staffId, pin) => api.pinSignIn(staffId, pin),
    signOut: () => api.pinSignOut(),
    add: (input, pin) => (staffAdmin ? api.addStaff(input, pin) : Promise.resolve(MANAGERS_ONLY)),
    setPin: (staffId, pin) => (staffAdmin ? api.setPin(staffId, pin) : Promise.resolve(MANAGERS_ONLY)),
    remove: (staffId) => (staffAdmin ? api.removeStaff(staffId) : Promise.resolve(MANAGERS_ONLY)),
    logout: async () => {
      await api.logout();
      go(cfg.loginUrl);
    },
    logins: () => (role === "owner" ? api.accounts() : Promise.resolve(OWNER_ONLY)),
    addLogin: (input) => (role === "owner" ? api.addAccount(input) : Promise.resolve(OWNER_ONLY)),
    setLoginDisabled: (id, disabled) => (role === "owner" ? api.setAccountDisabled(id, disabled) : Promise.resolve(OWNER_ONLY)),
    catalog: () => (canEditLists(role) ? api.getCatalog() : Promise.resolve(LISTS_ONLY)),
    saveList: async (list, items, baseRev) => {
      if (!canEditLists(role)) return LISTS_ONLY;
      const r = await api.putCatalog(list, items, baseRev);
      // Saved, or someone else saved first: every screen follows the server's lists at once.
      if (r.ok || r.catalog) setCatalog(r.catalog!);
      return r;
    },
  };

  const tick = async () => {
    if (session.get().lost) return;
    try {
      const r = await api.poll();
      setUI({ pollDown: false });
      if (r.changed) await remote.refresh();
    } catch (e) {
      if (!(e instanceof AuthError)) setUI({ pollDown: true });
      throw e;
    }
  };

  const load = async () => {
    try {
      const { snapshot, actor } = await api.snapshot();
      if (!alive) return;
      onLoadError(null);
      applySnapshot(snapshot, me);
      // After a reload the signed acting-staff token says who was acting; the server only returns it while valid.
      const acting = actor && snapshot.staff.some((p) => p.id === actor) ? actor : null;
      app.set((s) => ({ ...s, me: acting ?? me?.id ?? null }));
      setUI({ remote: true, deviceOnly, screen: acting || me ? "app" : "lock", tab: "dashboard", sheet: null, selItem: undefined, selWo: undefined });
      stopPoll = startPolling(tick, cfg.pollMs);
    } catch (e) {
      if (!alive || e instanceof AuthError) return;
      onLoadError("Could not reach the help desk. Trying again…");
      retry = setTimeout(() => void load(), RETRY_MS);
    }
  };
  void load();

  return () => {
    alive = false;
    clearTimeout(retry);
    stopPoll?.();
    remote.disable();
    staffApi.current = null;
    setUI({ remote: false, deviceOnly: false, screen: "lock", sync: { pending: 0, offline: false }, pollDown: false });
    resetApp();
    app.set((s) => ({ ...s, me: null }));
  };
}

function SignInAgain({ loginUrl }: { loginUrl: string }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="azl-signin-title" aria-describedby="azl-signin-desc" className="lockwrap" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
      <div style={{ width: "min(440px, 100%)", textAlign: "center", display: "grid", gap: 16 }}>
        <h1 id="azl-signin-title" className="t-title1">Sign in again</h1>
        <p id="azl-signin-desc" className="t-body c2" style={{ margin: 0 }}>
          Your sign-in has ended, or this account cannot open the help desk. Changes saved on this device are kept and will send after you sign in.
        </p>
        <a className="btn btn-fill btn-lg btn-block" href={loginUrl} autoFocus>Go to sign in</a>
      </div>
    </div>
  );
}

export function WpApp({ cfg, api }: { cfg: AzlConfig; api: WpApi }) {
  const ready = useUI((s) => s.remote);
  const screen = useUI((s) => s.screen);
  const lost = useLost();
  const [first] = useState(() => ({ cfg, api }));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => connect(first.cfg, first.api, setLoadError), [first]);

  return (
    <AppChrome>
      {ready ? (screen === "lock" ? <Lock /> : <Shell />) : (
        <main className="lockwrap" id="main"><p className="c2" role="status">{loadError ?? "Loading your desk…"}</p></main>
      )}
      {lost && <SignInAgain loginUrl={cfg.loginUrl} />}
    </AppChrome>
  );
}
