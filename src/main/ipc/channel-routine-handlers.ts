// Channel routines: a standing instruction that fires into the channel on a schedule.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
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
  parseAgentRequest,
  parseCreateChannelRoutine,
  parseDeleteChannelRoutine,
  parseListChannelRoutineRuns,
  parseTestChannelRoutine,
  parseUpdateChannelRoutine,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { requireString } from "./validation";

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
      listChannelRoutines: payloadHandler(parseAgentRequest, (scoped) => {
        const channelId = requireString(scoped.payload, "channelId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.listChannelRoutines(channelId),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
              method: "POST",
              body: { channelId },
            }),
        });
      }),
      createChannelRoutine: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseCreateChannelRoutine(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.createChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      updateChannelRoutine: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseUpdateChannelRoutine(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.updateChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      deleteChannelRoutine: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseDeleteChannelRoutine(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.deleteChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineDelete, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      testChannelRoutine: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseTestChannelRoutine(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.testChannelRoutine(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, {
              method: "POST",
              body: parsed,
            }),
        });
      }),
      listChannelRoutineRuns: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseListChannelRoutineRuns(scoped.payload);
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
