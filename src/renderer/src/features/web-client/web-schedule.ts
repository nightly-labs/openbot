import { CHANNEL_CHATS_CAPABILITY, type RoutineCalendarOwner } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import { type TeamApiRequest, TeamRequestError, teamAgentRoutinesApi } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { changesSchedule, type ScheduleSource } from "../schedule/schedule-port";
import type { WebWorkspace } from "./web-client-context";

/**
 * The schedule on the web: the calendar of the connected host, from the routes that its routine
 * settings already use. A host from before channels has no channel routes; its agents still have routines.
 */
export function webScheduleSource(
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">,
  hostRequest: (serverId?: string) => TeamApiRequest,
): ScheduleSource {
  const call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: (cause) => new TeamRequestError({ cause }) });

  function source(serverId: string): RoutineCalendarSource<TeamRequestError> {
    const agentRoutines = teamAgentRoutinesApi(hostRequest(serverId));
    const channels = workspace.state.capabilities.includes(CHANNEL_CHATS_CAPABILITY)
      ? workspace.runtime.channels
      : undefined;
    return {
      owners: () =>
        Effect.gen(function* () {
          const [agents, channelList] = yield* Effect.all(
            [call(() => workspace.runtime.listAgents()), call(async () => (channels ? channels.listChannels() : []))],
            { concurrency: "unbounded" },
          );
          return [
            ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
            ...channelList
              .filter((channel) => !channel.archived)
              .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
          ];
        }),
      routines: (owner) =>
        owner.kind === "agent"
          ? call(() => agentRoutines.listRoutines(owner.agentId))
          : call(async () => (channels ? channels.listChannelRoutines(owner.channelId) : [])),
      runs: (owner, routineId, limit) =>
        owner.kind === "agent"
          ? call(() => agentRoutines.listRoutineRuns({ agentId: owner.agentId, routineId, limit }))
          : call(async () =>
              channels ? channels.listChannelRoutineRuns({ channelId: owner.channelId, routineId, limit }) : [],
            ),
    };
  }

  return {
    calendar: (input, serverId) =>
      runTeamEffect(
        buildRoutineCalendar({ from: new Date(input.from), to: new Date(input.to) }, new Date(), source(serverId)).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    onStale: (serverId, stale) =>
      workspace.onHostEvent((event) => {
        if (workspace.state.host?.hostId !== serverId) return;
        // A snapshot comes after a reconnect: a run can end while the host is away.
        if (event.type === "runtime-snapshot" || changesSchedule(event)) stale();
      }),
  };
}
