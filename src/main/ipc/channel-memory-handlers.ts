// What a channel remembers: the notes every member of it carries into a turn.

import { decodeChannelMemories, decodeChannelMemory } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { AgentService } from "../../backend/agent-service";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  agentRequest,
  parseChannelId,
  parseCreateChannelMemory,
  parseDeleteChannelMemory,
  parseUpdateChannelMemory,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

interface ChannelMemoryIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function channelMemoryIpcHandlers({
  service,
  remoteServers,
}: ChannelMemoryIpcDependencies): Pick<IpcGroupHandlers, "channelMemories"> {
  return {
    channelMemories: {
      listChannelMemories: payloadHandler(agentRequest(parseChannelId), (scoped) => {
        const channelId = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.listChannelMemories(channelId),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.memories, decodeChannelMemories, {
              method: "POST",
              body: { channelId },
            }),
        });
      }),
      createChannelMemory: payloadHandler(agentRequest(parseCreateChannelMemory), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.createChannelMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.memoryCreate, decodeChannelMemory, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      updateChannelMemory: payloadHandler(agentRequest(parseUpdateChannelMemory), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.updateChannelMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.memoryUpdate, decodeChannelMemory, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      deleteChannelMemory: payloadHandler(agentRequest(parseDeleteChannelMemory), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.deleteChannelMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.memoryDelete, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      clearChannelMemories: payloadHandler(agentRequest(parseChannelId), (scoped) => {
        const channelId = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.clearChannelMemories(channelId),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.memoryClear, decodeVoid, {
              method: "POST",
              body: { channelId },
            }),
        });
      }),
    },
  };
}
