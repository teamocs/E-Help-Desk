"use client";

import { useEffect, useState } from "react";
import { AppChrome, Shell } from "../../App";
import { remote } from "../../domain/remote";
import { staffApi } from "../../domain/staffApi";
import { Lock } from "../../screens/Lock";
import { app, applySnapshot, resetApp, setUI, toast, useUI } from "../../domain/store";
import type { Staff } from "../../domain/types";
import type { Snapshot } from "../../server/contract";
import { loadDesk, runCommand, type Member } from "./actions";
import { addStaff, pinSignIn, pinSignOut, removeStaff, setStaffPin } from "./staff";

const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * The existing app screens, fed by the server. Changes apply on screen at once, then go to the
 * server as commands; a fresh snapshot replaces the lists every few seconds so other people's
 * changes show up.
 */
export function RemoteApp({ initial, member, actor }: { initial: Snapshot; member: Member; actor: string | null }) {
  const ready = useUI((s) => s.remote);
  const screen = useUI((s) => s.screen);
  const [first] = useState(() => ({ initial, member, actor }));

  useEffect(() => {
    const { initial: snap, member: m, actor: who } = first;
    const me: Staff = { id: "member", name: m.name, initials: initials(m.name), role: m.role, title: m.role === "owner" ? "Owner" : "Manager", onShift: true };
    const propertyId = snap.property.id;
    remote.enable(
      {
        run: (cmd) => runCommand(propertyId, cmd),
        load: async () => {
          const desk = await loadDesk(propertyId);
          if (!desk) throw new Error("Signed out");
          return desk.snapshot;
        },
      },
      { snapshot: (s) => applySnapshot(s, me), error: (message) => toast(message, "error"), status: (sync) => setUI({ sync }) },
      { scope: propertyId },
    );
    staffApi.current = {
      signIn: (staffId, pin) => pinSignIn(propertyId, staffId, pin),
      signOut: async () => void (await pinSignOut()),
      add: (input, pin) => addStaff(propertyId, input, pin),
      setPin: (staffId, pin) => setStaffPin(propertyId, staffId, pin),
      remove: (staffId) => removeStaff(propertyId, staffId),
    };
    applySnapshot(snap, me);
    // After a reload the signed cookie says who was acting; the server only accepts it if it is still valid.
    app.set((s) => ({ ...s, me: snap.staff.some((p) => p.id === who) ? who! : me.id }));
    setUI({ remote: true, screen: "app", tab: "requests", guide: false, sheet: null, selItem: undefined, selWo: undefined });
    const stop = remote.poll(5000);
    return () => {
      stop();
      remote.disable();
      staffApi.current = null;
      setUI({ remote: false, screen: "cover", sync: { pending: 0, offline: false } });
      resetApp();
      app.set((s) => ({ ...s, me: null }));
    };
  }, [first]);

  return <AppChrome>{ready ? (screen === "lock" ? <Lock /> : <Shell />) : <p className="c2" style={{ padding: 24 }}>Loading your desk…</p>}</AppChrome>;
}
