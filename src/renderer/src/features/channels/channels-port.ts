import type { AttachmentSummary, FilePreview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { ChannelMemoriesApi } from "../conversation/memories-port";
import type { EventRoutinesApi } from "../conversation/routine-webhooks-api";
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
    Partial<Pick<OpenBotDesktopApi["agent"], "discardDraftAttachment" | "downloadAttachments">> &
    /** Deletes one message of a channel. Missing from a client that cannot reach the host's route. */
    Partial<Pick<OpenBotDesktopApi["agent"], "deleteChannelMessage">> &
    /** Only the desktop has it: the Team API does not carry a channel picture. */
    Partial<Pick<OpenBotDesktopApi["agent"], "setChannelImage">> &
    /** Only the desktop has them: the Team API has no route to clear, compact or delete a channel's history. */
    Partial<Pick<OpenBotDesktopApi["agent"], "clearChannelContext" | "compactChannelContext" | "deleteChannelHistory">>;
  eventRoutines?: EventRoutinesApi | undefined;
  browser: Pick<OpenBotDesktopApi["browser"], "capturePreview">;
  openUrl: OpenBotDesktopApi["openUrl"];
  /** `browser` has no file manager to reveal a file in, so that action is hidden. */
  fileActions: "native" | "browser";
  /** Replaces the preview read from `previewUrl`, which a browser client never receives. */
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
  /** Loads attachment images and media for a client that gets no `previewUrl`. */
  attachmentMedia?: AttachmentMediaSource;
  /**
   * The HTML of a visual reply page, for a client that has no page URL. Only the browser client
   * has it: the frame shows the page as `srcdoc`, which the desktop renderer policy would block.
   */
  visualPage?: (attachment: AttachmentSummary) => Promise<string>;
  /** Uploads dropped or pasted files as drafts. Only a browser client has it; the desktop preload imports them. */
  importAttachments?: (files: File[]) => Promise<AttachmentSummary[]>;
  /** Reports the files the desktop preload imports from a drop or a paste. Only the desktop has it. */
  onAttachmentImport?: OpenBotDesktopApi["agent"]["onAttachmentImport"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function channelsPort(): ChannelsPort {
  const api = window.openbot;
  return {
    agent: api.agent,
    browser: api.browser,
    openUrl: (url) => api.openUrl(url),
    fileActions: "native",
    onAttachmentImport: (listener) => api.agent.onAttachmentImport(listener),
  };
}
