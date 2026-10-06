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
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import type { AgentService } from "../../backend/agent-service";
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
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(agentId), decodeRoutines),
      }),
      createRoutine: scopedHandler(parseCreateRoutine, {
        local: (parsed) => service.createRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routines(parsed.agentId), decodeRoutine, {
            method: "POST",
            body: parsed,
          }),
      }),
      updateRoutine: scopedHandler(parseUpdateRoutine, {
        local: (parsed) => service.updateRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId),
            decodeRoutine,
            {
              method: "PATCH",
              body: parsed,
            },
          ),
      }),
      deleteRoutine: scopedHandler(parseDeleteRoutine, {
        local: (parsed) => service.deleteRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(serverId, TEAM_API_ROUTES.agent.routine(parsed.agentId, parsed.routineId), decodeVoid, {
            method: "DELETE",
          }),
      }),
      testRoutine: scopedHandler(parseTestRoutine, {
        local: (parsed) => service.testRoutine(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            TEAM_API_ROUTES.agent.routineTest(parsed.agentId, parsed.routineId),
            decodeRoutineRun,
            { method: "POST" },
          ),
      }),
      listRoutineRuns: scopedHandler(parseListRoutineRuns, {
        local: (parsed) => service.listRoutineRuns(parsed),
        remote: (parsed, serverId) =>
          remoteServers.request(
            serverId,
            `${TEAM_API_ROUTES.agent.routineRuns(parsed.agentId, parsed.routineId)}?limit=${parsed.limit}`,
            decodeRoutineRuns,
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

function calendar(input: { from: string; to: string }, source: RoutineCalendarSource) {
  return buildRoutineCalendar({ from: new Date(input.from), to: new Date(input.to) }, new Date(), source);
}

function localCalendarSource(service: AgentService): RoutineCalendarSource {
  return {
    owners: async () => {
      const archived = service.channels.store.archivedIds();
      return [
        ...service.listAgents().map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
        ...service.channels.store
          .ids()
          .filter((channelId) => !archived.has(channelId))
          .map((channelId): RoutineCalendarOwner => ({ kind: "channel", channelId })),
      ];
    },
    routines: async (owner) =>
      owner.kind === "agent" ? service.listRoutines(owner.agentId) : service.listChannelRoutines(owner.channelId),
    runs: async (owner, routineId, limit) =>
      owner.kind === "agent"
        ? service.listRoutineRuns({ agentId: owner.agentId, routineId, limit })
        : service.listChannelRoutineRuns({ channelId: owner.channelId, routineId, limit }),
  };
}

/** A remote host answers through the routes its routine settings already use, so no new route is needed. */
function remoteCalendarSource(remoteServers: RemoteServerManager, serverId: string): RoutineCalendarSource {
  return {
    owners: async () => {
      // A host from before channels rejects the channel routes; its agents still have routines.
      const [agents, channels] = await Promise.all([
        remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
        remoteServers.supportsCapability(serverId, CHANNEL_CHATS_CAPABILITY)
          ? remoteServers.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries)
          : [],
      ]);
      return [
        ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
        ...channels
          .filter((channel) => !channel.archived)
          .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
      ];
    },
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
