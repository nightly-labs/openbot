import type { ServerSummary } from "@openbot/contracts/ipc";
import { readHostAnalytics, runTeamEffect } from "@openbot/team-client";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { type Accessor, createEffect, untrack } from "solid-js";
import type { UsagePort } from "../usage/usage-port";
import type { WebWorkspace } from "./web-client-context";

/** The usage report's calls on the connected host. The report reads the server list again when the host is online. */
export function createWebUsagePort(
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">,
  hostRequest: (serverId?: string) => TeamApiRequest,
  servers: Accessor<ServerSummary[]>,
): UsagePort {
  const usageServerListeners = new Set<(servers: ServerSummary[]) => void>();
  createEffect(
    () => workspace.state.status,
    (state) => {
      if (state === "online") for (const listener of usageServerListeners) listener(untrack(servers));
    },
  );
  return {
    agent: {
      getHostAnalytics: (input, serverId) =>
        runTeamEffect(
          readHostAnalytics(hostRequest(serverId), workspace.state.capabilities, input).pipe(
            Effect.mapError((error) => error.cause),
          ),
        ),
      listAgents: () => workspace.runtime.listAgents(),
      onScopedEvent: (listener) =>
        workspace.onHostEvent((event) => {
          if (event.type === "turn-completed") listener({ serverId: workspace.state.host?.hostId ?? "", event });
        }),
    },
    servers: {
      onEvent: (listener) => {
        usageServerListeners.add(listener);
        return () => usageServerListeners.delete(listener);
      },
    },
  };
}
