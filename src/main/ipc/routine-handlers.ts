import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// Routines: the scheduled standing instructions attached to one agent, and the calendar of every
// routine of a host.

import {
  CHANNEL_CHATS_CAPABILITY,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  type RoutineCalendarOwner,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import { buildRoutineCalendar, type RoutineCalendarSource } from "../../backend/routine-calendar";
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
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines)
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      createRoutine: scopedHandler(parseCreateRoutine, {
        local: (parsed) => service.createRoutine(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.routines(parsed.agentId), decodeRoutine, {
                method: "POST",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      updateRoutine: scopedHandler(parseUpdateRoutine, {
        local: (parsed) => service.updateRoutine(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId), decodeRoutine, {
                method: "PATCH",
                body: parsed,
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      deleteRoutine: scopedHandler(parseDeleteRoutine, {
        local: (parsed) =>
          Effect.runPromise(service.deleteRoutine(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(serverId, TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId), decodeVoid, {
                method: "DELETE",
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      testRoutine: scopedHandler(parseTestRoutine, {
        local: (parsed) => Effect.runPromise(service.testRoutine(parsed).pipe(Effect.mapError((error) => error.cause))),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(
                serverId,
                TEAM_API_ROUTES.agent.routineTest(parsed.agentId, parsed.routineId),
                decodeRoutineRun,
                { method: "POST" },
              )
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      listRoutineRuns: scopedHandler(parseListRoutineRuns, {
        local: (parsed) => service.listRoutineRuns(parsed),
        remote: (parsed, serverId) =>
          Effect.runPromise(
            remoteServers
              .request(
                serverId,
                `${TEAM_API_ROUTES.agent.routineRuns(parsed.agentId, parsed.routineId)}?limit=${parsed.limit}`,
                decodeRoutineRuns,
              )
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          ),
      }),
      automationRunCommand: scopedHandler(parseTestRoutine, {
        local: (parsed) => service.automationRunCommand(parsed),
        remote: () => {
          throw new Error(sourceText("error.agent.automationLocalOnly"));
        },
      }),
      routineCalendar: scopedHandler(parseRoutineCalendar, {
        local: (input) => calendar(input, localCalendarSource(service)),
        remote: (input, serverId) => calendar(input, remoteCalendarSource(remoteServers, serverId)),
      }),
    },
  };
}

function calendar(input: { from: string; to: string }, source: RoutineCalendarSource<RemoteWorkflowError>) {
  return Effect.runPromise(
    buildRoutineCalendar({ from: new Date(input.from), to: new Date(input.to) }, new Date(), source).pipe(
      Effect.mapError((error) => error.cause),
    ),
  );
}

function localCalendarSource(service: AgentService): RoutineCalendarSource<RemoteWorkflowError> {
  return {
    owners: () =>
      Effect.sync(() => {
        const archived = service.channels.store.archivedIds();
        return [
          ...service.listAgents().map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
          ...service.channels.store
            .ids()
            .filter((channelId) => !archived.has(channelId))
            .map((channelId): RoutineCalendarOwner => ({ kind: "channel", channelId })),
        ];
      }),
    routines: (owner) =>
      Effect.sync(() =>
        owner.kind === "agent" ? service.listRoutines(owner.agentId) : service.listChannelRoutines(owner.channelId),
      ),
    runs: (owner, routineId, limit) =>
      Effect.sync(() =>
        owner.kind === "agent"
          ? service.listRoutineRuns({ agentId: owner.agentId, routineId, limit })
          : service.listChannelRoutineRuns({ channelId: owner.channelId, routineId, limit }),
      ),
  };
}

/** A remote host answers through the routes its routine settings already use, so no new route is needed. */
function remoteCalendarSource(
  remoteServers: RemoteServerManager,
  serverId: string,
): RoutineCalendarSource<RemoteWorkflowError> {
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
        ? remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(owner.agentId), decodeRoutines)
        : remoteServers.request(serverId, CHANNEL_ROUTES.routines, decodeChannelRoutines, {
            method: "POST",
            body: { channelId: owner.channelId },
          }),
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
