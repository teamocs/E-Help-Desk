import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling, type PollEnv } from "./poller";

/** A document and window double whose visibility the test controls. */
function fakeEnv() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (t: string, f: () => void) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f);
  const off = (t: string, f: () => void) => void listeners.get(t)?.delete(f);
  const fire = (t: string) => listeners.get(t)?.forEach((f) => f());
  const env: PollEnv & { document: { visibilityState: DocumentVisibilityState } } = {
    document: { visibilityState: "visible", addEventListener: on, removeEventListener: off },
    window: { addEventListener: on, removeEventListener: off },
  };
  return {
    env,
    hide() {
      env.document.visibilityState = "hidden";
      fire("visibilitychange");
    },
    show() {
      env.document.visibilityState = "visible";
      fire("visibilitychange");
    },
    focus: () => fire("focus"),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startPolling", () => {
  it("polls every interval while the tab is visible", async () => {
    const tick = vi.fn(async () => {});
    const stop = startPolling(tick, 5000, fakeEnv().env);
    await vi.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("pauses while hidden and polls at once when the tab comes back, then resumes", async () => {
    const tick = vi.fn(async () => {});
    const f = fakeEnv();
    const stop = startPolling(tick, 5000, f.env);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    f.hide();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    f.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stays paused when the tab is hidden while a poll is still running", async () => {
    const f = fakeEnv();
    const tick = vi.fn(async () => {
      if (tick.mock.calls.length === 1) {
        f.hide();
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
    const stop = startPolling(tick, 5000, f.env);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it("polls at once on focus, but not twice when focus and visibility fire together", async () => {
    const tick = vi.fn(async () => {});
    const f = fakeEnv();
    const stop = startPolling(tick, 5000, f.env);
    await vi.advanceTimersByTimeAsync(2000);
    f.focus();
    f.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never runs two polls at once and keeps going after a failure", async () => {
    let running = 0;
    let most = 0;
    const tick = vi.fn(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 8000));
      running--;
      if (tick.mock.calls.length === 1) throw new Error("offline");
    });
    const f = fakeEnv();
    const stop = startPolling(tick, 5000, f.env);
    await vi.advanceTimersByTimeAsync(6000);
    f.focus();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(most).toBe(1);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it("stops polling and removes its listeners", async () => {
    const tick = vi.fn(async () => {});
    const f = fakeEnv();
    const stop = startPolling(tick, 5000, f.env);
    stop();
    expect(f.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
