import type { AttachmentSummary, FilePreview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { ChannelMemoriesApi } from "../conversation/memories-port";
import type { EventRoutinesApi } from "../conversation/routine-webhooks-api";
import type { ChannelRoutinesApi } from "../conversation/routines-port";
import type { ChannelFoldersApi } from "./channel-folders-port";

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
    Partial<Pick<OpenBotDesktopApi["agent"], "deleteChannelMessage">> &
    Partial<Pick<OpenBotDesktopApi["agent"], "setChannelImage">> &
    Partial<ChannelFoldersApi & Pick<OpenBotDesktopApi["agent"], "chooseChannelFolder">> &
    Partial<Pick<OpenBotDesktopApi["agent"], "clearChannelContext" | "compactChannelContext" | "deleteChannelHistory">>;
  eventRoutines?: EventRoutinesApi | undefined;
  browser: Pick<OpenBotDesktopApi["browser"], "capturePreview">;
  openUrl: OpenBotDesktopApi["openUrl"];
  fileActions: "native" | "browser";
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
  attachmentMedia?: AttachmentMediaSource;
  visualPage?: (attachment: AttachmentSummary) => Promise<string>;
  importAttachments?: (files: File[]) => Promise<AttachmentSummary[]>;
  onAttachmentImport?: OpenBotDesktopApi["agent"]["onAttachmentImport"];
}

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
