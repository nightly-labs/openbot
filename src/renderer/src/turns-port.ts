import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface TurnsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "cancelQueuedMessage"
    | "cancelWait"
    | "clearContext"
    | "compactContext"
    | "compactTaskContext"
    | "deleteHistory"
    | "interrupt"
    | "listActiveQueues"
    | "listQueue"
    | "listRoutines"
    | "listWaits"
    | "readMediaApproval"
    | "readPendingApproval"
    | "reorderQueue"
    | "respondToApproval"
    | "respondToBrowserTakeover"
    | "respondToCreditsHold"
    | "respondToMediaApproval"
    | "respondToPrompt"
    | "setCreditsAskMuted"
    | "steerQueuedMessage"
    | "updateQueuedMessage"
  >;
}

export function turnsPort(): TurnsPort {
  return window.openbot;
}
