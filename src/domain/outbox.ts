import type { AnyCommand as Command } from "./contract";

// A disk-backed queue of commands that have not reached the server yet. remote.ts writes each command
// here before sending and removes it once the server answers, so a reload or a dead Wi-Fi zone loses nothing.
// `scope` is the property id: one device can hold queues for several hotels.

export interface Entry {
  seq: number;
  scope: string;
  cmd: Command;
}

export interface Outbox {
  /** Saves the command and returns its place in the queue. */
  add(scope: string, cmd: Command): Promise<number>;
  /** Everything waiting for this scope, oldest first. */
  all(scope: string): Promise<Entry[]>;
  remove(seq: number): Promise<void>;
}

export function memoryOutbox(): Outbox {
  let seq = 0;
  const rows = new Map<number, Entry>();
  return {
    async add(scope, cmd) {
      rows.set(++seq, { seq, scope, cmd });
      return seq;
    },
    async all(scope) {
      return [...rows.values()].filter((e) => e.scope === scope);
    },
    async remove(n) {
      rows.delete(n);
    },
  };
}

const STORE = "commands";

export function indexedDbOutbox(name = "ehelp-outbox"): Outbox {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      // Wait for the transaction, not just the request: only then is the write on disk.
      t.oncomplete = () => resolve(req.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  return {
    add: (scope, cmd) => run("readwrite", (s) => s.add({ scope, cmd })).then((k) => k as number),
    all: async (scope) => ((await run("readonly", (s) => s.getAll())) as Entry[]).filter((e) => e.scope === scope).sort((a, b) => a.seq - b.seq),
    remove: (seq) => run("readwrite", (s) => s.delete(seq)).then(() => undefined),
  };
}

/** The disk queue where the browser has one; otherwise a queue that lasts as long as the page. */
export function defaultOutbox(): Outbox {
  return typeof indexedDB === "undefined" ? memoryOutbox() : indexedDbOutbox();
}
