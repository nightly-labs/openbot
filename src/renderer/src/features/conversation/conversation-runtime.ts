import type { AttachmentSummary, FilePreview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AgentSkillCalls } from "../../skills-port";
import type { SharedTableCalls } from "./conversation-port";
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
  /** The host admin calls of a client without the desktop port. Absent, skills and tables are hidden. */
  admin?: { skills: AgentSkillCalls; sharedTables: SharedTableCalls } | undefined;
}

export function conversationRuntime(props: ConversationProps): ConversationRuntime {
  return props.runtime ?? window.openbot;
}
