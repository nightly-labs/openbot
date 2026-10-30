import type {
  AgentNotificationLevelsSnapshot,
  AgentSessionSettings,
  AskSideQuestionInput,
  AttachmentSummary,
  FilePreview,
  OpenBotDesktopApi,
  ResetAgentSessionSettingInput,
  SetAgentSessionSettingInput,
} from "@openbot/contracts/ipc";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { AgentSkillCalls } from "../../skills-port";
import type { AgentTemplatePublishCalls } from "../agent-templates/agent-templates-port";
import type { BrowserProfileCalls } from "../browser/browser-profiles-port";
import type { SharedTableCalls } from "./conversation-port";
import type { ConversationProps } from "./conversation-types";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import type { AgentRoutinesApi } from "./routines-port";

export interface ConversationRuntime {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "discardDraftAttachment"
    | "importAttachmentData"
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
  > &
    // A joined server's sign-in link that the host relays. Absent, a link opens with `openUrl`.
    Partial<Pick<OpenBotDesktopApi["agent"], "openMessageLink" | "pasteMessageLink" | "cancelMessageLink">>;
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "capturePreview"
    | "closePictureInPicture"
    | "navigate"
    | "onPictureInPictureEvent"
    | "open"
    | "openPictureInPicture"
    | "reload"
    | "stop"
    | "releaseControl"
    | "setVisible"
    | "takeControl"
  >;
  voice: Pick<
    OpenBotDesktopApi["voice"],
    | "getSettings"
    | "getServer"
    | "onModelStatus"
    | "prepareModel"
    | "transcribe"
    | "startStream"
    | "appendStream"
    | "finishStream"
    | "cancelStream"
    | "onStreamTranscript"
  >;
  openUrl: OpenBotDesktopApi["openUrl"];
  /** Asks the connected host a side question. Absent, the host does not serve `side-question-v1`. */
  askSideQuestion?: ((input: AskSideQuestionInput) => Promise<string>) | undefined;
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
  /** Loads attachment images and media for a client that gets no `previewUrl`. */
  attachmentMedia?: AttachmentMediaSource;
  /**
   * The HTML of a visual reply page, for a client that has no page URL. Only the browser client
   * has it: the frame shows the page as `srcdoc`, which the desktop renderer policy would block.
   */
  visualPage?: (attachment: AttachmentSummary) => Promise<string>;
  importFiles?: (files: File[]) => Promise<void>;
  cancelImportFiles?: () => Promise<void>;
  /**
   * The browser profile calls of a host that serves `browser-profiles-v1`, for a client without the
   * desktop port. Any member reads tab labels; only an owner or admin gets the other calls.
   */
  browserProfiles?: BrowserProfileCalls | undefined;
  /** The agent routine calls of a client without the desktop port. */
  routines?: AgentRoutinesApi | undefined;
  /**
   * The user's own notification level of each agent, for a client without the desktop port. Any member
   * can call it. The caller asks only a server that serves `agent-notification-levels-v1`.
   */
  agentNotificationLevels?: AgentNotificationLevelCalls | undefined;
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

/** Reads the user's own level of each agent. The notification settings are the one place that changes them. */
export interface AgentNotificationLevelCalls {
  list(): Promise<AgentNotificationLevelsSnapshot>;
  /** Calls `listener` with all levels after a change on any device of the user. Returns the unsubscribe. */
  subscribe?(listener: (levels: AgentNotificationLevelsSnapshot) => void): () => void;
}

export function conversationRuntime(props: Pick<ConversationProps, "runtime">): ConversationRuntime {
  return props.runtime ?? window.openbot;
}
