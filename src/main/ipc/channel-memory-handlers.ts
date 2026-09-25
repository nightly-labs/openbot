// What a channel remembers: the notes every member of it carries into a turn.

import { decodeChannelMemories, decodeChannelMemory } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { AgentService } from "../../backend/agent-service";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseChannelId,
  parseCreateChannelMemory,
  parseDeleteChannelMemory,
  parseUpdateChannelMemory,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

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
      listChannelMemories: scopedHandler(parseChannelId, {
        local: (channelId) => service.listChannelMemories(channelId),
        remote: (channelId, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.memories, decodeChannelMemories, {
            method: "POST",
            body: { channelId },
          }),
      }),
      createChannelMemory: scopedHandler(parseCreateChannelMemory, {
        local: (parsed) => service.createChannelMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.memoryCreate, decodeChannelMemory, {
            method: "POST",
            body: parsed,
          }),
      }),
      updateChannelMemory: scopedHandler(parseUpdateChannelMemory, {
        local: (parsed) => service.updateChannelMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.memoryUpdate, decodeChannelMemory, {
            method: "POST",
            body: parsed,
          }),
      }),
      deleteChannelMemory: scopedHandler(parseDeleteChannelMemory, {
        local: (parsed) => service.deleteChannelMemory(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.memoryDelete, decodeVoid, {
            method: "POST",
            body: parsed,
          }),
      }),
      clearChannelMemories: scopedHandler(parseChannelId, {
        local: (channelId) => service.clearChannelMemories(channelId),
        remote: (channelId, serverId) =>
          remoteServers.request(serverId, CHANNEL_ROUTES.memoryClear, decodeVoid, {
            method: "POST",
            body: { channelId },
          }),
      }),
    },
  };
}
