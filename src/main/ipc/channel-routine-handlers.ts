// Channel routines: a standing instruction that fires into the channel on a schedule.

import {
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { ROUTINE_STATUS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-status-v1";
import {
  readRoutineStatuses,
  saveRoutineStatus,
  type TeamApiRequest,
  teamChannelsApi,
} from "@openbot/team-client/team-api-requests";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseChannelId,
  parseCreateChannelRoutine,
  parseDeleteChannelRoutine,
  parseListChannelRoutineRuns,
  parseTestChannelRoutine,
  parseUpdateChannelRoutine,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface ChannelRoutineIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function channelRoutineIpcHandlers({
  service,
  remoteServers,
}: ChannelRoutineIpcDependencies): Pick<IpcGroupHandlers, "channelRoutines"> {
  const statusRequest =
    (serverId: string): TeamApiRequest =>
    (method, path, decode, body) =>
      runCauseEffect(remoteServers.request(serverId, path, decode, { method, body }));
  return {
    channelRoutines: {
      listChannelRoutines: scopedHandler(parseChannelId, {
        local: (channelId) => service.listChannelRoutines(channelId),
        remote: (channelId, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
              method: "POST",
              body: { channelId },
            }),
          ).then((routines) =>
            readRoutineStatuses(
              statusRequest(serverId),
              { kind: "channel", id: channelId },
              routines,
              remoteServers.supportsCapability(serverId, ROUTINE_STATUS_CAPABILITY),
            ),
          ),
      }),
      createChannelRoutine: scopedHandler(parseCreateChannelRoutine, {
        local: (parsed) => service.createChannelRoutine(parsed),
        remote: ({ silent, ...parsed }, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
          ).then((routine) =>
            saveRoutineStatus(
              statusRequest(serverId),
              { kind: "channel", id: parsed.channelId },
              routine,
              silent,
              remoteServers.supportsCapability(serverId, ROUTINE_STATUS_CAPABILITY),
              true,
            ),
          ),
      }),
      updateChannelRoutine: scopedHandler(parseUpdateChannelRoutine, {
        local: (parsed) => service.updateChannelRoutine(parsed),
        remote: (parsed, serverId) =>
          teamChannelsApi(statusRequest(serverId), () =>
            remoteServers.supportsCapability(serverId, ROUTINE_STATUS_CAPABILITY),
          ).updateChannelRoutine(parsed),
      }),
      deleteChannelRoutine: scopedHandler(parseDeleteChannelRoutine, {
        local: (parsed) => service.deleteChannelRoutine(parsed),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineDelete, decodeVoid, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      testChannelRoutine: scopedHandler(parseTestChannelRoutine, {
        local: (parsed) => runCauseEffect(service.testChannelRoutine(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
      listChannelRoutineRuns: scopedHandler(parseListChannelRoutineRuns, {
        local: (parsed) => service.listChannelRoutineRuns(parsed, true),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
              method: "POST",
              body: parsed,
            }),
          ),
      }),
    },
  };
}
