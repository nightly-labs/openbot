// The routines of this computer, for the in-app calendar and for the iCalendar feed.

import type { RoutineCalendarOwner } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import { Effect } from "effect";
import type { AgentService } from "../backend/agent-service";
import { routineFeedIcs } from "./routine-feed-ics";
import { RoutineFeedAgentNotFound } from "./routine-feed-server";

/** How far ahead the feed lists runs. A calendar app reads the feed again long before the end. */
const FEED_DAYS = 30;

export function localRoutineCalendarSource(service: AgentService): RoutineCalendarSource<never> {
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

/**
 * The feed of the next 30 days of runs: every active routine, or only those of the agent `agentId`.
 * A paused routine is left out, so it leaves the user's calendar at the next read.
 */
export function localRoutineFeedDocument(service: AgentService, translate: AppTranslate) {
  return Effect.fn("RoutineFeed.document")(function* (agentId: string | null) {
    const agents = service.listAgents();
    if (agentId !== null && !agents.some((agent) => agent.id === agentId)) {
      return yield* new RoutineFeedAgentNotFound();
    }
    const local = localRoutineCalendarSource(service);
    const source: RoutineCalendarSource<never> = {
      ...local,
      owners: () =>
        agentId === null ? local.owners() : Effect.succeed([{ kind: "agent", agentId } satisfies RoutineCalendarOwner]),
      routines: (owner) => local.routines(owner).pipe(Effect.map((routines) => routines.filter((r) => r.active))),
    };
    const now = new Date();
    const calendar = yield* buildRoutineCalendar(
      { from: now, to: new Date(now.getTime() + FEED_DAYS * 86_400_000) },
      now,
      source,
    );
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    const descriptions = new Map(
      calendar.routines.map((routine) => {
        const owner =
          routine.owner.kind === "agent"
            ? translate("routine.feed.eventAgent", { name: agentNames.get(routine.owner.agentId) ?? "" })
            : translate("routine.feed.eventChannel", { name: channelName(service, routine.owner.channelId) });
        return [routine.id, `${owner}\n${translate("routine.feed.eventTimezone", { timezone: routine.timezone })}`];
      }),
    );
    return routineFeedIcs(
      calendar,
      {
        calendarName: translate("routine.feed.calendarName"),
        description: (routineId) => descriptions.get(routineId) ?? "",
      },
      now,
    );
  });
}

function channelName(service: AgentService, channelId: string): string {
  const channel = service.channels.store.get(channelId);
  return channel.title.trim() || channel.name;
}
