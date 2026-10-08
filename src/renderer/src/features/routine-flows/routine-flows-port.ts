import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the routine canvas reaches in main: the flows, a test run, the events that make it stale, and
 * the open agent's conversation for the assistant, and the links in its answers.
 */
export interface RoutineFlowsPort {
  routineFlows: OpenBotDesktopApi["routineFlows"];
  openUrl: OpenBotDesktopApi["openUrl"];
  /** Webhook routines: their config, signing secret, relay status and a test run. */
  events: Pick<OpenBotDesktopApi["events"], "getStatus" | "saveRoutine" | "rotateSecret" | "testRoutine">;
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "testRoutine" | "updateRoutine" | "onScopedEvent" | "sendMessage" | "readConversationPage"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function routineFlowsPort(): RoutineFlowsPort {
  return window.openbot;
}
