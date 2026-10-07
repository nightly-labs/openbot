import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the routine canvas reaches in main: the flows, a test run, the events that make it stale, and
 * the open agent's conversation for the assistant.
 */
export interface RoutineFlowsPort {
  routineFlows: OpenBotDesktopApi["routineFlows"];
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "testRoutine" | "updateRoutine" | "onScopedEvent" | "sendMessage" | "readConversationPage"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function routineFlowsPort(): RoutineFlowsPort {
  return window.openbot;
}
