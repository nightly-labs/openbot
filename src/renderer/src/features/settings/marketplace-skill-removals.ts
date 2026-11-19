import { createStore } from "solid-js";

export interface HeldRemoval {
  readonly host: string | undefined;
  readonly agentId: string;
  readonly skillId: string;
}

interface SettledChange extends HeldRemoval {
  readonly removed: boolean;
}

const [held, setHeld] = createStore<Record<string, true>>({});
const holds = new Map<string, HeldRemoval>();
const listeners = new Set<(settled: SettledChange) => void>();

function removalKey(host: string | undefined, agentId: string, skillId: string): string {
  return JSON.stringify([host ?? null, agentId, skillId]);
}

export function removalHeld(host: string | undefined, agentId: string, skillId: string): boolean {
  return held[removalKey(host, agentId, skillId)] === true;
}

export function holdRemoval(host: string | undefined, agentId: string, skillId: string): HeldRemoval {
  const removal: HeldRemoval = { host, agentId, skillId };
  const key = removalKey(host, agentId, skillId);
  holds.set(key, removal);
  setHeld((draft) => {
    draft[key] = true;
  });
  return removal;
}

export function removalWaits(removal: HeldRemoval): boolean {
  return holds.get(removalKey(removal.host, removal.agentId, removal.skillId)) === removal;
}

export function releaseRemoval(removal: HeldRemoval): void {
  if (removalWaits(removal)) dropHold(removalKey(removal.host, removal.agentId, removal.skillId));
}

export function cancelRemoval(host: string | undefined, agentId: string, skillId: string): boolean {
  const key = removalKey(host, agentId, skillId);
  if (!holds.has(key)) return false;
  dropHold(key);
  return true;
}

function dropHold(key: string): void {
  holds.delete(key);
  setHeld((draft) => {
    delete draft[key];
  });
}

export function onHeldChangeSettled(listener: (settled: SettledChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function heldChangeSettled(settled: SettledChange): void {
  for (const listener of listeners) listener(settled);
}
