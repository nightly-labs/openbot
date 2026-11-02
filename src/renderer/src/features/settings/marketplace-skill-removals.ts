import { createStore } from "solid-js";

/**
 * A skill remove that waits for the Undo toast of its change. The host still has the skill, and the
 * Marketplace shows it as removed.
 */
export interface HeldRemoval {
  readonly host: string | undefined;
  readonly agentId: string;
  readonly skillId: string;
}

/** One agent of a held change, after the host answered. `removed`: the host no longer has the skill. */
interface SettledChange extends HeldRemoval {
  readonly removed: boolean;
}

/*
 * Module scope: a remove commits when its toast closes, also after the Marketplace closed, and a
 * Marketplace that opens again before that must also show the skill as removed.
 */
const [held, setHeld] = createStore<Record<string, true>>({});
const holds = new Map<string, HeldRemoval>();
/** Each open Marketplace, told when a held change ended on the host. */
const listeners = new Set<(settled: SettledChange) => void>();

function removalKey(host: string | undefined, agentId: string, skillId: string): string {
  return JSON.stringify([host ?? null, agentId, skillId]);
}

/** True while a remove of this skill waits. Reactive. */
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

/** True when `removal` still waits: no later change took it back. */
export function removalWaits(removal: HeldRemoval): boolean {
  return holds.get(removalKey(removal.host, removal.agentId, removal.skillId)) === removal;
}

/** Ends `removal` when it still waits. */
export function releaseRemoval(removal: HeldRemoval): void {
  if (removalWaits(removal)) dropHold(removalKey(removal.host, removal.agentId, removal.skillId));
}

/** Takes back the waiting remove of this skill, so the host keeps it. False when none waits. */
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

/** Calls `listener` when a change that a toast held ends on the host. Returns the stop function. */
export function onHeldChangeSettled(listener: (settled: SettledChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function heldChangeSettled(settled: SettledChange): void {
  for (const listener of listeners) listener(settled);
}
