import type { AgentEvent, AgentSummary, ServerSummary, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { readHostAnalytics } from "@openbot/team-client";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { createEffect } from "solid-js";
import type { UsagePort } from "../usage/usage-port";

/** The usage report of the opened host, read through this tab's connection to it. */
export function createWebUsagePort(options: {
  /** Throws when `serverId` is not the opened host. */
  request(serverId?: string): TeamApiRequest;
  capabilities(): readonly string[];
  listAgents(): Promise<AgentSummary[]>;
  hostId(): string | null;
  onHostEvent(listener: (event: AgentEvent | TeamRealtimeEvent) => void): () => void;
  servers(): ServerSummary[];
}): UsagePort {
  const serverListeners = new Set<(servers: ServerSummary[]) => void>();
  createEffect(options.servers, (servers) => {
    for (const listener of serverListeners) listener(servers);
  });
  return {
    agent: {
      getHostAnalytics: (input, serverId) =>
        readHostAnalytics(options.request(serverId), options.capabilities(), input),
      async listAgents(serverId) {
        options.request(serverId);
        return options.listAgents();
      },
      onScopedEvent: (listener) =>
        options.onHostEvent((event) => {
          const serverId = options.hostId();
          if (serverId && event.type === "turn-completed") listener({ serverId, event });
        }),
    },
    servers: {
      onEvent(listener) {
        serverListeners.add(listener);
        return () => {
          serverListeners.delete(listener);
        };
      },
    },
  };
}
