// Polls while the tab is visible. Hidden tab: no requests at all. Back to visible or focused: poll at once, then resume.
// Never two polls at the same time. A failed poll is ignored; the next tick tries again.

export interface PollEnv {
  document: { visibilityState: DocumentVisibilityState; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };
  window: { addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };
}

/** Focus and visibilitychange often fire together; a second immediate poll within this gap is skipped. */
const MIN_GAP_MS = 1000;

export function startPolling(tick: () => Promise<void>, ms: number, env: PollEnv = { document, window }): () => void {
  let stopped = false;
  let inflight = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = () => env.document.visibilityState === "visible";

  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!stopped && visible()) timer = setTimeout(() => void run(), ms);
  };

  async function run() {
    if (stopped || inflight || !visible()) return;
    inflight = true;
    lastStart = Date.now();
    try {
      await tick();
    } catch {
      /* the next tick tries again */
    } finally {
      inflight = false;
      schedule();
    }
  }

  const wake = () => {
    if (!visible()) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    if (Date.now() - lastStart < MIN_GAP_MS) {
      if (!timer && !inflight) schedule();
      return;
    }
    void run();
  };

  env.document.addEventListener("visibilitychange", wake);
  env.window.addEventListener("focus", wake);
  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
    env.document.removeEventListener("visibilitychange", wake);
    env.window.removeEventListener("focus", wake);
  };
}
