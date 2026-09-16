// Watchers: generic event checks attached to one agent. Local-only: checks run on this
// computer and their state stays in the local database, so remote team servers are rejected.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentService } from "../../backend/agent-service";
import {
  parseAgentRequest,
  parseCreateWatcher,
  parseDeleteWatcher,
  parseListWatcherMatches,
  parseTestWatcher,
  parseUpdateWatcher,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { requireString } from "./validation";

interface WatcherIpcDependencies {
  service: AgentService;
}

function remoteNotSupported(): never {
  throw new Error("Watchers stay on this computer.");
}

export function watcherIpcHandlers({ service }: WatcherIpcDependencies): Pick<IpcGroupHandlers, "agentWatchers"> {
  return {
    agentWatchers: {
      listWatchers: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.listWatchers(agentId),
          remote: () => remoteNotSupported(),
        });
      }),
      createWatcher: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseCreateWatcher(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.createWatcher(parsed),
          remote: () => remoteNotSupported(),
        });
      }),
      updateWatcher: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseUpdateWatcher(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.updateWatcher(parsed),
          remote: () => remoteNotSupported(),
        });
      }),
      deleteWatcher: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseDeleteWatcher(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.deleteWatcher(parsed),
          remote: () => remoteNotSupported(),
        });
      }),
      testWatcher: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseTestWatcher(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.testWatcher(parsed),
          remote: () => remoteNotSupported(),
        });
      }),
      listWatcherMatches: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseListWatcherMatches(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.listWatcherMatches(parsed),
          remote: () => remoteNotSupported(),
        });
      }),
    },
  };
}
