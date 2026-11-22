import type { DeleteSharedTableInput, OpenBotDesktopApi, SharedTable } from "@openbot/contracts/ipc";

export interface ConversationPort {
  dynamicIsland: Pick<OpenBotDesktopApi["dynamicIsland"], "openBrowserTakeover">;
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "addPreviewPage"
    | "readAgentSessionSettings"
    | "listAgentNotificationLevels"
    | "askSideQuestion"
    | "saveSkillSuggestion"
    | "setAgentSessionSetting"
    | "resetAgentSessionSetting"
    | "onScopedEvent"
    | "deleteConversationMessage"
    | "deleteTable"
    | "listMemories"
    | "listPinnedMessages"
    | "listRoutines"
    | "listTables"
    | "markConversationRead"
    | "markConversationUnread"
    | "readConversationPage"
    | "releaseFilePreview"
    | "searchConversationMessages"
    | "sendMessage"
    | "setMessagePinned"
    | "withdrawFeedback"
  >;
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "capturePreview"
    | "closeWindow"
    | "finishLocalSignIn"
    | "onLiveViewEvent"
    | "onWindowEvent"
    | "openLocalSignIn"
    | "sendLiveViewInput"
    | "startLiveView"
    | "stopLiveView"
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
  hostAdmin: Pick<OpenBotDesktopApi["hostAdmin"], "getAgentAccess">;
  browserDock: Pick<OpenBotDesktopApi["browserDock"], "publishPresentation" | "onAction" | "onShown">;
}

export function conversationPort(): ConversationPort {
  return window.openbot;
}

export function releaseFilePreviewPage(pageUrl: string | undefined): void {
  if (!pageUrl) return;
  void conversationPort()
    .agent.releaseFilePreview(pageUrl)
    .catch(() => undefined);
}

export interface SharedTableCalls {
  listTables(): Promise<SharedTable[]>;
  deleteTable(input: DeleteSharedTableInput): Promise<void>;
}
