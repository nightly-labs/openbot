import {
  CHANNEL_CHATS_CAPABILITY,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  type Routine,
  type RoutineCalendarOwner,
  type RoutineRunPlace,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import {
  decodeRoutinePauseReasons,
  ROUTINE_PAUSE_REASONS_CAPABILITY,
  ROUTINE_PAUSE_REASONS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-pause-reasons-v1";
import {
  decodeRoutineRunChanges,
  decodeRoutineRunChangesList,
  ROUTINE_RUN_CHANGES_CAPABILITY,
  ROUTINE_RUN_CHANGES_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-changes-v1";
import {
  decodeRoutineRunCommandResponse,
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import {
  decodeRoutineRunPlace,
  decodeRoutineRunPlaces,
  ROUTINE_RUN_PLACE_CAPABILITY,
  ROUTINE_RUN_PLACE_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
import {
  decodeOnceAgentRoutines,
  decodeOnceChannelRoutines,
  ROUTINES_ONCE_CAPABILITY,
  ROUTINES_ONCE_ROUTES,
} from "@openbot/contracts/team-protocol/routines-once-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import {
  createOnceAgentRoutine,
  isOnceSchedule,
  listOnceAgentRoutines,
  type RoutinesOncePost,
  requireReleasedScheduleOn,
  updateAgentRoutineOnce,
} from "@openbot/team-client/routines-once";
import {
  withRoutinePauseReasons,
  withRoutineRunChanges,
  withRoutineRunPlaces,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { localRoutineCalendarSource } from "../local-routine-calendar";
import {
  decodeAgentSummaries,
  decodeRoutine,
  decodeRoutineRun,
  decodeRoutineRuns,
  decodeRoutines,
} from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { syncedOrRequest } from "../remote-server-sync";
import type { RemoteWorkflowError } from "../remote-service-effects";
import {
  parseAgentId,
  parseCreateRoutine,
  parseDeleteRoutine,
  parseListRoutineRuns,
  parseRoutineCalendar,
  parseTestRoutine,
  parseUpdateRoutine,
} from "./agent-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

const runPlaceLogger = createOpenBotLogger("routine-run-place");

interface RoutineIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
}

export function routineIpcHandlers({
  service,
  remoteServers,
}: RoutineIpcDependencies): Pick<IpcGroupHandlers, "agentRoutines"> {
  return {
    agentRoutines: {
      listRoutines: scopedHandler(parseAgentId, {
        local: (agentId) => service.listRoutines(agentId),
        remote: (agentId, serverId) =>
          withRemoteRunChangesList(
            remoteServers,
            serverId,
            agentId,
            withOnceRoutines(
              remoteServers,
              serverId,
              Effect.gen(function* () {
                const routines = syncedOrRequest(remoteServers.sync.routines.values(serverId, agentId), () =>
                  remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
                );
                const runPlaces = remoteServers.supportsCapability(serverId, ROUTINE_RUN_PLACE_CAPABILITY);
                const pauseReasons = remoteServers.supportsCapability(serverId, ROUTINE_PAUSE_REASONS_CAPABILITY);
                if (!runPlaces && !pauseReasons) return yield* routines;
                const [list, places, reasons] = yield* Effect.all(
                  [
                    routines,
                    runPlaces
                      ? remoteServers.request(serverId, ROUTINE_RUN_PLACE_ROUTES.list, decodeRoutineRunPlaces, {
                          method: "POST",
                          body: { agentId },
                        })
                      : Effect.succeed([]),
                    pauseReasons
                      ? remoteServers.request(serverId, ROUTINE_PAUSE_REASONS_ROUTES.list, decodeRoutinePauseReasons, {
                          method: "POST",
                          body: { agentId },
                        })
                      : Effect.succeed([]),
                  ],
                  { concurrency: "unbounded" },
                );
                return withRoutinePauseReasons(withRoutineRunPlaces(list, places), reasons);
              }),
              (send) => listOnceAgentRoutines(send, agentId),
            ),
          ),
      }),
      createRoutine: scopedHandler(parseCreateRoutine, {
        local: (parsed) => service.createRoutine(parsed),
        remote: async ({ runsChangeRoutines, ...input }, serverId) => {
          const created = async () => {
            if (isOnceSchedule(input.schedule)) {
              const once = remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY);
              requireReleasedScheduleOn(input.schedule, once);
              return createOnceAgentRoutine(remoteOnceSend(remoteServers, serverId), input);
            }
            const { runIn, ...parsed } = input;
            return runCauseEffect(
              remoteServers
                .request(serverId, TEAM_API_ROUTES.agent.routines(parsed.agentId), decodeRoutine, {
                  method: "POST",
                  body: parsed,
                })
                .pipe(Effect.flatMap((routine) => withRemoteRunPlace(remoteServers, serverId, routine, runIn, true))),
            );
          };
          return withRemoteRunChanges(remoteServers, serverId, await created(), runsChangeRoutines, true);
        },
      }),
      updateRoutine: scopedHandler(parseUpdateRoutine, {
        local: (parsed) => service.updateRoutine(parsed),
        remote: async ({ runsChangeRoutines, ...input }, serverId) => {
          const updated = async () => {
            if (remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY))
              return updateAgentRoutineOnce(remoteOnceSend(remoteServers, serverId), input);
            requireReleasedScheduleOn(input.schedule, false);
            const { runIn, ...parsed } = input;
            return runCauseEffect(
              remoteServers
                .request(serverId, TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId), decodeRoutine, {
                  method: "PATCH",
                  body: parsed,
                })
                .pipe(Effect.flatMap((routine) => withRemoteRunPlace(remoteServers, serverId, routine, runIn))),
            );
          };
          return withRemoteRunChanges(remoteServers, serverId, await updated(), runsChangeRoutines);
        },
      }),
      deleteRoutine: scopedHandler(parseDeleteRoutine, {
        local: (parsed) => runCauseEffect(service.deleteRoutine(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId),
              decodeVoid,
              {
                method: "DELETE",
              },
            ),
          ),
      }),
      testRoutine: scopedHandler(parseTestRoutine, {
        local: (parsed) => runCauseEffect(service.testRoutine(parsed)),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.routineTest(parsed.agentId, parsed.routineId),
              decodeRoutineRun,
              { method: "POST" },
            ),
          ),
      }),
      listRoutineRuns: scopedHandler(parseListRoutineRuns, {
        local: (parsed) => service.listRoutineRuns(parsed, true),
        remote: (parsed, serverId) =>
          runCauseEffect(
            remoteServers.request(
              serverId,
              `${TEAM_API_ROUTES.agent.routineRuns(parsed.agentId, parsed.routineId)}?limit=${parsed.limit}`,
              decodeRoutineRuns,
            ),
          ),
      }),
      automationRunCommand: scopedHandler(parseTestRoutine, {
        local: (parsed) => service.automationRunCommand(parsed),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, ROUTINE_RUN_COMMAND_CAPABILITY))
            throw new Error(sourceText("error.team.routineRunCommandUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, ROUTINE_RUN_COMMAND_ROUTES.command, decodeRoutineRunCommandResponse, {
              method: "POST",
              body: { agentId: parsed.agentId, routineId: parsed.routineId },
            }),
          );
        },
      }),
      routineCalendar: scopedHandler(parseRoutineCalendar, {
        local: (input) => calendar(input, localRoutineCalendarSource(service)),
        remote: (input, serverId) => calendar(input, remoteCalendarSource(remoteServers, serverId)),
      }),
    },
  };
}

