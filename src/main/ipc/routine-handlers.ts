import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// Routines: the scheduled standing instructions attached to one agent, and the calendar of every
// routine of a host.

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
import { withRoutineRunPlaces } from "@openbot/team-client/team-api-requests";
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
          withOnceRoutines(
            remoteServers,
            serverId,
            Effect.gen(function* () {
              const routines = remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines);
              if (!remoteServers.supportsCapability(serverId, ROUTINE_RUN_PLACE_CAPABILITY)) return yield* routines;
              const [list, places] = yield* Effect.all(
                [
                  routines,
                  remoteServers.request(serverId, ROUTINE_RUN_PLACE_ROUTES.list, decodeRoutineRunPlaces, {
                    method: "POST",
                    body: { agentId },
                  }),
                ],
                { concurrency: "unbounded" },
              );
              return withRoutineRunPlaces(list, places);
            }),
            (send) => listOnceAgentRoutines(send, agentId),
          ),
      }),
      createRoutine: scopedHandler(parseCreateRoutine, {
        local: (parsed) => service.createRoutine(parsed),
        remote: (input, serverId) => {
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
        },
      }),
      updateRoutine: scopedHandler(parseUpdateRoutine, {
        local: (parsed) => service.updateRoutine(parsed),
        remote: (input, serverId) => {
          // The routes of `routines-once-v1` change every schedule routine, the place too, so a routine
          // can go from `once` to a released kind and back.
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
        // The command runs in a shell on the host. An owner or admin gets it from a host with
        // `routine-run-command-v1`; the renderer shows Copy run command only then.
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

/**
 * The released routine routes leave out where a routine runs, so a host with `routine-run-place-v1`
 * gets the place on its own route after the save. A host without it keeps the saved place. The new
 * routine exists, so a failed place does not fail the create: the routine runs in the chat, and a
 * second save does not make a second routine.
 */
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

/** One POST of `routines-once-v1` to a joined server, for the shared client calls. */
export function remoteOnceSend(remoteServers: RemoteServerManager, serverId: string): RoutinesOncePost {
  return (path, decode, body) =>
    runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
}

/**
 * The released routine list of a joined server, with the `once` routines of a host with
 * `routines-once-v1`. The released routes leave them out.
 */
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

/**
 * A remote host answers through the routes its routine settings already use, so no new route is needed.
 * A host with `routines-once-v1` also gives its `once` routines.
 */
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
        // A host from before channels rejects the channel routes; its agents still have routines.
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
