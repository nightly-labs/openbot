interface PendingTimer {
  dueAt: number;
  run: () => void;
}

export const realSetTimeout = window.setTimeout.bind(window);
export const realClearTimeout = window.clearTimeout.bind(window);
const realNow = Date.now.bind(Date);
const pendingTimers = new Map<number, PendingTimer>();
let offsetMs = 0;

Date.now = () => realNow() + offsetMs;

function clockSetTimeout(handler: TimerHandler, timeout = 0, ...args: unknown[]): number {
  const run = () => {
    pendingTimers.delete(id);
    if (typeof handler === "function") handler(...args);
  };
  const id = realSetTimeout(run, timeout);
  pendingTimers.set(id, { dueAt: Date.now() + timeout, run });
  return id;
}

function clockClearTimeout(id?: number): void {
  if (id === undefined) return;
  pendingTimers.delete(id);
  realClearTimeout(id);
}

Object.assign(window, { setTimeout: clockSetTimeout, clearTimeout: clockClearTimeout });

export function advanceClock(milliseconds: number): number {
  offsetMs += milliseconds;
  const now = Date.now();
  const due = [...pendingTimers]
    .filter(([, timer]) => timer.dueAt <= now)
    .sort(([, left], [, right]) => left.dueAt - right.dueAt);
  for (const [id, timer] of due) {
    realClearTimeout(id);
    timer.run();
  }
  return due.length;
}
