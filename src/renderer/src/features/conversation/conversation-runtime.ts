import type { AttachmentSummary, FilePreview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ConversationProps } from "./conversation-types";

export interface ConversationRuntime {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "discardDraftAttachment"
    | "downloadAttachments"
    | "editQueuedMessage"
    | "listInstalledSkills"
    | "listMcpServers"
    | "onAttachmentImport"
    | "openAttachment"
    | "openSharedFile"
    | "openWorkspaceFile"
    | "previewSharedFile"
    | "previewWorkspaceFile"
    | "respondToBrowserSecret"
    | "setMessageReaction"
  >;
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "capturePreview"
    | "closePictureInPicture"
    | "navigate"
    | "onPictureInPictureEvent"
    | "open"
    | "openPictureInPicture"
    | "reload"
    | "setVisible"
  >;
  voice: Pick<OpenBotDesktopApi["voice"], "onModelStatus" | "prepareModel" | "transcribe">;
  openUrl: OpenBotDesktopApi["openUrl"];
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
  importFiles?: (files: File[]) => Promise<void>;
  cancelImportFiles?: () => Promise<void>;
}

export function conversationRuntime(props: ConversationProps): ConversationRuntime {
  return props.runtime ?? window.openbot;
}
