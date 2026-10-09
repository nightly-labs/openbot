import type {
  AgentSessionSettings,
  AttachmentSummary,
  FilePreview,
  OpenBotDesktopApi,
  ResetAgentSessionSettingInput,
  SetAgentSessionSettingInput,
} from "@openbot/contracts/ipc";
import type { AgentSkillCalls } from "../../skills-port";
import type { AgentTemplatePublishCalls } from "../agent-templates/agent-templates-port";
import type { SharedTableCalls } from "./conversation-port";
import type { ConversationProps } from "./conversation-types";
import type { EventRoutinesApi } from "./routine-webhooks-api";

export interface ConversationRuntime {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "discardDraftAttachment"
    | "downloadAttachments"
    | "editQueuedMessage"
    | "listInstalledSkills"
    | "listMcpServers"
    | "listWorkspaceDirectory"
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
  /** The host admin calls of a client without the desktop port. Absent, skills, tables and publishing are hidden. */
  admin?:
    | {
        skills: AgentSkillCalls;
        sharedTables: SharedTableCalls;
        agentTemplates: AgentTemplatePublishCalls;
        eventRoutines?: EventRoutinesApi | undefined;
        sessionSettings?:
          | {
              read(agentId: string): Promise<AgentSessionSettings>;
              set(input: SetAgentSessionSettingInput): Promise<AgentSessionSettings>;
              reset(input: ResetAgentSessionSettingInput): Promise<AgentSessionSettings>;
              subscribe?(agentId: string, listener: () => void): () => void;
            }
          | undefined;
      }
    | undefined;
}

export function conversationRuntime(props: ConversationProps): ConversationRuntime {
  return props.runtime ?? window.openbot;
}
