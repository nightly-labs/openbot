import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the routine canvas reaches in main: the flows, a test run, and the events that make it stale. */
export interface RoutineFlowsPort {
  routineFlows: OpenBotDesktopApi["routineFlows"];
  agent: Pick<OpenBotDesktopApi["agent"], "testRoutine" | "onScopedEvent">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function routineFlowsPort(): RoutineFlowsPort {
  return window.openbot;
}
