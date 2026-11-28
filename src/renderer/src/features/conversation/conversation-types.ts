import type {
  AccountUsage,
  AgentApproval,
  AgentContextState,
  AgentDefaults,
  AgentEvent,
  AgentModelChoice,
  AgentProviderId,
  AgentStatus,
  AgentTask,
  AgentWait,
  AttachmentSummary,
  AvatarColor,
  AvatarImageInput,
  BrowserControlState,
  BrowserTab,
  BusyMessageMode,
  ClientAgentModelOption,
  ConversationSnapshot,
  CustomAgentSummary,
  CustomProviderRestart,
  CustomProviderSummary,
  DraftAttachment,
  FilePreview,
  ProviderRuntimeStatus,
  QueueSnapshot,
  ResponseStyle,
  RoutineFields,
  ServerSummary,
  TeamPresenceSnapshot,
  UpdateAgentAdminSettingsInput,
  UpdateAgentInput,
  UpdateCustomProviderInput,
  WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import type { AgentMessage, AgentProfile, ComposerThreadMessageMatch } from "@openbot/ui/data";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import type { ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import type { AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import type { UsageLimitAskCardProps } from "@openbot/ui/features/conversation/BackupModels";
import type { ChatMessageAuthor } from "@openbot/ui/features/conversation/ChatMessageRow";
import type { UnloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import type { SidePanelPane } from "@openbot/ui/features/conversation/SidePanel";
import type { AgentThreadOlderMessages } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { ThreadHeaderProps, ThreadItem } from "@openbot/ui/features/conversation/threads/thread-types";
import type { SidebarAgentWait } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { JSX } from "@solidjs/web";
import type { ConnectorRegistry } from "../connectors/connector-registry";
import type { AppSettingLinkId } from "../settings/setting-link-targets";
import type { ChannelReplyView } from "../speech/speech-replies";
import type { ConversationRuntime } from "./conversation-runtime";
import type { ServerInstallWatch } from "./ServerInstallChatCard";
import type { TurnStepLines } from "./turn-step-lines";

export interface AgentSettingsRequest {
  agentId: string;
  nonce: number;
  routine?: { routineId: string; name: string } | "new";
}

export interface ConversationTarget {
  agentId: string;
  serverId: string;
}

export interface VoiceLiveTranscript extends ConversationTarget {
  text: string;
  threadKey?: string | undefined;
}

export type BrowserTakeoverRequest = Extract<AgentEvent, { type: "browser-takeover-requested" }>["request"];

export interface PromptAnswerOptions {
  onError?: ((error: unknown) => void) | undefined;
}

export interface ConversationChannelSource {
  id: string;
  loading?: () => boolean;
  name: () => string;
  readOnly: () => boolean;
  author: (message: AgentMessage) => ChatMessageAuthor;
  ownMessage: (message: AgentMessage) => boolean;
  workers: () => ChannelWorker[];
  memberThreadIds: () => ReadonlySet<string>;
  memberAgentIds: () => ReadonlySet<string>;
  browserOwner: () => { agentId: string; threadId: string } | null;
  workingTurns: () => readonly string[];
  interactionAgentName: () => string | undefined;
  awaitingReplies: () => readonly AwaitingReplyItem[];
  stopAwaitingReply?: ((taskId: string) => void) | undefined;
  replyView: () => ChannelReplyView;
  voiceAgent: () => AgentProfile | undefined;
  HeaderTitle: (props: { onOpenSettings: () => void }) => JSX.Element;
  SettingsPane: (props: ConversationChannelSettingsPaneProps) => JSX.Element;
  AboveComposer: () => JSX.Element;
  EmptyState: () => JSX.Element;
}

export interface ConversationChannelSettingsPaneProps {
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export interface ConversationProps {
  channel?: ConversationChannelSource | undefined;
  contextState?: AgentContextState | undefined;
  runtime?: ConversationRuntime | undefined;
  notice?: JSX.Element | undefined;
  onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined;
  onOpenMarketplace?: (() => void) | undefined;
  onOpenMarketplaceApp?: ((request: { appId: string; connect: boolean }) => void) | undefined;
  appSettingOpener?: ((settingId: AppSettingLinkId) => (() => void) | undefined) | undefined;
  connectors?: ConnectorRegistry | undefined;
  onOpenMcpSignIn?: ((mcpServerId: string, trigger: HTMLElement | null) => void) | undefined;
  mcpSignedIn?: ((mcpServerId: string) => boolean) | undefined;
  refreshMcpSignIns?: (() => void) | undefined;
  serverInstall?: ServerInstallWatch | undefined;
  platform?: import("@openbot/contracts/ipc").AppInfo["platform"] | undefined;

  agentStatus: AgentStatus;
  agentsConnecting?: boolean | undefined;
  accountUsage?: AccountUsage | null | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  customAgents?: readonly CustomAgentSummary[] | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInWithCodeProvider?: ((provider: AgentProviderId) => void) | undefined;
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  onManageBrowserProfiles?: ((trigger: HTMLElement) => void) | undefined;
  onOpenNotificationSettings?: ((serverId: string, trigger: HTMLElement) => void) | undefined;
  agent: AgentProfile | undefined;
  agents: AgentProfile[];
  mentionAgents?: AgentProfile[] | undefined;
  availableRoutineIds?: readonly string[] | undefined;
  routines?: readonly RoutineFields[] | undefined;
  modelOptions: ClientAgentModelOption[];
  messages: readonly AgentMessage[];
  messageReferences?: Record<string, AgentMessage> | undefined;
  missingMessageReferences?: Readonly<Record<string, true>> | undefined;
  unreadCount: number;
  firstUnreadMessageId: string | null;
  loaded: boolean;
  hasOlder?: boolean | undefined;
  unloadedHistory?: UnloadedHistory | undefined;
  discontinuous?: boolean | undefined;
  loadingOlder?: boolean | undefined;
  olderError?: string | null | undefined;
  activeTurnId: string | null | undefined;
  subagentTurnId?: string | null | undefined;
  activityDetail?: string | undefined;
  activityRunning?: boolean | undefined;
  activityKind?: string | undefined;
  backgroundWorkSince?: ((taskId: string | null) => number | undefined) | undefined;
  turnStepLines?: TurnStepLines | undefined;
  skillsMarketplaceOpen?: boolean | undefined;
  mcpSettingsOpen?: boolean | undefined;
  globalOverlayOpen: boolean;
  settingsRequest: AgentSettingsRequest | null;
  messageFocusRequest: { agentId: string; messageId: string; nonce: number } | null;
  queue: QueueSnapshot | undefined;
  waits?: readonly AgentWait[] | undefined;
  threads?: ConversationThreads | undefined;
  browserTabs: BrowserTab[];
  noticedBrowserTabIds?: ReadonlySet<string> | undefined;
  onNoticeBrowserTabs?: ((tabIds: readonly string[]) => void) | undefined;
  activeBrowserTabId: string | null;
  browserVisibilitySuspended: boolean;
  workspaceCovered?: boolean | undefined;
  browserControlState: BrowserControlState;
  browserRuntime?: BrowserViewRuntime | undefined;
  server: ServerSummary | undefined;
  responseStyle?: ResponseStyle | undefined;
  presence: TeamPresenceSnapshot;
  currentUserEmail: string;
  currentUserChatColor?: AvatarColor | null | undefined;
  isOwnSender: (senderId: string) => boolean;
  browserEnabled?: boolean | undefined;
  openLinksInBrowser?: boolean | undefined;
  remoteDesktopEnabled?: boolean | undefined;
  remoteDesktopSessionActive: boolean;
  remoteDesktopVisible: boolean;
  prompt: Extract<AgentEvent, { type: "prompt" }> | undefined;
  promptUiBlock?: ConversationUiBlock | undefined;
  approval: Extract<AgentEvent, { type: "approval" }>["approval"] | undefined;
  usageLimitAsk?: UsageLimitAskCardProps | undefined;
  usageLimited?: ((choice: AgentModelChoice) => boolean) | undefined;
  providerFailed?: ((choice: AgentModelChoice) => boolean) | undefined;
  browserTakeover: BrowserTakeoverRequest | undefined;
  onSelectAgent: (agentId: string, tabId?: string) => void;
  agentWaits?: Record<string, SidebarAgentWait> | undefined;
  agentTakeoverTabIds?: Record<string, string> | undefined;
  onUpdateAgent: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
  onSetAgentAvatar: (agentId: string, image: AvatarImageInput | null) => Promise<void>;
  onSendMessage: (
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
    target?: ConversationTarget,
    clientMessageId?: string,
    voiceRecordingDraftId?: string,
  ) => Promise<SendMessageResult>;
  onMarkRead: () => Promise<void>;
  onMarkUnread?: ((messageId: string) => Promise<void>) | undefined;
  onDeleteMessage?: ((messageId: string) => Promise<void>) | undefined;
  canDeleteMessage?: ((message: AgentMessage) => boolean) | undefined;
  messagePins?: ConversationMessagePins | undefined;
  sendToChannel?:
    | { channels: { id: string; name: string }[]; onSend: (channelId: string, text: string) => void }
    | undefined;
  onLoadOlder?: (() => void) | undefined;
  onLoadLatest?: (() => Promise<void>) | undefined;
  onSearchMessages?: ((query: string) => Promise<{ messageIds: string[]; total: number }>) | undefined;
  onSearchThreads?: ((query: string) => Promise<ComposerThreadMessageMatch[]>) | undefined;
  onOpenSearchMessage?: ((messageId: string) => Promise<void>) | undefined;
  onTypingChange: (agentId: string, typing: boolean) => void;
  onAnswerPrompt: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  onPromptResolutionPresented?: ((agentId: string, turnId: string, requestId: string | number) => void) | undefined;
  onRespondToApproval: (decision: "accept" | "decline") => Promise<boolean>;
  onAlwaysAllowApproval?: (() => Promise<boolean>) | undefined;
  mediaApproval?: MediaApprovalControls | undefined;
  agentAutoApproves?: boolean | undefined;
  remoteBackupModelsLoaded?: boolean | undefined;
  remotePlanCardLoaded?: boolean | undefined;
  remoteBuiltinMemoryLoaded?: boolean | undefined;
  remoteComputerUseLoaded?: boolean | undefined;
  remoteNewChatLoaded?: boolean | undefined;
  remoteBusyMessageModeLoaded?: boolean | undefined;
  defaultBusyMessageMode?: BusyMessageMode | undefined;
  agentDefaults?: AgentDefaults | undefined;
  agentMemoryLimit?: number | undefined;
  onUpdateAgentPermissions?: ((input: UpdateAgentAdminSettingsInput) => Promise<void>) | undefined;
  onClearAgentContext?: (() => Promise<void>) | undefined;
  onDeleteAgentHistory?: (() => Promise<void>) | undefined;
  onDeleteAgent?: ((agentId: string) => Promise<void>) | undefined;
  onCompactAgentContext?: (() => Promise<void>) | undefined;
  onRespondToBrowserTakeover: (decision: "complete" | "cancel", options?: PromptAnswerOptions) => Promise<boolean>;
  onCancelQueuedMessage: (deliveryId: string, recipientAgentId?: string) => void;
  onCancelWait?: ((waitId: string) => void) | undefined;
  onSteerQueuedMessage: (deliveryId: string) => void;
  onSendQueuedMessageNow?: ((deliveryId: string) => void) | undefined;
  onUpdateQueuedMessage: (
    deliveryId: string,
    text: string,
    keepAttachmentIds: string[],
    attachmentDraftIds: string[],
    target?: ConversationTarget,
  ) => Promise<boolean>;
  onReorderQueue: (deliveryIds: string[]) => void;
  onActivateBrowserTab: (tabId: string) => void;
  onCloseBrowserTab: (tabId: string) => void | Promise<void>;
  onOpenRemoteDesktop: (serverId: string, trigger: HTMLElement) => Promise<void>;
  onStop: () => void;
}

export type AgentSendMessageResult = { messageId: string } | { error: string; reference?: string | null };

export type SendMessageResult = AgentSendMessageResult | { unconfirmed: true };

export interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  replyToMessageId: string | null;
}

type SidebarFilePreviewSource =
  | { kind: "shared"; path: string }
  | { kind: "workspace"; agentId: string; path: string; folder?: string | undefined }
  | { kind: "attachment"; attachment: AttachmentSummary };

export type SidebarFilePreview =
  | {
      ownerAgentId: string;
      threadId?: string | undefined;
      source: SidebarFilePreviewSource;
      preview: FilePreview;
      directory?: undefined;
    }
  | {
      ownerAgentId: string;
      threadId?: string | undefined;
      source: { kind: "workspace-folder"; agentId: string; path: string };
      preview: null;
      directory: WorkspaceDirectory;
    };

export type RightPanelMode =
  | "none"
  | "side-panel"
  | SidePanelPane
  | "browser-expanded"
  | "browser-pip"
  | "file-preview"
  | "thread";

export type { SidePanelPane };

export interface ConversationMessagePins {
  list: (agentId: string) => Promise<import("@openbot/contracts/ipc").PinnedMessagesSnapshot>;
  set: (
    input: import("@openbot/contracts/ipc").SetMessagePinnedInput,
  ) => Promise<import("@openbot/contracts/ipc").PinnedMessagesSnapshot>;
  subscribe: (agentId: string, changed: () => void) => () => void;
}

export interface ConversationThreads {
  header: ThreadHeaderProps;
  side: SideThreads;
  open: AgentTask | null | undefined;
  tasks: readonly AgentTask[];
  limit: number;
  running: number;
  conversation: ConversationSnapshot | undefined;
  olderMessages: AgentThreadOlderMessages | undefined;
  newerMessages: AgentThreadOlderMessages | undefined;
  approval: AgentApproval | undefined;
  acceptsFiles: boolean;
  acceptsReplies: boolean;
  onSend: (text: string, attachmentDraftIds: string[], replyToMessageId?: string | null) => Promise<boolean>;
  onStop: () => void;
  onRead: (messageId: string) => void;
  onRespondApproval: (decision: "accept" | "decline", options?: PromptAnswerOptions) => Promise<boolean>;
  contextState: AgentContextState | undefined;
  onCompactContext?: (() => Promise<void>) | undefined;
  onRunQueuedMessage?: ((deliveryId: string) => void) | undefined;
  queueActions?: ThreadQueueActions | undefined;
  onBranch?: ((sourceTaskId: string | null, messageId: string) => Promise<boolean>) | undefined;
  onDeleteMessage?: ((taskId: string, messageId: string) => Promise<void>) | undefined;
  branchSource: (task: AgentTask) => ConversationBranchSource | undefined;
  routineThread: (routineId: string) => (() => void) | undefined;
  onOpenRoutineThread: (routineId: string) => Promise<boolean>;
  onOpenRoutineRun: (routineId: string, messageId: string) => Promise<boolean>;
  focusMessage: { taskId: string; messageId: string; nonce: number } | null;
  onOpenMessage: (taskId: string | null, messageId: string) => Promise<boolean>;
}

interface ThreadQueueActions {
  cancel: (deliveryId: string) => void;
  steer: (task: AgentTask, deliveryId: string) => void;
  reorder: (taskId: string, deliveryIds: string[]) => void;
}

export interface ConversationBranchSource {
  throughMessageId: string;
  title: string | null;
  deleted: boolean;
  onOpen: () => void;
}

interface SideThreads {
  tabs: readonly ThreadItem[];
  thread: (id: string) => SideThread | undefined;
  onToSide: (id: string) => void;
  onToChat: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, index: number) => void;
}

export interface SideThread {
  task: AgentTask;
  conversation: ConversationSnapshot | undefined;
  olderMessages: AgentThreadOlderMessages | undefined;
  newerMessages: AgentThreadOlderMessages | undefined;
  focusMessage: { messageId: string; nonce: number } | undefined;
  approval: AgentApproval | undefined;
  onSend: (text: string, attachmentDraftIds: string[], replyToMessageId?: string | null) => Promise<boolean>;
  onStop: () => void;
  onRead: (messageId: string) => void;
  onRespondApproval: (decision: "accept" | "decline", options?: PromptAnswerOptions) => Promise<boolean>;
  contextState: AgentContextState | undefined;
  onCompactContext?: (() => Promise<void>) | undefined;
}
