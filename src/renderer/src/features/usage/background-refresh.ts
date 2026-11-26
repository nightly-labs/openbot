const BACKGROUND_REFRESH_INTERVAL_MS = 15_000;

export interface BackgroundRefresh {
  request(): void;
  dispose(): void;
}

export function createBackgroundRefresh(
  run: () => Promise<void>,
  intervalMs = BACKGROUND_REFRESH_INTERVAL_MS,
): BackgroundRefresh {
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let running = false;
  let pending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finished = () => {
    running = false;
    if (pending) start();
  };

  function start(): void {
    timer = undefined;
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    const wait = lastStartedAt + intervalMs - Date.now();
    if (wait > 0) {
      timer = setTimeout(start, wait);
      return;
    }
    pending = false;
    running = true;
    lastStartedAt = Date.now();
    run().then(finished, finished);
  }

  return {
    request() {
      if (disposed || timer !== undefined) return;
      start();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