function withRemoteRunPlace(
  remoteServers: RemoteServerManager,
  serverId: string,
  routine: Routine,
  runIn: RoutineRunPlace | undefined,
  created = false,
) {
  if (!runIn || !remoteServers.supportsCapability(serverId, ROUTINE_RUN_PLACE_CAPABILITY))
    return Effect.succeed(routine);
  const placed = remoteServers
    .request(serverId, ROUTINE_RUN_PLACE_ROUTES.set, decodeRoutineRunPlace, {
      method: "POST",
      body: { agentId: routine.agentId, routineId: routine.id, runIn },
    })
    .pipe(Effect.map((place): Routine => ({ ...routine, runIn: place.runIn })));
  if (!created) return placed;
  return placed.pipe(
    Effect.catch(() =>
      Effect.sync((): Routine => {
        runPlaceLogger.warn("The run place of a new remote routine was not set. The routine runs in the chat.");
        return { ...routine, runIn: "chat" };
      }),
    ),
  );
}

async function withRemoteRunChangesList(
  remoteServers: RemoteServerManager,
  serverId: string,
  agentId: string,
  routines: Promise<Routine[]>,
): Promise<Routine[]> {
  if (!remoteServers.supportsCapability(serverId, ROUTINE_RUN_CHANGES_CAPABILITY)) return routines;
  const [list, entries] = await Promise.all([
    routines,
    runCauseEffect(
      remoteServers.request(serverId, ROUTINE_RUN_CHANGES_ROUTES.list, decodeRoutineRunChangesList, {
        method: "POST",
        body: { agentId },
      }),
    ),
  ]);
  return withRoutineRunChanges(list, entries);
}

