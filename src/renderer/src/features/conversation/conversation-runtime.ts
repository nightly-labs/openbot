import type {
  AgentNotificationLevelsSnapshot,
  AgentSessionSettings,
  AskSideQuestionInput,
  AttachmentSummary,
  FilePreview,
  OpenBotDesktopApi,
  ResetAgentSessionSettingInput,
  SaveSkillSuggestionInput,
  SaveSkillSuggestionResult,
  SetAgentSessionSettingInput,
  TestRoutineInput,
  WithdrawFeedbackResult,
} from "@openbot/contracts/ipc";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { AgentSkillCalls, SkillCatalogCalls } from "../../skills-port";
import type { AgentTemplatePublishCalls } from "../agent-templates/agent-templates-port";
import type { BrowserProfileCalls } from "../browser/browser-profiles-port";
import type { FilesPort } from "../files/files-port";
import type { AgentFoldersApi, AgentInstructionsApi } from "./agent-folders-port";
import type { SharedTableCalls } from "./conversation-port";
import type { ConversationProps } from "./conversation-types";
import type { AgentMemoriesApi } from "./memories-port";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import type { AgentRoutinesApi, RoutineResultsCalls } from "./routines-port";
import type { CodexLivePort } from "./stores/codex-live-conversation-store";

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
    Partial<Pick<OpenBotDesktopApi["agent"], "openMessageLink" | "pasteMessageLink" | "cancelMessageLink">> &
    Partial<Pick<OpenBotDesktopApi["agent"], "stopAttachmentDownload" | "onAttachmentDownload">> &
    Partial<Pick<OpenBotDesktopApi["agent"], "retryAttachmentImport" | "discardAttachmentImport">> &
    Partial<Pick<OpenBotDesktopApi["agent"], "testMcpServer">>;
  browser: Pick<
    OpenBotDesktopApi["browser"],
    | "capturePreview"
    | "closePictureInPicture"
    | "closeWindow"
    | "focusWindow"
    | "navigate"
    | "onPictureInPictureEvent"
    | "onWindowEvent"
    | "open"
    | "openPictureInPicture"
    | "openWindow"
    | "publishWindowModel"
    | "reload"
    | "stop"
    | "answerPermission"
    | "releaseControl"
    | "setVisible"
    | "startTeach"
    | "stopTeach"
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
  askSideQuestion?: ((input: AskSideQuestionInput) => Promise<string>) | undefined;
  sideQuestionThreads?: boolean | undefined;
  liveVoice?: CodexLivePort | undefined;
  skillCatalog?: SkillCatalogCalls | undefined;
  withdrawFeedback?: ((input: { agentId: string; messageId: string }) => Promise<WithdrawFeedbackResult>) | undefined;
  saveSkillSuggestion?: ((input: SaveSkillSuggestionInput) => Promise<SaveSkillSuggestionResult>) | undefined;
  previewAttachment?: (attachment: AttachmentSummary) => Promise<FilePreview>;
  attachmentMedia?: AttachmentMediaSource;
  visualPage?: (attachment: AttachmentSummary) => Promise<string>;
  importFiles?: (files: File[]) => Promise<void>;
  cancelImportFiles?: () => Promise<void>;
  browserProfiles?: BrowserProfileCalls | undefined;
  routines?: AgentRoutinesApi | undefined;
  agentMemories?: AgentMemoriesApi | undefined;
  agentFolders?: AgentFoldersApi | undefined;
  agentInstructions?: AgentInstructionsApi | undefined;
  routineResultCalls?: RoutineResultsCalls | undefined;
  routineRunCommand?: ((input: TestRoutineInput) => Promise<string>) | undefined;
  agentMemoryLimit?: (() => Promise<number>) | undefined;
  storageCalls?: FilesPort | undefined;
  agentNotificationLevels?: AgentNotificationLevelCalls | undefined;
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

export interface AgentNotificationLevelCalls {
  list(): Promise<AgentNotificationLevelsSnapshot>;
  subscribe?(listener: (levels: AgentNotificationLevelsSnapshot) => void): () => void;
}

export function conversationRuntime(props: Pick<ConversationProps, "runtime">): ConversationRuntime {
  return props.runtime ?? window.openbot;
}
