import { afterEach, describe, expect, it } from "vitest";
import type { AnyCommand as Command, CommandResult, Snapshot } from "./contract";
import { memoryOutbox } from "./outbox";
import { remote, type Status } from "./remote";

const snap = { at: 1 } as unknown as Snapshot;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await wait(5);
  expect(f()).toBe(true);
};
const itemOf = (c: Command) => (c as { itemId: string }).itemId;

function setup(run: (c: Command) => Promise<CommandResult>, outbox = memoryOutbox(), scope = "p1") {
  const sent: Command[] = [];
  const errors: string[] = [];
  const statuses: Status[] = [];
  const snaps: Snapshot[] = [];
  remote.enable(
    { run: async (c) => { sent.push(c); return run(c); }, load: async () => snap },
    { snapshot: (s) => snaps.push(s), error: (m) => errors.push(m), status: (s) => statuses.push(s) },
    { scope, outbox, retryMs: 5 },
  );
  return { sent, errors, statuses, snaps, outbox };
}

const draft = (itemId: string) => ({ type: "relay", itemId }) as const;
const ok: CommandResult = { ok: true, applied: true };

afterEach(() => remote.disable());

describe("remote outbox", () => {
  it("sends commands in order and empties the outbox", async () => {
    const t = setup(async () => ok);
    remote.send(draft("a"));
    remote.send(draft("b"));
    await until(() => t.sent.length === 2);
    expect(t.sent.map(itemOf)).toEqual(["a", "b"]);
    await until(() => !remote.busy);
    expect(await t.outbox.all("p1")).toEqual([]);
  });

  it("keeps a command through a dropped connection and resends it with the same op id", async () => {
    let calls = 0;
    const t = setup(async () => {
      if (++calls < 3) throw new Error("offline");
      return ok;
    });
    remote.send(draft("a"));
    await until(() => t.sent.length === 3);
    expect(new Set(t.sent.map((c) => c.opId)).size).toBe(1);
    await until(() => !remote.busy);
    expect(t.errors).toEqual([]);
  });

  it("survives a reload: queued commands go out later, in order, once", async () => {
    const outbox = memoryOutbox();
    const first = setup(async () => { throw new Error("offline"); }, outbox);
    remote.send(draft("a"));
    remote.send(draft("b"));
    await until(() => first.sent.length >= 1);
    remote.disable();

    const second = setup(async () => ok, outbox);
    await until(() => second.sent.length === 2);
    expect(second.sent.map(itemOf)).toEqual(["a", "b"]);
    expect(second.sent[0]!.opId).toBe(first.sent[0]!.opId);
    await until(() => !remote.busy);
    expect(await outbox.all("p1")).toEqual([]);
  });

  it("does not send another property's queued commands", async () => {
    const outbox = memoryOutbox();
    await outbox.add("p2", { type: "relay", itemId: "x", opId: "o" } as Command);
    const t = setup(async () => ok, outbox, "p1");
    remote.send(draft("a"));
    await until(() => t.sent.length === 1);
    await wait(30);
    expect(t.sent).toHaveLength(1);
    expect(await outbox.all("p2")).toHaveLength(1);
  });

  it("drops a command the server refuses, says why, and carries on", async () => {
    const t = setup(async (c) => (itemOf(c) === "a" ? { ok: false, error: "Not possible" } : ok));
    remote.send(draft("a"));
    remote.send(draft("b"));
    await until(() => t.sent.length === 2);
    await until(() => !remote.busy);
    expect(t.errors).toEqual(["Not possible"]);
    expect(await t.outbox.all("p1")).toEqual([]);
  });

  it("reports pending and offline for the screen", async () => {
    let up = false;
    const t = setup(async () => { if (!up) throw new Error("offline"); return ok; });
    remote.send(draft("a"));
    await until(() => t.statuses.some((s) => s.offline));
    expect(t.statuses.at(-1)).toMatchObject({ pending: 1, offline: true });
    up = true;
    await until(() => t.statuses.at(-1)?.pending === 0);
    expect(t.statuses.at(-1)).toEqual({ pending: 0, offline: false });
  });

  it("ignores a snapshot while changes are still waiting", async () => {
    const t = setup(async () => { throw new Error("offline"); });
    remote.send(draft("a"));
    await until(() => t.sent.length >= 1);
    await remote.refresh();
    expect(t.snaps).toEqual([]);
  });

  it("keeps sending when the outbox cannot save", async () => {
    const bad = memoryOutbox();
    bad.add = async () => { throw new Error("quota"); };
    const t = setup(async () => ok, bad);
    remote.send(draft("a"));
    await until(() => t.sent.length === 1);
  });
});
