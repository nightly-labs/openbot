import { useSyncExternalStore } from "react";

const KEEP_AFTER_MS = 45_000;

let running = 0;
let keepUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let awake = false;
const listeners = new Set<() => void>();

function update() {
  const next = running > 0 || Date.now() < keepUntil;
  if (next === awake) return;
  awake = next;
  for (const listener of listeners) listener();
}

export function startWatchWake(): void {
  running += 1;
  update();
}

export function endWatchWake(): void {
  running = Math.max(0, running - 1);
  keepUntil = Date.now() + KEEP_AFTER_MS;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    update();
  }, KEEP_AFTER_MS);
  update();
}

export function useWatchAwake(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => awake,
  );
}
