import type { AgentEvent, RoutineCalendar, RoutineCalendarInput, TeamRealtimeEvent } from "@openbot/contracts/ipc";

export interface ScheduleSource {
  calendar(input: RoutineCalendarInput, serverId: string): Promise<RoutineCalendar>;
  onStale(serverId: string, stale: () => void): () => void;
}

export function changesSchedule(event: AgentEvent | TeamRealtimeEvent): boolean {
  return (
    event.type === "routines-changed" ||
    event.type === "channel-routines-changed" ||
    event.type === "agents-changed" ||
    (event.type === "turn-completed" && event.origin === "routine")
  );
}

export function desktopScheduleSource(): ScheduleSource {
  return {
    calendar: (input, serverId) => window.openbot.agent.routineCalendar(input, serverId),
    onStale(serverId, stale) {
      const unsubscribe = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && changesSchedule(scoped.event)) stale();
      });
      const reconnect = window.openbot.servers.onEvent((servers) => {
        if (servers.some((server) => server.id === serverId && server.state === "online")) stale();
      });
      return () => {
        unsubscribe();
        reconnect();
      };
    },
  };
}