async function withRemoteRunChanges(
  remoteServers: RemoteServerManager,
  serverId: string,
  routine: Routine,
  runsChangeRoutines: boolean | undefined,
  created = false,
): Promise<Routine> {
  if (runsChangeRoutines === undefined || !remoteServers.supportsCapability(serverId, ROUTINE_RUN_CHANGES_CAPABILITY))
    return routine;
  const set = runCauseEffect(
    remoteServers.request(serverId, ROUTINE_RUN_CHANGES_ROUTES.set, decodeRoutineRunChanges, {
      method: "POST",
      body: { agentId: routine.agentId, routineId: routine.id, runsChangeRoutines },
    }),
  );
  const entry = created
    ? await set.catch(() => {
        runPlaceLogger.warn("The run changes setting of a new remote routine was not set. It stays off.");
        return { runsChangeRoutines: false };
      })
    : await set;
  return { ...routine, runsChangeRoutines: entry.runsChangeRoutines };
}

export function remoteOnceSend(remoteServers: RemoteServerManager, serverId: string): RoutinesOncePost {
  return (path, decode, body) =>
    runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
}

export async function withOnceRoutines<R>(
  remoteServers: RemoteServerManager,
  serverId: string,
  released: Effect.Effect<R[], RemoteWorkflowError>,
  listOnce: (send: RoutinesOncePost) => Promise<R[]>,
): Promise<R[]> {
  if (!remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY)) return runCauseEffect(released);
  const [list, once] = await Promise.all([runCauseEffect(released), listOnce(remoteOnceSend(remoteServers, serverId))]);
  return [...list, ...once];
}

function calendar(input: { from: string; to: string }, source: RoutineCalendarSource<RemoteWorkflowError>) {
  return runCauseEffect(
    buildRoutineCalendar({ from: new Date(input.from), to: new Date(input.to) }, new Date(), source),
  );
}

function remoteCalendarSource(
  remoteServers: RemoteServerManager,
  serverId: string,
): RoutineCalendarSource<RemoteWorkflowError> {
  const once = remoteServers.supportsCapability(serverId, ROUTINES_ONCE_CAPABILITY);
  const withOnce = <R extends { id: string }>(
    released: Effect.Effect<R[], RemoteWorkflowError>,
    path: string,
    decode: (value: unknown) => R[],
    owner: { kind: "agent" | "channel"; id: string },
  ): Effect.Effect<R[], RemoteWorkflowError> =>
    once
      ? Effect.all([released, remoteServers.request(serverId, path, decode, { method: "POST", body: { owner } })], {
          concurrency: "unbounded",
        }).pipe(Effect.map(([list, extra]) => [...list, ...extra]))
      : released;
  return {
    owners: () =>
      Effect.gen(function* () {
        const [agents, channels] = yield* Effect.all(
          [
            remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
            remoteServers.supportsCapability(serverId, CHANNEL_CHATS_CAPABILITY)
              ? remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries)
              : Effect.succeed([]),
          ],
          { concurrency: "unbounded" },
        );
        return [
          ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
          ...channels
            .filter((channel) => !channel.archived)
            .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
        ];
      }),
    routines: (owner) =>
      owner.kind === "agent"
        ? withOnce(
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(owner.agentId), decodeRoutines),
            ROUTINES_ONCE_ROUTES.list,
            (value) => decodeOnceAgentRoutines(value, owner.agentId),
            { kind: "agent", id: owner.agentId },
          )
        : withOnce(
            remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
              method: "POST",
              body: { channelId: owner.channelId },
            }),
            ROUTINES_ONCE_ROUTES.list,
            (value) => decodeOnceChannelRoutines(value, owner.channelId),
            { kind: "channel", id: owner.channelId },
          ),
    runs: (owner, routineId, limit) =>
      owner.kind === "agent"
        ? remoteServers.request(
            serverId,
            `${TEAM_API_ROUTES.agent.routineRuns(owner.agentId, routineId)}?limit=${limit}`,
            decodeRoutineRuns,
          )
        : remoteServers.request(serverId, CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
            method: "POST",
            body: { channelId: owner.channelId, routineId, limit },
          }),
  };
}
