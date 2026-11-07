import type { BackgroundProcess } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";

const ACTIVE_POLL_INTERVAL_MS = 5_000;
// An empty list changes only when a program starts, and each poll runs `ps` and `lsof`: check less
// often until there is a row to show. A failed read keeps the last list and polls at the same rate.
const IDLE_POLL_INTERVAL_MS = 30_000;

const [snapshot, setSnapshot] = createStore<{ processes: BackgroundProcess[] }>({ processes: [] });
let subscribers = 0;
let agentId: string | null = null;
let timer: number | undefined;
let readGeneration = 0;

/** The last successful list. A failed read keeps it, and a null answer means no processes here. */
export const backgroundProcesses = () => snapshot.processes;

/** The conversation that is on screen asks for its agent only, and starts with an empty list. */
export function setBackgroundProcessAgent(next: string | undefined): void {
  const id = next ?? null;
  if (id === agentId) return;
  agentId = id;
  readGeneration += 1;
  setSnapshot((draft) => {
    draft.processes = [];
  });
  stop();
  start();
}

async function refresh(): Promise<void> {
  const requestedAgent = agentId;
  const generation = ++readGeneration;
  try {
    const processes =
      requestedAgent === null
        ? await window.openbot.backgroundProcesses.list()
        : await window.openbot.backgroundProcesses.list({ agentId: requestedAgent });
    if (generation !== readGeneration) return;
    setSnapshot((draft) => {
      draft.processes = processes ?? [];
    });
  } catch {
    // Keep the previous snapshot. The next poll tries again without a toast.
  }
}

function schedule(): void {
  if (timer !== undefined || subscribers === 0 || agentId === null) return;
  if (document.visibilityState !== "visible") return;
  const delay = snapshot.processes.length === 0 ? IDLE_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
  timer = window.setTimeout(() => {
    timer = undefined;
    void refresh().finally(schedule);
  }, delay);
}

function start(): void {
  if (subscribers === 0 || agentId === null || document.visibilityState !== "visible") return;
  void refresh().finally(schedule);
}

function stop(): void {
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timer = undefined;
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") start();
  else stop();
}

/**
 * One poll for every conversation that shows background processes. It runs only while a subscriber
 * is mounted, an agent is set, and the document is visible; a hidden document keeps the last list.
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

/** Stops one verified process, then refreshes at once so the row leaves before the next poll. */
export async function stopBackgroundProcess(process: BackgroundProcess): Promise<boolean> {
  const result = await window.openbot.backgroundProcesses.stop({ id: process.id, agentId: process.agentId });
  await refresh();
  return result.stopped;
}
