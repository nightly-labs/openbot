import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "./remote-directory";

const ACCOUNT_RETRY_INTERVAL_MS = 60_000;

/** One endpoint per account: absolute freshness, shared requests, and no background polling. */
export function createRemoteAccountRefresh(load: () => Promise<void>, now = Date.now) {
  let active = false;
  let disposed = false;
  let pending: Promise<void> | null = null;
  let dueAt = Number.NEGATIVE_INFINITY;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancelTimer();
    if (!active || disposed || pending) return;
    timer = setTimeout(() => void refresh().catch(() => undefined), Math.max(0, dueAt - now()));
  }

  function refresh(force = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    if (!active || (!force && now() < dueAt)) return Promise.resolve();
    cancelTimer();
    const startedRevision = revision;
    let started = false;
    const operation = Promise.resolve()
      .then(() => {
        if (!active || disposed) return;
        started = true;
        return load();
      })
      .then(
        () => {
          if (!started) return;
          dueAt = revision === startedRevision ? now() + REMOTE_ACCOUNT_CHECK_INTERVAL_MS : now();
        },
        (error: unknown) => {
          // A failed request is not a fresh account check. Bound retries independently of freshness.
          dueAt = now() + ACCOUNT_RETRY_INTERVAL_MS;
          throw error;
        },
      )
      .finally(() => {
        pending = null;
        schedule();
      });
    pending = operation;
    return operation;
  }

  return {
    refresh,
    invalidate() {
      revision += 1;
      dueAt = Number.NEGATIVE_INFINITY;
      schedule();
    },
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      cancelTimer();
      if (active) {
        void refresh().catch(() => undefined);
        schedule();
      }
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
