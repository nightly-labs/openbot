import { randomUUID } from "node:crypto";
import type { BrowserPermissionRequest } from "@openbot/contracts/ipc";

type Answer = (granted: boolean) => void;

interface PendingLocation {
  id: string;
  origin: string;
  answers: Answer[];
  deadline: ReturnType<typeof setTimeout>;
}

const LOCATION_ANSWER_TIMEOUT_MS = 10 * 60_000;

interface TabLocation {
  owner: string;
  pending?: PendingLocation | undefined;
  decision?: { origin: string; allowed: boolean } | undefined;
}

export const EVERY_LOCATION_OWNER = "*";

export function alwaysLocationKey(owner: string, origin: string): string {
  return `${owner}\n${origin}`;
}

export function locationOwner(tab: { ownerAgentId: string | null; ownerThreadId: string | null }): string | null {
  if (tab.ownerAgentId !== null) return `agent:${tab.ownerAgentId}`;
  return tab.ownerThreadId === null ? null : `thread:${tab.ownerThreadId}`;
}

export function locationOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function settle(pending: PendingLocation | undefined, granted: boolean): void {
  if (pending) clearTimeout(pending.deadline);
  for (const answer of pending?.answers ?? []) answer(granted);
}

export class BrowserLocationRequests {
  readonly #tabs = new Map<string, TabLocation>();
  readonly #always = new Set<string>();
  readonly #changed: (tabId: string) => void;

  constructor(changed: (tabId: string) => void) {
    this.#changed = changed;
  }

  #alwaysAllowed(owner: string, origin: string): boolean {
    return (
      this.#always.has(alwaysLocationKey(EVERY_LOCATION_OWNER, origin)) ||
      this.#always.has(alwaysLocationKey(owner, origin))
    );
  }

  ask(tabId: string, owner: string, origin: string, answer: Answer): void {
    const state = this.#tabs.get(tabId) ?? { owner };
    state.owner = owner;
    this.#tabs.set(tabId, state);
    if (state.decision?.origin === origin) {
      answer(state.decision.allowed);
      return;
    }
    if (state.pending?.origin === origin) {
      state.pending.answers.push(answer);
      return;
    }
    const replaced = state.pending;
    settle(replaced, false);
    if (this.#alwaysAllowed(owner, origin)) {
      state.pending = undefined;
      state.decision = { origin, allowed: true };
      if (replaced) this.#changed(tabId);
      answer(true);
      return;
    }
    const id = randomUUID();
    const deadline = setTimeout(() => this.decide(tabId, id, false), LOCATION_ANSWER_TIMEOUT_MS);
    deadline.unref?.();
    state.pending = { id, origin, answers: [answer], deadline };
    this.#changed(tabId);
  }

  allowed(tabId: string, owner: string, origin: string): boolean {
    const decision = this.#tabs.get(tabId)?.decision;
    if (decision?.origin === origin) return decision.allowed;
    return this.#alwaysAllowed(owner, origin);
  }

  request(tabId: string): BrowserPermissionRequest | undefined {
    const pending = this.#tabs.get(tabId)?.pending;
    return pending ? { id: pending.id, origin: pending.origin, permission: "geolocation" } : undefined;
  }

  pendingOrigin(tabId: string, requestId: string): string | null {
    const pending = this.#tabs.get(tabId)?.pending;
    return pending?.id === requestId ? pending.origin : null;
  }

  decide(tabId: string, requestId: string, allowed: boolean, alwaysOwner: string | null = null): boolean {
    const state = this.#tabs.get(tabId);
    const pending = state?.pending;
    if (!state || pending?.id !== requestId) return false;
    if (!allowed || alwaysOwner === null) {
      this.#settle(tabId, state, allowed);
      return true;
    }
    this.#always.add(alwaysLocationKey(alwaysOwner, pending.origin));
    for (const [otherTabId, other] of [...this.#tabs]) {
      if (alwaysOwner !== EVERY_LOCATION_OWNER && other.owner !== alwaysOwner) continue;
      if (other.decision?.origin === pending.origin && !other.decision.allowed) other.decision = undefined;
      if (other.pending?.origin === pending.origin) this.#settle(otherTabId, other, true);
    }
    return true;
  }

  #settle(tabId: string, state: TabLocation, allowed: boolean): void {
    const pending = state.pending;
    if (!pending) return;
    state.pending = undefined;
    state.decision = { origin: pending.origin, allowed };
    settle(pending, allowed);
    this.#changed(tabId);
  }

  navigated(tabId: string, origin: string | null): boolean {
    const state = this.#tabs.get(tabId);
    if (!state) return false;
    const pendingDropped = state.pending !== undefined && state.pending.origin !== origin;
    const allowedDropped = state.decision !== undefined && state.decision.origin !== origin && state.decision.allowed;
    if (pendingDropped) {
      settle(state.pending, false);
      state.pending = undefined;
    }
    if (state.decision && state.decision.origin !== origin) state.decision = undefined;
    if (!state.pending && !state.decision) this.#tabs.delete(tabId);
    if (pendingDropped) this.#changed(tabId);
    return allowedDropped;
  }

  forget(tabId: string): void {
    const state = this.#tabs.get(tabId);
    if (!state) return;
    this.#tabs.delete(tabId);
    settle(state.pending, false);
    if (state.pending) this.#changed(tabId);
  }

  clear(): void {
    for (const tabId of [...this.#tabs.keys()]) this.forget(tabId);
    this.#always.clear();
  }
}
