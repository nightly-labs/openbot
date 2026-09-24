import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import type { MobileAgentActivities } from "./agent-activity";

/** Workspace state that host events change many times in one turn. */
export interface LiveWorkspaceState {
  activityByServer: Record<string, MobileAgentActivities>;
  unreadAgentIds: string[];
  browserRequests: Record<string, BrowserTakeoverRequest[]>;
}

/**
 * Keeps this state out of the workspace context value. A context change re-renders every consumer,
 * so each consumer reads only the part it shows through a selector, and only that part re-renders.
 */
export class LiveWorkspaceStore {
  #state: LiveWorkspaceState = { activityByServer: {}, unreadAgentIds: [], browserRequests: {} };
  readonly #listeners = new Set<() => void>();

  get = () => this.#state;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Applies `change` to one field. An unchanged result notifies no subscriber. */
  update<Key extends keyof LiveWorkspaceState>(
    key: Key,
    change: (current: LiveWorkspaceState[Key]) => LiveWorkspaceState[Key],
  ) {
    const current = this.#state[key];
    const next = change(current);
    if (next === current) return;
    this.#state = { ...this.#state, [key]: next };
    for (const listener of this.#listeners) listener();
  }
}
