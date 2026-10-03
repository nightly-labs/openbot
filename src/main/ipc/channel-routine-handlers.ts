import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
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
  return {
    channelRoutines: {
      listChannelRoutines: scopedHandler(parseChannelId, {
        local: (channelId) => service.listChannelRoutines(channelId),
        remote: (channelId, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
                method: "POST",
                body: { channelId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      createChannelRoutine: scopedHandler(parseCreateChannelRoutine, {
        local: (parsed) => service.createChannelRoutine(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routineCreate, decodeChannelRoutine, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      updateChannelRoutine: scopedHandler(parseUpdateChannelRoutine, {
        local: (parsed) => service.updateChannelRoutine(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routineUpdate, decodeChannelRoutine, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      deleteChannelRoutine: scopedHandler(parseDeleteChannelRoutine, {
        local: (parsed) => service.deleteChannelRoutine(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routineDelete, decodeVoid, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      testChannelRoutine: scopedHandler(parseTestChannelRoutine, {
        local: (parsed) =>
          Effect.runPromise(service.testChannelRoutine(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routineTest, decodeChannelRoutineRun, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      listChannelRoutineRuns: scopedHandler(parseListChannelRoutineRuns, {
        local: (parsed) => service.listChannelRoutineRuns(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
    },
  };
}
