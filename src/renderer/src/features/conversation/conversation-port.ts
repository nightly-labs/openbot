import type { DeleteSharedTableInput, OpenBotDesktopApi, SharedTable } from "@openbot/contracts/ipc";

/**
 * What the conversation domain reaches in main: agent and direct message pages, sends, reads,
 * shared tables, and the browser seams a view takes when no runtime is injected.
 */
export interface ConversationPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "deleteTable"
    | "listMemories"
    | "listRoutines"
    | "listTables"
    | "markConversationRead"
    | "readConversationPage"
    | "searchConversationMessages"
    | "sendMessage"
  >;
  browser: Pick<
    OpenBotDesktopApi["browser"],
    "capturePreview" | "onLiveViewEvent" | "sendLiveViewInput" | "startLiveView" | "stopLiveView"
  >;
  servers: Pick<
    OpenBotDesktopApi["servers"],
    | "listDirectThreads"
    | "markDirectRead"
    | "onDirectMessage"
    | "onDirectTyping"
    | "readDirectConversationPage"
    | "sendDirectMessage"
    | "setDirectTyping"
  >;
  storage: Pick<OpenBotDesktopApi["storage"], "openLocation">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function conversationPort(): ConversationPort {
  return window.openbot;
}

/** The tables every agent shares. The web client reaches them on the host through the Team API. */
export interface SharedTableCalls {
  listTables(): Promise<SharedTable[]>;
  deleteTable(input: DeleteSharedTableInput): Promise<void>;
}
