// Channel routines: a standing instruction that fires into the channel on a schedule.

import {
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import type { AgentService } from "../../backend/agent-service";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  agentRequest,
  parseChannelId,
  parseCreateChannelRoutine,
  parseDeleteChannelRoutine,
  parseListChannelRoutineRuns,
  parseTestChannelRoutine,
  parseUpdateChannelRoutine,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

interface ChannelRoutineIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function channelRoutineIpcHandlers({
  service,
  remoteServers,
}: ChannelRoutineIpcDependencies): Pick<IpcGroupHandlers, "channelRoutines"> {
  return {
    channelRoutines: {
      listChannelRoutines: payloadHandler(agentRequest(parseChannelId), (scoped) => {
        const channelId = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.listChannelRoutines(channelId),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
              method: "POST",
              body: { channelId },
            }),
        });
      }),
      createChannelRoutine: payloadHandler(agentRequest(parseCreateChannelRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.createChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      updateChannelRoutine: payloadHandler(agentRequest(parseUpdateChannelRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.updateChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      deleteChannelRoutine: payloadHandler(agentRequest(parseDeleteChannelRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.deleteChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineDelete, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      testChannelRoutine: payloadHandler(agentRequest(parseTestChannelRoutine), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.testChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      listChannelRoutineRuns: payloadHandler(agentRequest(parseListChannelRoutineRuns), (scoped) => {
        const parsed = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.listChannelRoutineRuns(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
    },
  };
}
