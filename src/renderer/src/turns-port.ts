import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What turn state reaches in main: the queue, the routine ids, and the answers to prompts,
 * approvals and browser takeovers.
 */
export interface TurnsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "cancelQueuedMessage"
    | "interrupt"
    | "listQueue"
    | "listRoutines"
    | "reorderQueue"
    | "respondToApproval"
    | "respondToBrowserTakeover"
    | "respondToPrompt"
    | "steerQueuedMessage"
    | "updateQueuedMessage"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function turnsPort(): TurnsPort {
  return window.openbot;
}
