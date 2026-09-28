import type { AttachmentSummary, FilePreview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ChannelMemoriesApi } from "../conversation/memories-port";
import type { ChannelRoutinesApi } from "../conversation/routines-port";

/**
 * What the channels domain reaches on its host: channel pages, commands, memories, routines,
 * attachments, and the answers a channel turn waits for. The desktop reaches it through preload; the
 * browser client supplies its own runtime over the host connection, the way `ConversationRuntime`
 * does.
 */
export interface ChannelsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "channelCommand"
    | "chooseAttachments"
    | "listChannels"
    | "openAttachment"
    | "readChannel"
    | "respondToApproval"
    | "respondToBrowserSecret"
    | "respondToBrowserTakeover"
    | "respondToPrompt"
  > &
    ChannelMemoriesApi &
    ChannelRoutinesApi &
    Partial<Pick<OpenBotDesktopApi["agent"], "downloadAttachments">>;
  browser: Pick<OpenBotDesktopApi["browser"], "capturePreview">;
  openUrl: OpenBotDesktopApi["openUrl"];
  /** `browser` has no file manager to reveal a file in, so that action is hidden. */
  fileActions: "native" | "browser";
  /** Replaces the preview read from `previewUrl`, which a browser client never receives. */
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function channelsPort(): ChannelsPort {
  const api = window.openbot;
  return {
    agent: api.agent,
    browser: api.browser,
    openUrl: (url) => api.openUrl(url),
    fileActions: "native",
  };
}
