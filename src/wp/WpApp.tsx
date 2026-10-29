import { useEffect, useState, useSyncExternalStore } from "react";
import { AppChrome, Shell } from "../App";
import { remote } from "../domain/remote";
import { staffApi } from "../domain/staffApi";
import { app, applySnapshot, createStore, resetApp, setUI, toast, useUI } from "../domain/store";
import type { Role, Staff } from "../domain/types";
import { Lock } from "../screens/Lock";
import { AuthError, createWpApi, storageActor, type WpApi } from "./api";
import type { AzlConfig } from "./config";
import { startPolling } from "./poller";

// The desk inside WordPress. Mirrors src/app/app/RemoteApp.tsx, but the snapshot, commands, PIN and staff calls go
// to the plugin's REST API, and the desk polls /poll instead of reloading the snapshot on a timer.

/** Set when WordPress says the session ended (or the account may not open the desk). */
export const session = createStore({ lost: false });
const useLost = () => useSyncExternalStore(session.sub, () => session.get().lost, () => false);

const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const TITLE: Record<string, string> = { owner: "Owner", manager: "Manager", supervisor: "Supervisor" };
const MANAGERS_ONLY = { ok: false, error: "Only a manager can change staff." } as const;
const RETRY_MS = 5000;

export function makeApi(cfg: AzlConfig, fetchImpl?: typeof fetch): WpApi {
  return createWpApi(cfg, {
    fetch: fetchImpl,
    onAuthLost: () => session.set(() => ({ lost: true })),
    actor: storageActor(`azl-ehd:actor:${cfg.property.id}`, typeof localStorage === "undefined" ? undefined : localStorage),
  });
}

/** Wires the shared store to WordPress. Returns a function that undoes it. Exported for tests. */
export function connect(cfg: AzlConfig, api: WpApi, onLoadError: (message: string | null) => void): () => void {
  const deviceOnly = cfg.user.role === "device";
  // A shared phone has no manager identity: only staff who sign in with a PIN can act.
  const me: Staff | undefined = deviceOnly
    ? undefined
    : { id: "member", name: cfg.user.name, initials: initials(cfg.user.name), role: cfg.user.role as Role, title: TITLE[cfg.user.role] ?? "Manager", onShift: true };
  let alive = true;
  let stopPoll: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const scope = `wp:${cfg.property.id}`;

  remote.enable(
    { run: (cmd) => api.command(cmd), load: async () => (await api.snapshot()).snapshot },
    { snapshot: (s) => applySnapshot(s, me), error: (message) => toast(message, "error"), status: (sync) => setUI({ sync }) },
    { scope },
  );
  staffApi.current = {
    signIn: (staffId, pin) => api.pinSignIn(staffId, pin),
    signOut: () => api.pinSignOut(),
    add: (input, pin) => (cfg.user.canManage ? api.addStaff(input, pin) : Promise.resolve(MANAGERS_ONLY)),
    setPin: (staffId, pin) => (cfg.user.canManage ? api.setPin(staffId, pin) : Promise.resolve(MANAGERS_ONLY)),
    remove: (staffId) => (cfg.user.canManage ? api.removeStaff(staffId) : Promise.resolve(MANAGERS_ONLY)),
  };

  const tick = async () => {
    if (session.get().lost) return;
    const r = await api.poll();
    if (r.changed) await remote.refresh();
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
      setUI({ remote: true, deviceOnly, screen: acting || me ? "app" : "lock", tab: "requests", guide: false, sheet: null, selItem: undefined, selWo: undefined });
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
    setUI({ remote: false, deviceOnly: false, screen: "cover", sync: { pending: 0, offline: false } });
    resetApp();
    app.set((s) => ({ ...s, me: null }));
  };
}

function SignInAgain({ loginUrl }: { loginUrl: string }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="azl-signin-title" className="lockwrap" style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--bg)" }}>
      <div style={{ width: "min(440px, 100%)", textAlign: "center" }}>
        <h1 id="azl-signin-title" className="t-title1">Sign in again</h1>
        <p className="t-body c2">
          Your WordPress sign-in has ended, or this account cannot open the help desk. Changes saved on this device are kept and will send after you sign in.
        </p>
        <a className="btn btn-fill btn-lg btn-block" href={loginUrl}>Go to sign in</a>
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
