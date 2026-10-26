import type { Command, CommandResult, Snapshot } from "../server/contract";

// Keeps the optimistic client store in step with the server. Pure demo mode never enables it.
//
// - send() queues a command; commands run one at a time, in order.
// - Each command has a client-made opId, so a retry after a dropped connection cannot apply twice.
// - After the queue drains, the client asks for a fresh snapshot and replaces its state with it.
// - A snapshot that was requested before a newer local action is thrown away, so a slow read can
//   never undo something the user just did.

type Distribute<C> = C extends { opId: string } ? Omit<C, "opId"> : never;
export type Draft = Distribute<Command>;

export interface Transport {
  run(cmd: Command): Promise<CommandResult>;
  load(): Promise<Snapshot>;
}

export interface Hooks {
  snapshot(s: Snapshot): void;
  error(message: string): void;
}

let transport: Transport | null = null;
let hooks: Hooks | null = null;
let queue: Promise<void> = Promise.resolve();
let inflight = 0;
let epoch = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runWithRetry(t: Transport, cmd: Command): Promise<CommandResult> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await t.run(cmd);
    } catch (e) {
      last = e; // network error: the same opId is safe to send again
      await sleep(400 * 2 ** i);
    }
  }
  throw last;
}

async function refresh(force = false): Promise<void> {
  if (!transport || !hooks) return;
  const at = epoch;
  try {
    const snap = await transport.load();
    if (force || (inflight === 0 && at === epoch)) hooks.snapshot(snap);
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
    return inflight > 0;
  },
  enable(t: Transport, h: Hooks) {
    transport = t;
    hooks = h;
  },
  disable() {
    transport = null;
    hooks = null;
    queue = Promise.resolve();
    inflight = 0;
  },
  send(draft: Draft): void {
    const t = transport;
    if (!t) return;
    const cmd = { ...draft, opId: crypto.randomUUID() } as Command;
    epoch++;
    inflight++;
    queue = queue.then(async () => {
      let failed = false;
      try {
        const r = await runWithRetry(t, cmd);
        if (!r.ok) {
          failed = true;
          hooks?.error(r.error);
        }
      } catch {
        failed = true;
        hooks?.error("Could not save that change. Check the connection and try again.");
      } finally {
        inflight--;
      }
      if (failed) await refresh(true);
      else if (inflight === 0) await refresh();
    });
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
