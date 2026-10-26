import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Command } from "../server/contract";
import { indexedDbOutbox } from "./outbox";

const cmd = (id: string) => ({ type: "relay", itemId: id, opId: `op-${id}` }) as Command;

describe("indexedDbOutbox", () => {
  it("keeps entries in order, per scope, across a reopen", async () => {
    const name = `t-${Math.random()}`;
    const a = indexedDbOutbox(name);
    const s1 = await a.add("p1", cmd("1"));
    await a.add("p2", cmd("x"));
    await a.add("p1", cmd("2"));

    const b = indexedDbOutbox(name); // a fresh handle, like a page reload
    expect((await b.all("p1")).map((e) => e.cmd.opId)).toEqual(["op-1", "op-2"]);
    expect(await b.all("p2")).toHaveLength(1);

    await b.remove(s1);
    expect((await b.all("p1")).map((e) => e.cmd.opId)).toEqual(["op-2"]);
  });
});
