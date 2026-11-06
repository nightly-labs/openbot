import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

const POLL_INTERVAL_MS = 5_000;

const [snapshot, setSnapshot] = createStore<{ processes: BackgroundProcess[] }>({ processes: [] });
let subscribers = 0;
let timer: number | undefined;
let readGeneration = 0;

/** The last successful list. A failed read keeps it, and a null answer means no processes here. */
export const backgroundProcesses = () => snapshot.processes;

async function refresh(): Promise<void> {
  const generation = ++readGeneration;
  try {
    const processes = await window.openbot.backgroundProcesses.list();
    if (generation !== readGeneration) return;
    setSnapshot((draft) => {
      draft.processes = processes ?? [];
    });
  } catch {
    // Keep the previous snapshot. The next poll tries again without a toast.
  }
}

function start(): void {
  if (timer !== undefined || subscribers === 0 || document.visibilityState !== "visible") return;
  void refresh();
  timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
}

function stop(): void {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") start();
  else stop();
}

/**
 * One poll for every conversation that shows background processes. It runs only while a subscriber
 * is mounted and the document is visible; a hidden document keeps the last snapshot.
 */
export function subscribeBackgroundProcesses(): () => void {
  subscribers += 1;
  if (subscribers === 1) document.addEventListener("visibilitychange", onVisibilityChange);
  start();
  return () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stop();
  };
}

/** Stops one process, then refreshes at once so the row leaves before the next poll. */
export async function stopBackgroundProcess(id: string): Promise<void> {
  await window.openbot.backgroundProcesses.stop(id);
  await refresh();
}
