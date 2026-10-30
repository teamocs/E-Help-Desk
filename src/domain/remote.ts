import type { AnyCommand, Command, CommandResult, ModuleCommand, Snapshot } from "./contract";
import { defaultOutbox, type Outbox } from "./outbox";

// Keeps the optimistic client store in step with the server. WpApp enables it once the desk connects.
//
// - send() saves the command to the outbox (IndexedDB), then sends commands one at a time, in order.
// - Each command has a client-made opId, so a resend after a dropped connection cannot apply twice.
// - A network error keeps the command queued and retries with a growing delay, or at once when the
//   browser says it is back online. A reload picks the queue up again from disk.
// - A command the server refuses is dropped and the reason shown.
// - After the queue drains, the client asks for a fresh snapshot and replaces its state with it.
//   Snapshots are ignored while anything is still waiting, so a read can never undo a change the
//   user made that the server has not seen yet.

type Distribute<C> = C extends { opId: string } ? Omit<C, "opId"> : never;
export type Draft = Distribute<Command>;
/** A module's own command before it gets its opId (see runModuleCommand in store.ts). */
export type ModuleDraft = Omit<ModuleCommand, "opId"> & { type: string };

export interface Transport {
  run(cmd: AnyCommand): Promise<CommandResult>;
  load(): Promise<Snapshot>;
}

export interface Status {
  /** Commands saved but not yet accepted or refused by the server. */
  pending: number;
  /** The last attempt could not reach the server. */
  offline: boolean;
}

export interface Hooks {
  snapshot(s: Snapshot): void;
  error(message: string): void;
  status?(s: Status): void;
}

export interface Options {
  /** The property id. Queued commands are kept and sent per scope. */
  scope: string;
  outbox?: Outbox;
  /** First retry delay in ms; it doubles up to 30 s. */
  retryMs?: number;
  /**
   * Adds data to a command when it is queued, before it is saved. The WordPress desk records the PIN token of the
   * person acting now, so a command that waits offline is still credited to them when it finally goes out.
   */
  stamp?: (cmd: AnyCommand) => AnyCommand;
}

interface Queued {
  cmd: AnyCommand;
  /** The outbox key, or null when the outbox could not save it (the command still goes out). */
  saved: Promise<number | null>;
}

const MAX_DELAY = 30_000;

let transport: Transport | null = null;
let hooks: Hooks | null = null;
let outbox: Outbox = defaultOutbox();
let scope = "";
let retryMs = 1000;
let stamp: (cmd: AnyCommand) => AnyCommand = (c) => c;
let pending: Queued[] = [];
let ready: Promise<void> = Promise.resolve();
let gen = 0; // bumped on enable and disable; a loop from an older generation stops
let draining = false;
let offline = false;
let fails = 0;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const report = () => hooks?.status?.({ pending: pending.length, offline });

function onOnline() {
  clearTimeout(timer);
  fails = 0;
  void drain();
}

async function drain(): Promise<void> {
  const t = transport;
  if (draining || !t) return;
  const g = gen;
  draining = true;
  try {
    await ready;
    let refused = false;
    while (g === gen && pending.length) {
      const head = pending[0]!;
      let r: CommandResult;
      try {
        r = await t.run(head.cmd);
      } catch {
        if (g !== gen) return;
        offline = true;
        report();
        clearTimeout(timer);
        timer = setTimeout(() => void drain(), Math.min(retryMs * 2 ** Math.min(fails++, 10), MAX_DELAY));
        return;
      }
      if (g !== gen) return;
      if (!r.ok) {
        refused = true;
        hooks?.error(r.error);
      }
      pending.shift();
      offline = false;
      fails = 0;
      const seq = await head.saved;
      if (seq !== null) await outbox.remove(seq).catch(() => {});
      report();
    }
    if (g === gen) {
      draining = false;
      await refresh(refused);
    }
  } finally {
    if (g === gen) draining = false;
  }
}

async function refresh(force = false): Promise<void> {
  if (!transport || !hooks) return;
  const at = epoch;
  try {
    const snap = await transport.load();
    if (pending.length === 0 && (force || at === epoch)) hooks?.snapshot(snap);
  } catch {
    /* keep the current state; the next poll tries again */
  }
}

export const remote = {
  get active() {
    return transport !== null;
  },
  /** Commands still waiting or running. */
  get busy() {
    return pending.length > 0;
  },
  enable(t: Transport, h: Hooks, o: Options) {
    remote.disable();
    transport = t;
    hooks = h;
    outbox = o.outbox ?? defaultOutbox();
    scope = o.scope;
    retryMs = o.retryMs ?? 1000;
    stamp = o.stamp ?? ((c) => c);
    const g = ++gen;
    // Commands saved by an earlier page load go first, ahead of anything sent since.
    ready = outbox
      .all(scope)
      .then((rows) => {
        if (g !== gen) return;
        pending.unshift(...rows.map((e) => ({ cmd: e.cmd, saved: Promise.resolve<number | null>(e.seq) })));
        report();
      })
      .catch(() => {});
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);
    void drain();
  },
  /** Stops sending. Anything still queued stays in the outbox for the next enable(). */
  disable() {
    gen++;
    clearTimeout(timer);
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    transport = null;
    hooks = null;
    pending = [];
    draining = false;
    offline = false;
    fails = 0;
  },
  send(draft: Draft): void {
    remote.sendModule(draft);
  },
  /** Queues a module's own command (any registered type) exactly like a built-in one. */
  sendModule(draft: ModuleDraft | Draft): void {
    if (!transport) return;
    const cmd = stamp({ ...draft, opId: crypto.randomUUID() } as AnyCommand);
    const o = outbox;
    const s = scope;
    const saved = ready.then(() => o.add(s, cmd)).catch(() => null);
    epoch++;
    pending.push({ cmd, saved });
    report();
    void drain();
  },
  refresh,
  /** Poll for other people's changes. Returns a function that stops it. */
  poll(ms: number): () => void {
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void refresh();
    }, ms);
    return () => clearInterval(t);
  },
};
