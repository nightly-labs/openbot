import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the saved copy reaches in main: the copy of one joined server, and the link opener. */
export interface SavedCopyPort {
  remoteWorkspaceCache: Pick<OpenBotDesktopApi["remoteWorkspaceCache"], "read" | "saveConversation" | "saveWorkspace">;
  openUrl: OpenBotDesktopApi["openUrl"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function savedCopyPort(): SavedCopyPort {
  const api = window.openbot;
  return { remoteWorkspaceCache: api.remoteWorkspaceCache, openUrl: (url) => api.openUrl(url) };
}
