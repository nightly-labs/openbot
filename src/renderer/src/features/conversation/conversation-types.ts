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
  AvatarImageInput,
  BrowserControlState,
  BrowserTab,
  BusyMessageMode,
  ClientAgentModelOption,
  ConversationSnapshot,
  CustomAgentSummary,
  CustomProviderSummary,
  DraftAttachment,
  FilePreview,
  ProviderRuntimeStatus,
  QueueSnapshot,
  RoutineFields,
  ServerSummary,
  TeamPresenceSnapshot,
  UpdateAgentAdminSettingsInput,
  UpdateAgentInput,
  WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import type { ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import type { AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import type { UsageLimitAskCardProps } from "@openbot/ui/features/conversation/BackupModels";
import type { ChatMessageAuthor } from "@openbot/ui/features/conversation/ChatMessageRow";
import type { UnloadedHistory } from "@openbot/ui/features/conversation/ChatScrollRail";
import type { ThreadHeaderProps, ThreadItem } from "@openbot/ui/features/conversation/threads/thread-types";
import type { SidebarAgentWait } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import type { JSX } from "@solidjs/web";
import type { ConnectorRegistry } from "../connectors/connector-registry";
import type { ConversationRuntime } from "./conversation-runtime";
import type { TurnStepLines } from "./turn-step-lines";

/**
 * What a conversation is, as data. These live apart from `ConversationView.tsx`
 * because fifteen of this feature's modules - the scope, the controller, the
 * draft logic and every store - name one of these types and none of them render
 * anything. Reading them from the entry component made `conversation-scope.ts`
 * and `ConversationView.tsx` import each other: a cycle `noImportCycles` lets
 * through only because one direction is `import type`.
 */

/** Opens an agent's settings panel. A `routine` opens that routine's settings in it; `"new"` starts a routine. */
export interface AgentSettingsRequest {
  agentId: string;
  nonce: number;
  routine?: { routineId: string; name: string } | "new";
}

/** The conversation that a draft, an error or a send belongs to. For a channel, `agentId` is the channel id. */
export interface ConversationTarget {
  agentId: string;
  serverId: string;
}

/** What was said so far in a recording, and the conversation it is dictated into. */
export interface VoiceLiveTranscript extends ConversationTarget {
  text: string;
  /** The side thread draft that the recording is dictated into. Undefined for the agent's own chat. */
  threadKey?: string | undefined;
}

/** A browser takeover that an agent's turn waits for. */
export type BrowserTakeoverRequest = Extract<AgentEvent, { type: "browser-takeover-requested" }>["request"];

/** How an answer to a prompt reports a failure. */
export interface PromptAnswerOptions {
  /**
   * Gets the error of an answer that failed, for a card that shows it itself. Without it the app
   * reports the failure in the conversation (desktop) or the answer throws (web client).
   */
  onError?: ((error: unknown) => void) | undefined;
}

/**
 * A channel in the conversation view: a chat that people and several agents share. The view reads it
 * once, when it opens, so a view is a channel view or an agent view for all of its life, and the agent
 * view reads nothing of it.
 *
 * With a channel, `agent` is undefined. A person's message has `author: "you"` and its `senderMember`;
 * an agent's message has `author: "agent"` and its `senderAgentId`. The prompt, approval and takeover
 * props are the newest ones of the agents that work in the channel. `activeTurnId` is set while work
 * runs that Stop ends.
 *
 * The components are slots of the renderer's channel feature, which reads the channel store.
 */
export interface ConversationChannelSource {
  /** The channel id. The composer target of the channel has it as its `agentId`. */
  id: string;
  name: () => string;
  /** An archived channel takes no message and no answer. */
  readOnly: () => boolean;
  /** The agent that wrote an agent row, with the name the channel keeps for it. */
  author: (message: AgentMessage) => ChatMessageAuthor;
  /** The agents that work now. */
  workers: () => ChannelWorker[];
  /** The turns of the workers that run now, whose steps show under the activity line. */
  workingTurns: () => readonly string[];
  /** The agent that the prompt, approval or takeover on screen comes from. */
  interactionAgentName: () => string | undefined;
  /** The agents that a lead asked and that did not reply yet. */
  awaitingReplies: () => readonly AwaitingReplyItem[];
  HeaderTitle: (props: { onOpenSettings: () => void }) => JSX.Element;
  SettingsPane: (props: ConversationChannelSettingsPaneProps) => JSX.Element;
  /** Shows above the composer: the stopped tasks, and why the channel cannot work. */
  AboveComposer: () => JSX.Element;
  /** Shows in place of the transcript while the channel has no message. */
  EmptyState: () => JSX.Element;
}

export interface ConversationChannelSettingsPaneProps {
  maxWidth: () => number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export interface ConversationProps {
  /** A channel, in place of an agent. Read once, when the view opens. */
  channel?: ConversationChannelSource | undefined;
  contextState?: AgentContextState | undefined;
  runtime?: ConversationRuntime | undefined;
  notice?: JSX.Element | undefined;
  onOpenUsage?: ((trigger: HTMLButtonElement) => void) | undefined;
  onOpenMarketplace?: (() => void) | undefined;
  /**
   * Opens Marketplace at one app, from a suggestion card. `connect` is true only when the person
   * pressed Connect or Install on the card: the page then starts the connect step.
   */
  onOpenMarketplaceApp?: ((request: { appId: string; connect: boolean }) => void) | undefined;
  /** The connectors of the server on screen, which a suggestion card for a connector reads. */
  connectors?: ConnectorRegistry | undefined;
  /**
   * Opens Server settings, MCP, and signs in to the row that an agent's sign-in card names. Absent
   * where this client cannot sign in for the server on screen; the card then says where to sign in.
   */
  onOpenMcpSignIn?: ((mcpServerId: string, trigger: HTMLElement | null) => void) | undefined;
  /** Whether the server on screen holds a sign-in for an MCP row, as Server settings last read it. */
  mcpSignedIn?: ((mcpServerId: string) => boolean) | undefined;
  platform?: import("@openbot/contracts/ipc").AppInfo["platform"] | undefined;

  agentStatus: AgentStatus;
  /** A joined server's agents are still on their way, so the composer says that it connects. */
  agentsConnecting?: boolean | undefined;
  /**
   * The plan windows for the active agent's provider and model, when the account usage has them.
   * The composer reads them for one thing only: a window at 100% means the next send is refused by
   * the provider, so the notice has to say so before the user writes the message.
   */
  accountUsage?: AccountUsage | null | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  /**
   * The endpoints the user named, so both model pickers can tell a custom model from an OpenCode
   * one. It travels as a prop rather than through `useCustomProviders()`, the same
   * path `providerRuntimeStatuses` above already takes.
   */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** The user's own ACP agents on this computer, for the model picker's Custom tab. */
  customAgents?: readonly CustomAgentSummary[] | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onConnectProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  canConnectProvider?: ((provider: AgentProviderId) => boolean) | undefined;
  /**
   * Take the user to the provider's sign-in. Separate from `onConnectProvider`, which is the
   * managed-download path and is withheld when downloads are unavailable: a signed-out provider
   * needs a way in whether or not OpenBot manages its CLI.
   */
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The code sign-in, for a provider that has one, when the browser sign-in is slow or fails. */
  onSignInWithCodeProvider?: ((provider: AgentProviderId) => void) | undefined;
  /** Open the Providers section of this server's settings, where the user adds an endpoint. */
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  /**
   * Open the Browser profiles section of the settings of the server that runs the agent. Absent for
   * a member, and for a host without `browser-profiles-v1`.
   */
  onManageBrowserProfiles?: ((trigger: HTMLElement) => void) | undefined;
  /** Opens the notification settings at a server, where the user changes the level of its agents. */
  onOpenNotificationSettings?: ((serverId: string, trigger: HTMLElement) => void) | undefined;
  agent: AgentProfile | undefined;
  agents: AgentProfile[];
  /**
   * The agents that the composer offers for a mention. Absent means `agents`. A hidden agent gets no
   * messages, so the desktop leaves it out; the timeline still names it from `agents`.
   */
  mentionAgents?: AgentProfile[] | undefined;
  availableRoutineIds?: readonly string[] | undefined;
  /** The agent's routines, for the chat card of a routine the agent created or changed. */
  routines?: readonly RoutineFields[] | undefined;
  modelOptions: ClientAgentModelOption[];
  messages: readonly AgentMessage[];
  messageReferences?: Record<string, AgentMessage> | undefined;
  /** The quoted originals that the host no longer has. Their replies show a note in place of the quote. */
  missingMessageReferences?: Readonly<Record<string, true>> | undefined;
  unreadCount: number;
  firstUnreadMessageId: string | null;
  loaded: boolean;
  hasOlder?: boolean | undefined;
  /** The messages above the loaded page, for the scroll rail. Absent when the host does not count them. */
  unloadedHistory?: UnloadedHistory | undefined;
  discontinuous?: boolean | undefined;
  loadingOlder?: boolean | undefined;
  olderError?: string | null | undefined;
  activeTurnId: string | null | undefined;
  activityDetail?: string | undefined;
  /** The host's progress lines of the newest turns, by turn, for the steps of each turn. */
  turnStepLines?: TurnStepLines | undefined;
  skillsMarketplaceOpen?: boolean | undefined;
  /**
   * True while a surface that can add or remove one of the host's MCP servers is open: the server
   * settings and the marketplace, where a plugin installs its app. The composer reads the
   * list again when the last of them closes, so a server added there can be tagged without a
   * restart.
   */
  mcpSettingsOpen?: boolean | undefined;
  globalOverlayOpen: boolean;
  settingsRequest: AgentSettingsRequest | null;
  messageFocusRequest: { agentId: string; messageId: string; nonce: number } | null;
  queue: QueueSnapshot | undefined;
  /** The agent's open waits. Absent where the host does not keep them. */
  waits?: readonly AgentWait[] | undefined;
  /** The agent's threads. Absent where the host keeps only the agent's own chat. */
  threads?: ConversationThreads | undefined;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserVisibilitySuspended: boolean;
  /**
   * The workspace content is covered by a panel above it, the Usage report today.
   * The conversation stays mounted, so its document-level keyboard listeners are
   * still registered; `inert` on the covered markup does not reach them.
   */
  workspaceCovered?: boolean | undefined;
  browserControlState: BrowserControlState;
  /** Optional browser stream adapter for a non-Electron client. */
  browserRuntime?: BrowserViewRuntime | undefined;
  server: ServerSummary | undefined;
  presence: TeamPresenceSnapshot;
  currentUserEmail: string;
  /**
   * Is the stamped sender of a message the reader? Only another person's message draws a face and a
   * name; a message with no sender is the reader's own, as every message was before senders.
   */
  isOwnSender: (senderId: string) => boolean;
  browserEnabled?: boolean | undefined;
  /** Settings → General sends links in chats to the built-in browser, when it shows. */
  openLinksInBrowser?: boolean | undefined;
  remoteDesktopEnabled?: boolean | undefined;
  remoteDesktopSessionActive: boolean;
  remoteDesktopVisible: boolean;
  prompt: Extract<AgentEvent, { type: "prompt" }> | undefined;
  /**
   * The interactive block of `prompt`'s message, when the agent asked with one. The prompt then draws
   * as the block's card; without it, as the prompt's questions.
   */
  promptUiBlock?: ConversationUiBlock | undefined;
  approval: Extract<AgentEvent, { type: "approval" }>["approval"] | undefined;
  /** A usage limit holds the agent's queued message on this computer. The chat asks where to send it. */
  usageLimitAsk?: UsageLimitAskCardProps | undefined;
  /** Whether a usage limit holds this model and account now. Absent for a joined server. */
  usageLimited?: ((choice: AgentModelChoice) => boolean) | undefined;
  /** The takeover of the open thread: of a side thread while one is open, else of the agent's own chat. */
  browserTakeover: BrowserTakeoverRequest | undefined;
  onSelectAgent: (agentId: string) => void;
  /**
   * What stops each agent in its own chat: a question, an approval, a browser takeover or a usage
   * limit. The waiting block names it for each agent that this agent asked.
   */
  agentWaits?: Record<string, SidebarAgentWait> | undefined;
  onUpdateAgent: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
  onSetAgentAvatar: (agentId: string, image: AvatarImageInput | null) => Promise<void>;
  /**
   * Sends one message. `clientMessageId` names it for the host, so a retry with the same id
   * returns the first receipt; the answer carries the host's id for the message, or why it failed.
   * `voiceRecordingDraftId` names what the user said, when a voice turn sends the message.
   */
  onSendMessage: (
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
    target?: ConversationTarget,
    clientMessageId?: string,
    voiceRecordingDraftId?: string,
  ) => Promise<SendMessageResult>;
  onMarkRead: () => Promise<void>;
  /** Marks an agent message and the messages after it unread. Without it, the message menu has no such item. */
  onMarkUnread?: ((messageId: string) => Promise<void>) | undefined;
  onLoadOlder?: (() => void) | undefined;
  onLoadLatest?: (() => Promise<void>) | undefined;
  onSearchMessages?: ((query: string) => Promise<{ messageIds: string[]; total: number }>) | undefined;
  onOpenSearchMessage?: ((messageId: string) => Promise<void>) | undefined;
  onTypingChange: (agentId: string, typing: boolean) => void;
  onAnswerPrompt: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  onPromptResolutionPresented?: ((agentId: string, turnId: string, requestId: string | number) => void) | undefined;
  onRespondToApproval: (decision: "accept" | "decline") => Promise<boolean>;
  /**
   * Moves an agent at Ask first to Full access and accepts the request in hand. Absent at any other
   * level, and where the user may not change the agent's Permissions.
   */
  onAlwaysAllowApproval?: (() => Promise<boolean>) | undefined;
  /**
   * Whether this agent acts without asking at Full access. Unknown while a remote host has not
   * answered. Together with the agent's access it gives the Permissions level.
   */
  agentAutoApproves?: boolean | undefined;
  /** Whether a joined server's host answered with the agent's backup models: owners and admins only. */
  remoteBackupModelsLoaded?: boolean | undefined;
  /** Whether a joined server's host answered with the agent's task limit: owners and admins only. */
  remoteTaskLimitLoaded?: boolean | undefined;
  /** Whether a joined server's host answered with the agent's busy-message mode: owners and admins only. */
  remoteBusyMessageModeLoaded?: boolean | undefined;
  /**
   * The default an agent without its own busy-message setting follows: this computer's for a local
   * agent, the host's for an agent of a joined server.
   */
  defaultBusyMessageMode?: BusyMessageMode | undefined;
  /** The account defaults an agent without its own value follows. Local agents only. */
  agentDefaults?: AgentDefaults | undefined;
  /** The app memory cap. Local agents only. */
  agentMemoryLimit?: number | undefined;
  /** Writes the agent's Permissions level. Absent where the user may not change it. */
  onUpdateAgentPermissions?: ((input: UpdateAgentAdminSettingsInput) => Promise<void>) | undefined;
  /** Starts a new chat with the agent. Absent when its host does not serve `context-reset-v1`. */
  onClearAgentContext?: (() => Promise<void>) | undefined;
  /** Compacts the agent's context now. The context ring offers it only where OpenBot compacts. */
  onCompactAgentContext?: (() => Promise<void>) | undefined;
  /** Answers `browserTakeover`. */
  onRespondToBrowserTakeover: (decision: "complete" | "cancel", options?: PromptAnswerOptions) => Promise<boolean>;
  onCancelQueuedMessage: (deliveryId: string) => void;
  onCancelWait?: ((waitId: string) => void) | undefined;
  onSteerQueuedMessage: (deliveryId: string) => void;
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

/** `messageId` is the conversation message the host stored: the delivery id of the receipt. */
export type SendMessageResult = { messageId: string } | { error: string };

export interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  replyToMessageId: string | null;
}

/**
 * What the file preview panel is showing. A shared or workspace file is named by its path, which
 * the main process reads; an attachment is named by its record, because its bytes arrive over
 * `previewUrl` and "open externally" goes through the attachment handler instead of a path.
 */
type SidebarFilePreviewSource =
  | { kind: "shared"; path: string }
  /**
   * `agentId` is the agent whose workspace holds the path. In a channel it is the agent that wrote
   * the link, not the channel. `folder` is the folder view the file was opened from, so the panel
   * can go back to it.
   */
  | { kind: "workspace"; agentId: string; path: string; folder?: string | undefined }
  | { kind: "attachment"; attachment: AttachmentSummary };

export type SidebarFilePreview =
  | { ownerAgentId: string; source: SidebarFilePreviewSource; preview: FilePreview; directory?: undefined }
  | {
      ownerAgentId: string;
      source: { kind: "workspace-folder"; agentId: string; path: string };
      preview: null;
      directory: WorkspaceDirectory;
    };

export type RightPanelMode =
  | "none"
  /** The side panel with no open pane. It lists the panes it can open. */
  | "side-panel"
  | "browser"
  | "browser-expanded"
  | "browser-pip"
  | "settings"
  | "file-preview"
  | "files"
  | "question"
  | "voice"
  | "subagent"
  /** A side thread in the side panel, beside the agent's own chat. */
  | "thread";

export type { SidePanelPane } from "@openbot/ui/features/conversation/SidePanel";

/**
 * The threads of the active agent. A side thread is a task of the host; the agent's own chat is the
 * main thread. Each action applies to the open thread.
 */
export interface ConversationThreads {
  header: ThreadHeaderProps;
  /** The side threads with a tab in the side panel. */
  side: SideThreads;
  /** The open side thread, or null for a new thread. Undefined while the agent's own chat is open. */
  open: AgentTask | null | undefined;
  /** How many side threads of the agent can run at the same time. */
  limit: number;
  /** The side threads that run a turn now. */
  running: number;
  /** The conversation of the open side thread, when it loaded. */
  conversation: ConversationSnapshot | undefined;
  /** The approval that the open side thread's turn waits for. */
  approval: AgentApproval | undefined;
  /** The thread takes files. Only this computer sends them: `agent-tasks-v1` carries text only. */
  acceptsFiles: boolean;
  /** `attachmentDraftIds` are the files that the text names. */
  onSend: (text: string, attachmentDraftIds: string[]) => Promise<boolean>;
  onStop: () => void;
  /** The person sees the open side thread through this message. */
  onRead: (messageId: string) => void;
  onRespondApproval: (decision: "accept" | "decline", options?: PromptAnswerOptions) => Promise<boolean>;
  /** The context of the open side thread, when its provider reported it. */
  contextState: AgentContextState | undefined;
  /** Missing when the host cannot compact a side thread. */
  onCompactContext?: (() => Promise<void>) | undefined;
  /** Missing when the host cannot move a queued message to a new thread. */
  onRunQueuedMessage?: ((deliveryId: string) => void) | undefined;
  /**
   * Copies a conversation through an agent answer into a new thread, and opens it: the agent's own
   * chat when `sourceTaskId` is null, or a side thread. Resolves true when the branch opened. Missing
   * when the host cannot branch.
   */
  onBranch?: ((sourceTaskId: string | null, messageId: string) => Promise<boolean>) | undefined;
  /** Where a side thread came from, when it is a branch. Undefined for a thread that is no branch. */
  branchSource: (task: AgentTask) => ConversationBranchSource | undefined;
  /** The message that a side thread scrolls to once, after a click on "Branched from". */
  focusMessage: { taskId: string; messageId: string; nonce: number } | null;
}

/** The source of a branch: the agent's own chat, a side thread, or a side thread that was deleted. */
export interface ConversationBranchSource {
  throughMessageId: string;
  /** The title of the source thread. Null for the agent's own chat, which shows the agent's name. */
  title: string | null;
  deleted: boolean;
  /** Opens the source at the message that the branch came from. */
  onOpen: () => void;
}

/** The side threads in the side panel. Each shows beside the agent's own chat. */
interface SideThreads {
  /** In tab order. */
  tabs: readonly ThreadItem[];
  /** A thread of a tab, with the actions of its own message box. Undefined when the thread is gone. */
  thread: (id: string) => SideThread | undefined;
  /** Moves a chat tab to the side panel. */
  onToSide: (id: string) => void;
  /** Moves a side panel tab back to the chat tabs, and opens it there. */
  onToChat: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, index: number) => void;
}

/** A side thread in the side panel. Each action applies to this thread. */
export interface SideThread {
  task: AgentTask;
  conversation: ConversationSnapshot | undefined;
  approval: AgentApproval | undefined;
  onSend: (text: string, attachmentDraftIds: string[]) => Promise<boolean>;
  onStop: () => void;
  onRead: (messageId: string) => void;
  onRespondApproval: (decision: "accept" | "decline", options?: PromptAnswerOptions) => Promise<boolean>;
  contextState: AgentContextState | undefined;
  onCompactContext?: (() => Promise<void>) | undefined;
}
