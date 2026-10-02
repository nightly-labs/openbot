import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the schedule reaches in main: the routine calendar of a server, and the events that make it stale. */
export interface SchedulePort {
  agent: Pick<OpenBotDesktopApi["agent"], "routineCalendar" | "onScopedEvent">;
  servers: Pick<OpenBotDesktopApi["servers"], "onEvent">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function schedulePort(): SchedulePort {
  return window.openbot;
}
