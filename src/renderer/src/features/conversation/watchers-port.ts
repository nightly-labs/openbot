// The watchers twin of the agent side of `routines-port.ts`: one settings panel, one owner.
// Watchers belong to agents only, so there is no channel twin.

import type { Watcher, WatcherMatch } from "@openbot/contracts/ipc";

export interface WatchersPort {
  ownerId: string;
  list: () => Promise<Watcher[]>;
  listMatches: (watcherId: string, limit: number) => Promise<WatcherMatch[]>;
  setActive: (watcherId: string, active: boolean) => Promise<Watcher>;
  remove: (watcherId: string) => Promise<void>;
  test: (watcherId: string) => Promise<WatcherMatch[]>;
  subscribe: (reload: () => void) => () => void;
}

export function agentWatchersPort(agentId: string): WatchersPort {
  return {
    ownerId: agentId,
    list: () => window.openbot.agent.listWatchers(agentId),
    listMatches: (watcherId, limit) => window.openbot.agent.listWatcherMatches({ agentId, watcherId, limit }),
    setActive: (watcherId, active) => window.openbot.agent.updateWatcher({ agentId, watcherId, active }),
    remove: (watcherId) => window.openbot.agent.deleteWatcher({ agentId, watcherId }),
    test: async (watcherId) => {
      await window.openbot.agent.testWatcher({ agentId, watcherId });
      return window.openbot.agent.listWatcherMatches({ agentId, watcherId, limit: 10 });
    },
    subscribe: (reload) =>
      window.openbot.agent.onEvent((event) => {
        if (event.type === "watchers-changed" && event.agentId === agentId) reload();
      }),
  };
}

/** One-line source summary for list rows. Full URLs stay out of accessible names. */
export function watcherSourceSummary(source: Watcher["source"]): string {
  if (source.kind === "gmail") return source.query;
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}
