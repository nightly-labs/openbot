// Channel routines: a standing instruction that fires into the channel on a schedule.

import {
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
} from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import {
  createOnceChannelRoutine,
  isOnceSchedule,
  listOnceChannelRoutines,
  requireReleasedScheduleOn,
  updateChannelRoutineOnce,
} from "@openbot/team-client/routines-once";
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
import { remoteOnceSend, withOnceRoutines } from "./routine-handlers";
import { scopedHandler } from "./scoped-handler";

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
      listChannelRoutines: scopedHandler(parseChannelId, {
        local: (channelId) => service.listChannelRoutines(channelId),
        remote: (channelId, serverId) =>
          withOnceRoutines(
            remoteServers,
            serverId,
            remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
              method: "POST",
              body: { channelId },
            }),
            (send) => listOnceChannelRoutines(send, channelId),
          ),
      }),
      createChannelRoutine: scopedHandler(parseCreateChannelRoutine, {
        local: (parsed) => service.createChannelRoutine(parsed),
        remote: (parsed, serverId) => {
          if (isOnceSchedule(parsed.schedule)) {
            requireReleasedScheduleOn(
              parsed.schedule,
              remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY),
            );
            return createOnceChannelRoutine(remoteOnceSend(remoteServers, serverId), parsed);
          }
          return runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
          );
        },
      }),
      updateChannelRoutine: scopedHandler(parseUpdateChannelRoutine, {
        local: (parsed) => service.updateChannelRoutine(parsed),
        remote: (parsed, serverId) => {
          // As for an agent: a host with `routines-once-v1` changes every schedule routine on its routes.
          if (remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY))
            return updateChannelRoutineOnce(remoteOnceSend(remoteServers, serverId), parsed);
          requireReleasedScheduleOn(parsed.schedule, false);
          return runCauseEffect(
            remoteServers.request(serverId, CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, {
              method: "POST",
              body: parsed,
            }),
          );
        },
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
