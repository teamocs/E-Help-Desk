"use client";

import { useEffect, useState } from "react";
import { AppChrome, Shell } from "../../App";
import { remote } from "../../domain/remote";
import { app, applySnapshot, resetApp, setUI, toast, useUI } from "../../domain/store";
import type { Staff } from "../../domain/types";
import type { Snapshot } from "../../server/contract";
import { loadDesk, runCommand, type Member } from "./actions";

const initials = (name: string) =>
  name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * The existing app screens, fed by the server. Changes apply on screen at once, then go to the
 * server as commands; a fresh snapshot replaces the lists every few seconds so other people's
 * changes show up.
 */
export function RemoteApp({ initial, member }: { initial: Snapshot; member: Member }) {
  const ready = useUI((s) => s.remote);
  const [first] = useState(() => ({ initial, member }));

  useEffect(() => {
    const { initial: snap, member: m } = first;
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
      { snapshot: (s) => applySnapshot(s, me), error: (message) => toast(message, "error") },
    );
    applySnapshot(snap, me);
    app.set((s) => ({ ...s, me: me.id }));
    setUI({ remote: true, screen: "app", tab: "requests", guide: false, sheet: null, selItem: undefined, selWo: undefined });
    const stop = remote.poll(5000);
    return () => {
      stop();
      remote.disable();
      setUI({ remote: false, screen: "cover" });
      resetApp();
      app.set((s) => ({ ...s, me: null }));
    };
  }, [first]);

  return <AppChrome>{ready ? <Shell /> : <p className="c2" style={{ padding: 24 }}>Loading your desk…</p>}</AppChrome>;
}
