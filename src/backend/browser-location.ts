import { randomUUID } from "node:crypto";
import type { BrowserPermissionRequest } from "@openbot/contracts/ipc";

type Answer = (granted: boolean) => void;

interface PendingLocation {
  id: string;
  origin: string;
  answers: Answer[];
}

interface TabLocation {
  pending?: PendingLocation | undefined;
  decision?: { origin: string; allowed: boolean } | undefined;
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
  for (const answer of pending?.answers ?? []) answer(granted);
}

export class BrowserLocationRequests {
  readonly #tabs = new Map<string, TabLocation>();
  readonly #always = new Set<string>();
  readonly #changed: (tabId: string) => void;

  constructor(changed: (tabId: string) => void) {
    this.#changed = changed;
  }

  ask(tabId: string, origin: string, answer: Answer): void {
    const state = this.#tabs.get(tabId) ?? {};
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
    if (this.#always.has(origin)) {
      state.pending = undefined;
      state.decision = { origin, allowed: true };
      if (replaced) this.#changed(tabId);
      answer(true);
      return;
    }
    state.pending = { id: randomUUID(), origin, answers: [answer] };
    this.#changed(tabId);
  }

  allowed(tabId: string, origin: string): boolean {
    const decision = this.#tabs.get(tabId)?.decision;
    return (decision?.origin === origin && decision.allowed) || this.#always.has(origin);
  }

  request(tabId: string): BrowserPermissionRequest | undefined {
    const pending = this.#tabs.get(tabId)?.pending;
    return pending ? { id: pending.id, origin: pending.origin, permission: "geolocation" } : undefined;
  }

  pendingOrigin(tabId: string, requestId: string): string | null {
    const pending = this.#tabs.get(tabId)?.pending;
    return pending?.id === requestId ? pending.origin : null;
  }

  decide(tabId: string, requestId: string, allowed: boolean, always = false): boolean {
    const state = this.#tabs.get(tabId);
    const pending = state?.pending;
    if (!state || pending?.id !== requestId) return false;
    if (!allowed || !always) {
      this.#settle(tabId, state, allowed);
      return true;
    }
    this.#always.add(pending.origin);
    for (const [askingTabId, asking] of [...this.#tabs])
      if (asking.pending?.origin === pending.origin) this.#settle(askingTabId, asking, true);
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
