/**
 * How much memory the computer that runs OpenBot has left. Only a hosted server gives one: its
 * machine is small, and one unit holds OpenBot, its browser tabs and every provider process. The main
 * process reads the system; this file has no Electron import, so the backend can use it.
 */
export type HostMemoryLevel = "ok" | "low" | "critical";

export interface HostMemory {
  level(): HostMemoryLevel;
  /** The most agent turns that run at the same time on this machine. */
  turnLimit(): number;
  /** Counts the memory of a turn that starts now, before its processes grow. */
  reserveTurn(): void;
  /** Called after each sample. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}
