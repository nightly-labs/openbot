import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_PROVIDERS,
  agentProviderDescriptor,
  agentSteersTurns,
  customAgentIdOfModel,
} from "@openbot/contracts/agent-providers";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { CREDIT_MEDIA_PREFERRED_MODELS } from "@openbot/contracts/credit-media";
import { developmentStartingModel } from "@openbot/contracts/development-defaults";
import type { FeedbackFacts } from "@openbot/contracts/feedback";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentAccessLevel,
  AgentAnalyticsInput,
  AgentApproval,
  AgentEvent,
  AgentMemory,
  AgentMemorySelectionState,
  AgentModelId,
  AgentModelOption,
  AgentPendingRuntime,
  AgentReasoningEffort,
  AgentRuntimePrompt,
  AgentRuntimeSnapshot,
  AgentSessionSettings,
  AgentStatus,
  AgentSummary,
  AgentTask,
  AgentTaskInput,
  AgentTaskPage,
  AgentTaskReadState,
  AgentTasksSnapshot,
  AgentTaskWindow,
  AgentUsageLimitReturn,
  AgentWaitsSnapshot,
  ArchivedAgentTasksPage,
  AskSideQuestionInput,
  AttachmentDataInput,
  AvatarImageInput,
  BranchAgentTaskInput,
  CancelMcpSignInInput,
  CapabilityState,
  ChannelMemory,
  ChannelRoutine,
  ChannelRoutineRun,
  CodexLiveVoice,
  CompleteMcpSignInRelayInput,
  ConversationFileSearchPage,
  ConversationMessage,
  ConversationMessageSender,
  ConversationPage,
  ConversationPageAnchor,
  ConversationReadState,
  ConversationSearchPage,
  ConversationSnapshot,
  ConversationWithReadState,
  CreateAgentInput,
  CreateAgentMemoryInput,
  CreateChannelMemoryInput,
  CreateChannelRoutineInput,
  CreateRoutineInput,
  CustomProviderHarness,
  CustomProviderRestart,
  DeleteAgentMemoryInput,
  DeleteChannelMemoryInput,
  DeleteChannelRoutineInput,
  DeleteConversationMessageInput,
  DeleteRoutineInput,
  DeleteSharedTableInput,
  DraftAttachment,
  DuplicateAgentResult,
  GenerateAgentProfileInput,
  HiddenAgentsSnapshot,
  HostAnalyticsInput,
  ListArchivedAgentTasksInput,
  ListChannelRoutineRunsInput,
  ListRoutineRunsInput,
  LocalBrowserSecretResponse,
  MarkAgentTaskReadInput,
  McpServerConfig,
  McpSignInAppInput,
  McpSignInAppState,
  McpSignInState,
  McpTestResult,
  MessagePinner,
  PasswordManagerId,
  PinnedMessagesSnapshot,
  ProviderAccountCodeLoginStart,
  ProviderAccountCodeLoginStatus,
  ProviderCodeLoginStart,
  ProviderUsageResets,
  QueuedMessageReceipt,
  QueueHold,
  QueueSnapshot,
  ReadAgentTaskAroundInput,
  ReadAgentTaskPageInput,
  RemoveMcpServerInput,
  ReorderQueueInput,
  ResetAgentSessionSettingInput,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  Routine,
  RoutineRun,
  RunQueuedMessageAsTaskInput,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
  SaveMcpServerInput,
  SaveMcpSignInAppInput,
  SaveSkillSuggestionInput,
  SendMessageInput,
  SentMessageStats,
  SetAgentHiddenInput,
  SetAgentMemoryInclusionInput,
  SetAgentSessionSettingInput,
  SetMcpServerEnabledInput,
  SetMessagePinnedInput,
  SetMessageReactionInput,
  SharedTable,
  SidebarLayoutSnapshot,
  SidebarSection,
  SignOutMcpServerInput,
  StartAgentTaskInput,
  SteerQueuedMessageInput,
  TestChannelRoutineInput,
  TestMcpServerInput,
  TestRoutineInput,
  UpdateAgentInput,
  UpdateAgentMemoryInput,
  UpdateChannelMemoryInput,
  UpdateChannelRoutineInput,
  UpdateQueuedMessageInput,
  UpdateRoutineInput,
  VoiceLiveEvent,
  VoiceLiveSession,
  VoiceLiveStart,
  WithdrawFeedbackInput,
  WithdrawFeedbackResult,
} from "@openbot/contracts/ipc";
import {
  AGENT_TASK_LIMIT_DEFAULT,
  type AgentDefaults,
  type AgentModelChoice,
  agentAutomationAllowed,
  agentBrowserProfile,
  agentNewChatAllowed,
  agentTaskLimit,
  type BusyMessageMode,
  browserHttpSignInPrompts,
  COMPUTER_USE_MCP_SERVER_NAME,
  CONTEXT_RESET_ITEM_TYPE,
  type CreditsHold,
  DEFAULT_BUSY_MESSAGE_MODE,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  DEFAULT_RESPONSE_STYLE,
  GITHUB_CONNECTOR_MCP_SERVER_NAME,
  isContextResetMarker,
  isCustomProviderHarness,
  type MacPermissionId,
  type MediaApprovalCreditsSetting,
  type MediaApprovalOffer,
  MODEL_SWITCH_ITEM_TYPES,
  type ModelSwitchReason,
  type QueueSteerFallback,
  type RespondToCreditsHoldInput,
  type RespondToMediaApprovalInput,
  type ResponseStyle,
  type SkillLearningMode,
  sameAgentBrowserProfile,
  sameAgentModelChoice,
  WORKFLOW_CATALOG_PROVIDERS,
  WORKFLOW_MEDIA_CATALOG_MAX,
  WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX,
  WORKFLOW_MEDIA_SERVICE_ACCOUNT_NAME_MAX,
  WORKFLOWS_USAGE_ID,
  type WorkflowCatalogProvider,
  type WorkflowCatalogSource,
  type WorkflowMediaCatalog,
  type WorkflowMediaCredits,
  type WorkflowMediaPrice,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaProvider,
  type WorkflowMediaProviders,
  type WorkflowMediaSpecs,
  workflowCatalogSource,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { AGENT_THREAD_READS_LIMIT } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { browserPermissionRequests } from "@openbot/contracts/team-protocol/browser-permissions-v1";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { ContextCompactRefusedError } from "@openbot/contracts/team-protocol/context-compact-v1";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { workflowMediaCreditsOf, workflowMediaProvidersOf } from "@openbot/team-client/workflow-decoding";
import { type CauseCode, classifyFailure, isCauseCode } from "@openbot/telemetry";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import { AgentMemories } from "./agent/agent-memories";
import { AgentRemoval, AgentRemovalFailed } from "./agent/agent-removal";
import { AgentSettingsRefused } from "./agent/agent-settings-refused";
import type { ApprovalAutomationPolicy } from "./agent/approval-automation";
import { AttachmentGateway } from "./agent/attachment-gateway";
import {
  type ApprovalResponder,
  AttentionRegistry,
  type LocalAttentionResponse,
  type PromptResponder,
} from "./agent/attention-registry";
import type { AvatarImageDecoder } from "./agent/avatar-file";
import { backgroundModel, withBackgroundEffort } from "./agent/background-model";
import { BootRecovery } from "./agent/boot-recovery";
import type { AgentBrowserProfiles } from "./agent/browser-profile-tool";
import { BrowserUploads } from "./agent/browser-uploads";
import type { ChatVisualPreviewHost } from "./agent/chat-visual-preview";
import type { ClientBrowser } from "./agent/client-browser-tools";
import { CodexIdleSessions } from "./agent/codex-idle-sessions";
import type { SetCommitCoAuthor } from "./agent/commit-co-author-tool";
import { ContextCompaction, compactsOnRequest } from "./agent/context-compaction";
import { ConversationReader } from "./agent/conversation-reader";
import { ConversationRuntime } from "./agent/conversation-runtime";
import {
  type CreditAsksPerson,
  type CreditMediaReport,
  CreditMediaTools,
  DEFAULT_MEDIA_APPROVAL_CREDITS,
} from "./agent/credit-media-tools";
import { CustomEndpoints, toEndpointChangeFailed } from "./agent/custom-endpoints";
import { agentNamesById, displayMessageReferences, type TagReferenceSource } from "./agent/delivery-content";
import { DeltaBuffer } from "./agent/delta-buffer";
import type { SectionTeammates } from "./agent/developer-instructions";
import { DrainScheduler } from "./agent/drain-scheduler";
import { DuplicationGate, toAgentDuplicationFailed } from "./agent/duplication-gate";
import type { FailureContext, FailureSignal } from "./agent/failure-signal";
import { FeedbackWithdrawal } from "./agent/feedback-withdrawal";
import { type FinishCheckInput, FinishCheckResult, finishCheckPrompt } from "./agent/finish-check";
import { type AgentHostedSites, HostedSiteCoordinator } from "./agent/hosted-site-coordinator";
import { ImageGenRuntime } from "./agent/image-gen-runtime";
import {
  decodeGeneratedImage,
  type GeneratedMediaKind,
  generatedImageName,
  generatedMediaKind,
  generatedVideoName,
  imageGenerationFailure,
  imageGenerationUsageLimited,
} from "./agent/image-generation";
import type { ImageFitter } from "./agent/image-reader";
import { InstructionsChanges } from "./agent/instructions-changes";
import type { AgentLibraryFolders } from "./agent/library-folder-tools";
import { LiveVoice, type LiveVoiceOwner, type LiveVoiceRelayed, type LiveVoiceReply } from "./agent/live-voice";
import { MailboxSync } from "./agent/mailbox-sync";
import { type GitHubConnectorSource, McpGateway, type TestMcpServerOptions } from "./agent/mcp-gateway";
import { agentFallbackMcpServers, type MarketplaceAppServer, mcpServersFromGateway } from "./agent/mcp-tools";
import { MemoryHold } from "./agent/memory-hold";
import { MEMORY_REVIEW_MESSAGES, MemoryReview } from "./agent/memory-review";
import { MemoryReviewCursors } from "./agent/memory-review-cursors";
import type { ReviewSkill } from "./agent/memory-review-prompt";
import { MessageDeletion } from "./agent/message-deletion";
import { MessagePins } from "./agent/message-pins";
import {
  creationModel,
  developmentDefaultsApply,
  type ModelChoice,
  modelUnavailableError,
  type ProviderPreference,
  runnableStartingChoice,
  startingChoice,
  startingModel,
  workflowProvider,
} from "./agent/model-choice";
import {
  type AgentFeedback,
  type AgentMessageSteer,
  type AgentServerClaims,
  type McpServerOwnerHooks,
  OpenBotToolRouter,
} from "./agent/openbot-tool-router";
import { PlanContinuation } from "./agent/plan-continuation";
import { ProfileClients } from "./agent/profile-clients";
import {
  GenerationUsageLimitError,
  generateProfile,
  generateTextWithoutTools,
  ProfileGenerationFailed,
} from "./agent/profile-generation";
import { ProfileSave, standingProfileChanged, toProfileSaveFailed } from "./agent/profile-save";
import { pickPoolAccount } from "./agent/provider-account-pool";
import type { ProviderAccountStore } from "./agent/provider-account-store";
import { isBalanceDiagnostic, isPlanLimitDiagnostic, providerResetDelayMs } from "./agent/provider-diagnostics";
import { type AgentClientFactory, ProviderRuntime, toProviderOperationFailed } from "./agent/provider-runtime";
import { ProviderSignInWaits } from "./agent/provider-sign-in-waits";
import { QueueControls } from "./agent/queue-controls";
import {
  type FollowsUpOwnAnswer,
  quietRoutineRun,
  quietTeammateDelivery,
  quietTeammateTurnDelivery,
} from "./agent/routine-quiet-runs";
import { type RoutineMutationOptions, RoutineScheduler, toRoutineOperationFailed } from "./agent/routine-scheduler";
import { localTimezone } from "./agent/routine-tools";
import { buildRuntimeSnapshot } from "./agent/runtime-snapshot";
import type { ScreenCaptureHost } from "./agent/screen-capture";
import { SessionSettings } from "./agent/session-settings";
import { SIDE_QUESTION_CHAT_MESSAGES, sideQuestionPrompt } from "./agent/side-question";
import type { AgentSidebar } from "./agent/sidebar-tools";
import type { SkillLearner } from "./agent/skill-learning";
import type { LocalSkillTools } from "./agent/skill-tools";
import {
  agentProviderAccount,
  isRequestTimeout,
  providerForAgent,
  providerLabel,
  type ToolUsageSignal,
} from "./agent/thread-items";
import { type RuntimeRefreshTiming, ThreadLifecycle } from "./agent/thread-lifecycle";
import { ToolOperationFailed, toToolOperationFailed } from "./agent/tool-operation";
import { TurnContext } from "./agent/turn-context";
import { type AgentBrowserHost, FAILOVER_CAUSES, isStreamingDelta, TurnLifecycle } from "./agent/turn-lifecycle";
import { sideSessionUsageObserver, workflowUsageObserver } from "./agent/usage-collection";
import { toUsageReadFailed, UsageLimitGate, type UsageLimitKey } from "./agent/usage-limit-gate";
import type { VideoReaderHost } from "./agent/video-reader";
import { WarmGenerations } from "./agent/warm-generations";
import { removeWebhookSecretKey, type WebhookRoutineWriter } from "./agent/webhook-routine-tool";
import {
  workflowGenerationError,
  workflowMediaAnswerError,
  workflowMediaError,
} from "./agent/workflow-generation-error";
import { confinedWritesAllowed, effectiveAgentFolders } from "./agent/workspace-sandbox";
import type { AgentApiKeys } from "./agent-api-keys";
import { type AgentProvider, fixedContextCompaction } from "./agent-client";
import type { AgentTables } from "./agent-data/agent-tables";
import {
  AgentHistoryTransfer,
  AgentHistoryTransferFailed,
  HISTORY_IMPORTED_EVENT,
  type HistoryThread,
  type ImportHistoryThreadInput,
} from "./agent-history-transfer";
import type { AgentStore } from "./agent-store";
import { type AgentTaskBranchFailed, AgentTasks } from "./agent-tasks/agent-tasks";
import { type AgentThreadRecord, AgentThreadStore } from "./agent-threads/agent-thread-store";
import { AgentWaitStore } from "./agent-waits/agent-wait-store";
import { AgentWaits } from "./agent-waits/agent-waits";
import { automationRunCommand } from "./automation-command";
import { channelSync, toChannelOperationError } from "./channel-effects";
import { type ChannelImageFile, ChannelImages } from "./channel-images";
import { ChannelRequestReturns } from "./channel-request-returns";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService, channelLeadFailureText } from "./channel-service";
import type { BundledProviderExecutables } from "./cli";
import type { ConversationMarkerExclusions } from "./conversation-read-store";
import type { CrmHandle } from "./crm/crm";
import type { ProviderSession } from "./database/provider-sessions";
import { reportOriginalFailure } from "./effect-boundary";
import type { HostMemory } from "./host-memory";
import type { SignInRegion } from "./kimi-region";
import type { LinkWallet } from "./link-wallet";
import { type MailboxStore, MESSAGING_LANE } from "./mailbox-store";
import { toMcpOperationError } from "./mcp-effects";
import type { McpSignInAddressOutcome, McpSignInOpener } from "./mcp-oauth-provider";
import { McpServerStore } from "./mcp-server-store";
import type { MessageDeleteAccess, MessageDeleteRefused } from "./message-delete";
import type { MessagePinRefused } from "./message-pins";
import { isAnswer, MessagingThreads, toMessagingThreadFailed } from "./messaging/messaging-threads";
import type { NearWallet } from "./near-wallet";
import type { CustomProviderConfig } from "./opencode-config";
import type { PasswordVault } from "./password-vault";
import { canConfineProcesses } from "./process-confinement";
import {
  type AppServerNotification,
  decodeRecordResponse,
  getRecord,
  getString,
  isRecord,
  type ThreadItem,
} from "./protocol";
import { NO_PROVIDER_CREDENTIALS, type ProviderClientContext, requireProviderDriver } from "./provider-drivers";
import { providerHistoryPersistence } from "./provider-history-persistence";
import { recordAgentRestartActivity } from "./restart-activity";
import type { RoutineFlowTools } from "./routine-flows/routine-flow-tools";
import { RoutineRecords } from "./routine-records";
import type { ImportedRoutineRun, RoutineHoldWindow } from "./routine-store";
import { type RoutineDueSource, RoutineTimer } from "./routine-timer";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import { shortenDiagnostic } from "./stderr-diagnostics";
import { extractJsonObject } from "./structured-output";
import type { UserBrowsingLog } from "./user-browsing-log";
import type { VaultItems } from "./vault-items";
import { type CreditMediaGateway, CreditMediaWorkflows } from "./workflows/credit-media";
import { generateHiggsfieldMedia, HIGGSFIELD_MCP_HOST, readHiggsfieldCredits } from "./workflows/higgsfield-media";
import { WorkflowMediaCatalogCache } from "./workflows/media-catalog";
import { generateSunraMedia, readSunraCredits, SUNRA_MCP_HOST } from "./workflows/sunra-media";
import type { WorkflowTools } from "./workflows/workflow-tools";
import { type MediaImageRole, type MediaPictureRole, mediaInputText } from "./workflows/workflow-walk";
import type { WorkflowRunEnd } from "./workflows/workflows";
import {
  listWorkspaceDirectory,
  type ResolvedSharedFile,
  resolveSharedFile,
  resolveWorkspaceFile,
} from "./workspace-paths";

const logger = createOpenBotLogger("agent-service");

const routingLogger = createOpenBotLogger("channel-routing");
const errorLogger = createOpenBotLogger("agent-error");

const MEDIA_SERVICE_HOSTS: Readonly<Record<WorkflowCatalogProvider, string>> = {
  sunra: SUNRA_MCP_HOST,
  higgsfield: HIGGSFIELD_MCP_HOST,
};
const MEDIA_SERVICE_NAMES: Readonly<Record<WorkflowCatalogProvider, string>> = {
  sunra: "Sunra",
  higgsfield: "Higgsfield",
};

const DEFAULT_BUNDLED_EXECUTABLES: BundledProviderExecutables = { claude: null, grok: null };

export type { TestMcpServerOptions } from "./agent/mcp-gateway";
export type { RoutineMutationOptions } from "./agent/routine-scheduler";
export type { ResolvedSharedFile } from "./workspace-paths";

interface AgentServiceEvents {
  failure: [failure: FailureSignal];
  event: [event: AgentEvent, memberId?: string];
  toolUsage: [usage: ToolUsageSignal];
  workflowRun: [end: WorkflowRunEnd];
  creditMedia: [report: CreditMediaReport];
  liveVoice: [event: VoiceLiveEvent, memberId: string | null];
}

export interface AgentServiceOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  browser: AgentBrowserHost;
  requestTimeoutMs?: number;
  contextCompactionTimeoutMs?: number;
  cacheExpiryCompactionDelayMs?: number;
  cacheExpiryCompaction?: () => boolean;
  mediaApprovalCredits?: () => MediaApprovalCreditsSetting;
  creditAsks?: {
    muted: (personIds: readonly string[]) => boolean;
    enableAgents: () => Effect.Effect<void, unknown>;
    mute: (person: CreditAsksPerson | null) => Effect.Effect<void, unknown>;
  };
  memoryReviewIdleMs?: number;
  finishCheck?: boolean;
  preferredProvider?: AgentProvider;
  preferredModel?: AgentModelId | null;
  clientFactory?: AgentClientFactory | null;
  bundledExecutables?: BundledProviderExecutables;
  prepareAgentWorkspace?: (agent: AgentSummary) => Effect.Effect<void, AgentLifecycleFailed>;
  hostedSites?: AgentHostedSites | null;
  visualPreview?: ChatVisualPreviewHost | null;
  setCommitCoAuthor?: SetCommitCoAuthor | undefined;
  clearPictureBackground?: ((bytes: Uint8Array) => Uint8Array | null) | undefined;
  screenCapture?: ScreenCaptureHost | null;
  videoReader?: VideoReaderHost | null;
  fitImage?: ImageFitter | null;
  avatarDecoder?: AvatarImageDecoder | null;
  prepareMcpTest?: (config: McpServerConfig) => Effect.Effect<void, unknown>;
  mcpAgentAccess?: (mcpServerId: string, agentId: string | null) => boolean;
  hiddenModels?: (provider: AgentProvider) => ReadonlySet<string> | undefined;
  marketplaceAppServer?: (appId: string) => MarketplaceAppServer | null;
  passwordManagerConnected?: (manager: PasswordManagerId) => boolean;
  feedbackFacts?: FeedbackFacts | null;
  feedback?: AgentFeedback | null;
  serverClaims?: AgentServerClaims | null;
  browserProfiles?: (() => AgentBrowserProfiles | null) | undefined;
  clientBrowser?: ClientBrowser | null;
  crm?: (() => CrmHandle | null) | undefined;
  crmAgentVisibleToMembers?: ((agentId: string) => boolean) | undefined;
  personCanAdminister?: ((personId: string) => boolean) | undefined;
  mcpServerOwners?: McpServerOwnerHooks | undefined;
  sidebarLayout?: AgentSidebar | null;
  libraryFolders?: AgentLibraryFolders | null;
  credentials?: ProviderClientContext;
  offProviders?: readonly AgentProvider[];
  providerAccounts?: ProviderAccountStore;
  saveProviderUse?: (provider: AgentProvider, on: boolean) => Effect.Effect<void, AgentLifecycleFailed>;
  installedCliProviders?: readonly AgentProvider[];
  saveInstalledCliChoice?: (provider: AgentProvider, installed: boolean) => Effect.Effect<void, AgentLifecycleFailed>;
  localSkillTools?: (() => LocalSkillTools) | undefined;
  reviewSkills?: ((agentId: string) => Effect.Effect<readonly ReviewSkill[], unknown>) | undefined;
  reviewSkillsFull?: ((agentId: string) => Effect.Effect<boolean, unknown>) | undefined;
  skillLearning?: (() => SkillLearningMode) | undefined;
  userBrowsing?: Pick<UserBrowsingLog, "pending" | "reviewed" | "forgetAgent"> | undefined;
  skillLearner?: (() => SkillLearner) | undefined;
  routineFlowTools?: () => RoutineFlowTools;
  workflowTools?: () => WorkflowTools;
  webhookRoutines?: () => WebhookRoutineWriter;
  approvalAutomation?: ApprovalAutomationPolicy | undefined;
  busyMessageMode?: () => BusyMessageMode;
  responseStyle?: () => ResponseStyle;
  agentMemoryLimit?: () => number;
  memoryReviewInterval?: () => number;
  timezone?: () => string;
  chosenTimezone?: () => string | null;
  extraRoutineSources?: () => Iterable<RoutineDueSource>;
  channelPersonAgentLevel?: (personId: string, agentId: string) => AgentAccessLevel;
  channelRemotePerson?: (personId: string) => boolean;
  deleteWithRevokedApproval?: (
    agentId: string,
    remove: () => Effect.Effect<void, AgentRemovalFailed>,
  ) => Effect.Effect<void, AgentRemovalFailed>;
  tables?: AgentTables | null;
  developmentDefaults?: boolean;
  computerUseMcpServer?: () => McpServerConfig | null;
  githubConnector?: GitHubConnectorSource | null;
  passwordVault?: PasswordVault | null;
  vaultItems?: VaultItems | null;
  linkWallet?: LinkWallet | null;
  nearWallet?: NearWallet | null;
  agentApiKeys?: AgentApiKeys | null;
  hostMemory?: HostMemory | null;
  hostTurnLimits?: { turnLimit(): number | "unlimited" | null; agentTaskLimit(): number };
  hostedStorageGb?: () => number | null;
  agentCursorDrawn?: boolean;
  computerUseOnWayland?: boolean;
  computerUseInputRefused?: () => boolean;
  computerUseForegroundInput?: boolean;
  computerUseMissingPermissions?: () => readonly MacPermissionId[];
  codexIdleSessions?: { releaseAfterMs: number; idleLimit: number };
  creditMedia?: CreditMediaGateway | null;
}

const USER_SEND_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const LIVE_VOICE_RELAYED_LIMIT = 50;
const FROM_CHROME_LIMIT = 200;

function userSendKey(sender: ConversationMessageSender | undefined, agentId: string, clientMessageId: string): string {
  return `user-send:${createHash("sha256")
    .update(JSON.stringify([sender?.id ?? null, agentId, clientMessageId]))
    .digest("hex")}`;
}

function agentCreateKey(sender: ConversationMessageSender | undefined, operationId: string): string {
  return `agent-create:${createHash("sha256")
    .update(JSON.stringify([sender?.id ?? null, operationId]))
    .digest("hex")}`;
}
const MAX_SECTION_TEAMMATES = 32;
const TASK_STOP_WAIT_MS = 15_000;
const PARTIAL_LIST_RECHECK_MS = 5_000;
const CODEX_SESSION_IDLE_RELEASE_MS = 5 * 60_000;
const CODEX_IDLE_SESSION_LIMIT = 1;

export type AgentUpdate = UpdateAgentInput & {
  ownBrowserSession?: boolean;
  browserProfileId?: string | null;
  additionalFolders?: string[];
  excludedFolders?: string[];
};

interface WorkflowModelInput {
  provider: AgentProvider | null;
  model: string | null;
  effort: AgentReasoningEffort | null;
}

export class AgentService extends EventEmitter<AgentServiceEvents> {
  readonly channels: ChannelService;
  readonly messaging: MessagingThreads;
  readonly #profileSave: ProfileSave;
  readonly #profileClients = new ProfileClients();
  readonly #warmGenerations = new WarmGenerations({
    ownerFor: (provider) => this.#providers.currentClient(provider),
    createClient: (provider) => this.#providers.createProfileClient(provider),
    profileClients: this.#profileClients,
  });
  #scope = Scope.makeUnsafe();
  readonly #pendingUserSends = new Map<string, Deferred.Deferred<QueuedMessageReceipt, AgentLifecycleFailed>>();
  readonly #pendingTaskStarts = new Map<string, Deferred.Deferred<AgentTask, AgentLifecycleFailed>>();
  readonly #pendingAgentCreates = new Map<string, Deferred.Deferred<AgentSummary, AgentLifecycleFailed>>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #reader: ConversationReader;
  readonly #memories: AgentMemories;
  readonly #instructionChanges = new InstructionsChanges();
  readonly #memoryReview: MemoryReview;
  readonly #waits: AgentWaits;
  readonly #tasks: AgentTasks;
  readonly #history: AgentHistoryTransfer;
  readonly #messageDeletion: MessageDeletion;
  readonly #feedbackWithdrawal: FeedbackWithdrawal;
  readonly #messagePins: MessagePins;
  readonly #tables: AgentTables | null;
  readonly #routines: RoutineScheduler;
  readonly #routineTimer: RoutineTimer;
  readonly #channelRoutines: ChannelRoutineScheduler;
  readonly #channelRequestReturns: ChannelRequestReturns;
  readonly routineRecords: RoutineRecords;
  readonly #mcp: McpGateway;
  readonly #mediaCatalog: WorkflowMediaCatalogCache;
  readonly #creditMedia: CreditMediaWorkflows | null;
  readonly #mcpAgentAccess: AgentServiceOptions["mcpAgentAccess"];
  readonly #hiddenModels: AgentServiceOptions["hiddenModels"];
  readonly #clearPictureBackground: AgentServiceOptions["clearPictureBackground"];
  readonly #providers: ProviderRuntime;
  readonly #providerUseChanges = Semaphore.makeUnsafe(1);
  readonly #endpoints: CustomEndpoints;
  readonly #prepareAgentWorkspace: (agent: AgentSummary) => Effect.Effect<void, AgentLifecycleFailed>;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #images: ImageGenRuntime;
  readonly #threads: ThreadLifecycle;
  readonly #codexIdleSessions: CodexIdleSessions;
  readonly #memoryHold: MemoryHold;
  readonly #usageLimits: UsageLimitGate;
  readonly #drain: DrainScheduler;
  readonly #sessionSettings: SessionSettings;
  readonly #liveVoice: LiveVoice;
  readonly #liveVoiceRelayed = new Map<string, LiveVoiceRelayed>();
  readonly #fromChrome = new Set<string>();
  readonly #queue: QueueControls;
  readonly #attachments: AttachmentGateway;
  readonly #browserUploads: BrowserUploads;
  readonly #mailboxSync: MailboxSync;
  readonly #boot: BootRecovery;
  readonly #deltas: DeltaBuffer;
  readonly #turn: TurnLifecycle;
  readonly #compaction: ContextCompaction;
  readonly #duplication: DuplicationGate;
  readonly #removal: AgentRemoval;
  readonly #tools: OpenBotToolRouter;
  readonly #sidebarLayout: AgentSidebar | null;
  readonly #libraryFolders: AgentLibraryFolders | null;
  readonly #localSkillTools: (() => LocalSkillTools) | undefined;
  readonly #routineFlowTools: (() => RoutineFlowTools) | undefined;
  readonly #workflowTools: (() => WorkflowTools) | undefined;
  readonly #developmentDefaults: boolean;
  readonly #busyMessageMode: () => BusyMessageMode;
  readonly #defaultTaskLimit: () => number;
  readonly #stoppedTurns = new Map<string, string>();
  readonly #failedStops = new Map<string, string>();
  readonly #steersAfterTurnStart = new Map<string, { agentId: string; taskId: string | null; threadId: string }>();

  readonly #requestedNewChats = new Set<string>();
  readonly #settlingStaleTaskTurns = new Set<string>();
  readonly signInWaits = new ProviderSignInWaits((agentId) => this.#store.get(agentId) !== undefined);
  #signInProviders: ReadonlySet<AgentProvider> = new Set();
  readonly #planContinuation = new PlanContinuation({ limit: 8 });
  readonly #poolReads = new Map<AgentProvider, number>();
  readonly #poolReading = new Set<AgentProvider>();
  #initialized = false;
  #stopping = false;

  constructor(options: AgentServiceOptions) {
    super();
    this.#mcpAgentAccess = options.mcpAgentAccess;
    this.#hiddenModels = options.hiddenModels;
    this.#clearPictureBackground = options.clearPictureBackground;
    const {
      store,
      mailbox,
      browser,
      requestTimeoutMs = 30_000,
      preferredProvider = "codex",
      preferredModel = null,
      clientFactory = null,
      bundledExecutables = DEFAULT_BUNDLED_EXECUTABLES,
      prepareAgentWorkspace = () => Effect.void,
      hostedSites = null,
      sidebarLayout = null,
      libraryFolders = null,
      credentials = NO_PROVIDER_CREDENTIALS,
      localSkillTools,
      routineFlowTools,
      workflowTools,
      developmentDefaults = false,
      computerUseMcpServer = () => null,
      githubConnector = null,
      hostMemory = null,
      hostTurnLimits,
      busyMessageMode = () => DEFAULT_BUSY_MESSAGE_MODE,
      approvalAutomation,
    } = options;
    this.#developmentDefaults = developmentDefaults;
    this.#busyMessageMode = busyMessageMode;
    this.#defaultTaskLimit = () => hostTurnLimits?.agentTaskLimit() ?? AGENT_TASK_LIMIT_DEFAULT;
    this.#localSkillTools = localSkillTools;
    this.#routineFlowTools = routineFlowTools;
    this.#workflowTools = workflowTools;
    this.#store = store;
    this.#mcp = new McpGateway({
      servers: new McpServerStore(store.database),
      credentials,
      computerUseMcpServer,
      githubConnector,
      agents: () => store.list(),
      logger,
      hooks: {
        emitError: (code, error) => this.#emitError(code, error),
        refreshAllAgentRuntimes: (timing) => this.#threads.refreshAllAgentRuntimes(timing),
      },
    });
    this.#mediaCatalog = new WorkflowMediaCatalogCache({
      signIn: (provider) => this.#mediaSignIn(provider),
      warn: (message, details) => logger.warn(message, details),
    });
    this.#creditMedia = options.creditMedia
      ? new CreditMediaWorkflows({
          gateway: options.creditMedia,
          warn: (message, details) => logger.warn(message, details),
          creditsChanged: () => this.#emit({ type: "openbot-credits-changed" }),
        })
      : null;
    this.#sidebarLayout = sidebarLayout;
    this.#libraryFolders = libraryFolders;
    this.#profileSave = new ProfileSave(store, {
      create: (input, configure, sender) =>
        this.createAgent(
          { ...input.draft, initialMessage: input.initialMessage ?? "" },
          (agent) =>
            configure(agent).pipe(
              Effect.mapError(
                (failure) => new AgentLifecycleFailed({ operation: "configure profile", cause: failure.cause }),
              ),
            ),
          input.operationId,
          sender,
        ).pipe(toProfileSaveFailed),
      changed: (agent, previous) => {
        if (standingProfileChanged(previous, agent, this.#store.agentDefaults()))
          this.#conversation.unloadAgentThreads(agent.id);
        this.#emit({ type: "agents-changed", agents: this.listAgents() });
        this.#drain.scheduleDrain(agent.id);
      },
      delete: (agent) =>
        this.#removal.deleteData(agent).pipe(
          toProfileSaveFailed,
          Effect.tap(() => Effect.sync(() => this.#emit({ type: "agents-changed", agents: this.listAgents() }))),
        ),
    });
    this.#mailbox = mailbox;
    this.#browser = browser;
    this.#prepareAgentWorkspace = prepareAgentWorkspace;
    this.#conversation = new ConversationRuntime(
      store,
      (event) => this.#emit(event),
      () => this.listAgents(),
    );
    this.#history = new AgentHistoryTransfer({
      database: store.database,
      threads: new AgentThreadStore(store.database),
      mailbox,
      mainThread: (agentId) => store.ensureThreadIdNow(agentId),
      registerTaskThread: (agentId, threadId) => this.#conversation.registerTaskThread(agentId, threadId),
    });
    this.#tasks = new AgentTasks({
      store: new AgentThreadStore(store.database),
      mailbox,
      conversation: this.#conversation,
      hooks: {
        emit: (event) => this.#emit(event),
        agent: (agentId) => store.get(agentId),
        defaultTaskLimit: () => this.#defaultTaskLimit(),
        hold: (agentId, taskId) => this.#drain.taskHold(agentId, taskId),
        queued: (agentId) => {
          this.#mailboxSync.emitQueue(agentId);
          this.#drain.scheduleDrain(agentId);
        },
        turnActive: (agentId, threadId) => this.#store.database.readActiveTurnId(agentId, threadId) !== null,
        archived: Effect.fn("AgentService.archivedTasks")(function* (
          this: AgentService,
          agentId: string,
          tasks: readonly AgentThreadRecord[],
        ) {
          for (const task of tasks) {
            yield* this.#drain.endPlanContinuation(agentId, task.taskId);
            yield* this.#memoryReview.threadClosed(agentId, task.threadId);
          }
          this.#drain.scheduleDrain(agentId);
        }).bind(this),
        turnAnswer: (agentId, threadId, turnId) => this.#turnAnswer(agentId, turnId, threadId),
        closeTask: (agentId, taskId) => this.closeTask({ agentId, taskId }),
        fork: (work) => {
          Effect.runFork(work.pipe(Effect.forkIn(this.#scope, { startImmediately: true })));
        },
      },
    });
    this.#messageDeletion = new MessageDeletion({
      store,
      mailbox,
      conversation: this.#conversation,
      tasks: this.#tasks,
    });
    this.#feedbackWithdrawal = new FeedbackWithdrawal({
      store,
      conversation: this.#conversation,
      tasks: this.#tasks,
      feedback: options.feedback ?? null,
    });
    this.#messagePins = new MessagePins({
      store,
      tasks: this.#tasks,
      changed: (agentId) => this.#emit({ type: "message-pins-changed", agentId }),
    });
    this.#tables = options.tables ?? null;
    this.#memories = new AgentMemories({
      store,
      conversation: this.#conversation,
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      ...(options.agentMemoryLimit ? { limit: options.agentMemoryLimit } : {}),
    });
    const reviewSkills = options.reviewSkills;
    const reviewSkillsFull = options.reviewSkillsFull;
    const skillLearner = options.skillLearner;
    this.#memoryReview = new MemoryReview({
      memories: this.#memories,
      profileClients: this.#profileClients,
      listAgents: () => this.listAgents(),
      models: (agent) =>
        this.#providers.ensureProvider(agent.provider).pipe(Effect.map(() => this.#agentModels(agent))),
      createProfileClient: (agent) => this.#providers.createProfileClient(agent.provider, agent.providerAccountId),
      usageObserver: (agent, model) =>
        sideSessionUsageObserver("memory-review", this.#store.database.usage, agent.id, agent.provider, model.id),
      chat: (agentId, sideThreadId) => {
        const loaded = sideThreadId
          ? this.#conversation.loadedExecutionSnapshot(sideThreadId)
          : this.#conversation.loadedSnapshot(agentId);
        if (loaded)
          return loaded.activeTurnId
            ? loaded.messages.filter((message) => message.turnId !== loaded.activeTurnId)
            : loaded.messages;
        const threadId = sideThreadId ?? this.#store.get(agentId)?.threadId;
        return threadId
          ? this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, MEMORY_REVIEW_MESSAGES)
              .messages
          : [];
      },
      turnActive: (agentId, sideThreadId) =>
        Boolean(
          (sideThreadId
            ? this.#conversation.loadedExecutionSnapshot(sideThreadId)
            : this.#conversation.loadedSnapshot(agentId)
          )?.activeTurnId,
        ),
      appendSystemMessage: (agentId, sideThreadId, message) =>
        sideThreadId
          ? this.#appendSideThreadSystemMessage(agentId, sideThreadId, message, "thread.memory-reviewed")
          : this.#appendSystemMessage(agentId, message, "thread.memory-reviewed"),
      ...(reviewSkills ? { skills: reviewSkills } : {}),
      ...(reviewSkillsFull ? { skillsFull: reviewSkillsFull } : {}),
      ...(options.skillLearning ? { skillLearning: options.skillLearning } : {}),
      ...(options.userBrowsing ? { browsing: options.userBrowsing } : {}),
      ...(skillLearner
        ? {
            skillLearner: {
              read: (skillId) => Effect.suspend(() => skillLearner().read(skillId)),
              save: (agentId, draft) => Effect.suspend(() => skillLearner().save(agentId, draft)),
            },
          }
        : {}),
      redact: (text) => this.#mcp.redact(text),
      stopping: () => this.#stopping,
      ...(options.memoryReviewIdleMs === undefined ? {} : { idleMs: options.memoryReviewIdleMs }),
      ...(options.memoryReviewInterval ? { interval: options.memoryReviewInterval } : {}),
      cursors: new MemoryReviewCursors(join(store.database.userDataPath, "memory-review-cursors.json")),
    });
    this.#routineTimer = new RoutineTimer(
      () => [this.#routines, this.#channelRoutines, ...(options.extraRoutineSources?.() ?? [])],
      () => this.#initialized && !this.#stopping,
      (code, error) => this.#emitError(code, error),
    );
    this.#waits = new AgentWaits({
      store: new AgentWaitStore({ database: store.database }),
      mailbox,
      hooks: {
        emit: (event) => this.#emit(event),
        ownsRoutine: (agentId, routineId) => this.#routines.getRecord(agentId, routineId) !== null,
        hasRoutine: (agentId) => this.#routines.listRecordsFor(agentId).length > 0,
        requireKnownAgent: (agentId) => {
          this.#conversation.requireKnownAgent(agentId);
        },
        isSideThread: (agentId, taskId) => this.#tasks.isSideThread(agentId, taskId),
      },
    });
    this.#routines = new RoutineScheduler({
      timer: this.#routineTimer,
      waits: this.#waits,
      ...(options.timezone ? { timezone: options.timezone } : {}),
      webhookRoutines: options.webhookRoutines,
      store,
      mailbox,
      conversation: this.#conversation,
      hooks: {
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        emitQueue: (agentId) => this.#mailboxSync.emitQueue(agentId),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        interrupt: (agentId, turnId) => {
          const threadId = this.#conversation.snapshotWithTurn(agentId, turnId)?.threadId ?? null;
          const taskThreadId = threadId !== null && this.#conversation.isTaskThread(threadId) ? threadId : undefined;
          return this.interrupt(agentId, turnId, taskThreadId).pipe(toRoutineOperationFailed);
        },
        awaitDrain: (agentId) => this.#drain.taskFor(agentId)?.pipe(toRoutineOperationFailed),
        syncMailboxMessages: (snapshot) => this.#mailboxSync.syncMailboxMessages(snapshot),
        listAgents: () => this.listAgents(),
        excludedAgents: () => new Set([...this.#duplication.pendingAgents(), ...this.#removal.deleting()]),
        isRunning: () => this.#initialized && !this.#stopping,
        usageLimited: (agentId) => !this.#usageLimits.mayDrain(agentId) && this.#waitsForLimit(agentId),
        routineThread: (agentId, routineId, routineName) => this.#tasks.routineThread(agentId, routineId, routineName),
        waitThread: (agentId, taskId) => this.#tasks.waitThread(agentId, taskId),
        queueHold: (agentId, taskId) =>
          taskId === null ? this.#drain.ownChatHold(agentId) : this.#drain.taskHold(agentId, taskId),
        routineDeleted: (agentId, routineId) => {
          const keys = options.agentApiKeys;
          const removeKey = keys ? removeWebhookSecretKey(keys, agentId, routineId) : Effect.void;
          const thread = this.#tasks.threadOfRoutine(agentId, routineId);
          if (thread?.closedAt !== null) return removeKey;
          return this.closeTask({ agentId, taskId: thread.taskId }).pipe(
            Effect.catch((failure) =>
              Effect.sync(() => this.#emitError("routine_thread_archive_failed", failure.cause, agentId)),
            ),
            Effect.andThen(removeKey),
          );
        },
      },
    });
    this.#hostedSites = new HostedSiteCoordinator({
      store,
      conversation: this.#conversation,
      hostedSites,
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      reportFailure: (code, error, agentId) => {
        this.#reportFailure(code, error, agentId);
      },
      isStopping: () => this.#stopping,
      redact: (text) => this.#mcp.redact(text),
    });
    this.#providers = new ProviderRuntime({
      offProviders: options.offProviders ?? [],
      ...(options.providerAccounts ? { accounts: options.providerAccounts } : {}),
      saveProviderUse: (provider, on) =>
        (options.saveProviderUse?.(provider, on) ?? Effect.void).pipe(toProviderOperationFailed),
      installedCliProviders: options.installedCliProviders ?? [],
      saveInstalledCliChoice: (provider, installed) =>
        (options.saveInstalledCliChoice?.(provider, installed) ?? Effect.void).pipe(toProviderOperationFailed),
      conversation: this.#conversation,
      hooks: {
        bindClient: (client) => {
          client.on("notification", (notification) => {
            if (
              client.provider === "codex" &&
              (notification.method === "turn/started" || notification.method === "turn/completed")
            ) {
              const threadId = getString(notification.params, "threadId");
              if (threadId && notification.method === "turn/started") this.#codexIdleSessions.busy(threadId, client);
              else if (threadId) this.#codexIdleSessions.idle(threadId, client);
            }
            if (notification.method === "openbot/sessionSettings/updated") {
              const threadId = getString(notification.params, "threadId");
              const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
              if (agentId) this.#emit({ type: "agent-session-settings-changed", agentId });
              return;
            }
            if (isStreamingDelta(notification.method)) {
              if (this.#scope.state._tag === "Closed") return;
              try {
                this.#turn.handleStreamingDelta(notification);
              } catch (error) {
                Effect.runFork(Effect.logError(Cause.die(error)));
              }
              return;
            }
            Effect.runFork(
              this.#turn
                .handleNotification(notification, client)
                .pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
            );
          });
          client.on("request", (request) =>
            Effect.runFork(
              this.#tools.handle(client, request).pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
            ),
          );
        },
        onProvidersReady: () =>
          Effect.gen({ self: this }, function* () {
            yield* this.#tasks.endWorkOfGoneTasks().pipe(
              Effect.tap((agentIds) =>
                Effect.sync(() => {
                  for (const id of agentIds) this.#mailboxSync.emitQueue(id);
                }),
              ),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : reportOriginalFailure(cause, (failure) => this.#emitError("delivery_reconcile_failed", failure)),
              ),
            );
            yield* this.#boot
              .reconcileUnresolvedDeliveries()
              .pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.failCause(cause)
                    : reportOriginalFailure(cause, (failure) => this.#emitError("delivery_reconcile_failed", failure)),
                ),
              );
            yield* this.channels.recover();
            this.#channelRoutines.reconcileAll();
            yield* this.#boot.backfillProviderHistory().pipe(
              Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.void)),
              Effect.andThen(this.#boot.compactThreadEvents()),
              Effect.forkIn(this.#scope),
            );
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                this.#drain.scheduleDrains(this.#store.list().map((agent) => agent.id));
                for (const agentId of this.#mailbox.agentsWithEditHolds()) this.#queue.wakeAfterEditHold(agentId);
              }),
            ),
            toProviderOperationFailed,
          ),
        onProviderLost: (client) => {
          this.#boot.orphanDeliveriesOf(client.provider, (agentId) => this.#providers.runsOnOwnProcess(agentId));
          this.#compaction.clientEnded(client);
          this.#codexIdleSessions.clientStopped(client);
          this.#attention.clearPrompts(client);
          this.#attention.clearBrowserTakeovers(client);
          this.#attention.clearApprovals(client);
          Effect.runFork(
            this.#turn
              .interruptTurnsOf(client, { keepRecoverable: true })
              .pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
          );
        },
        onClientStopped: (client) =>
          Effect.gen({ self: this }, function* () {
            this.#attention.clearPrompts(client);
            this.#attention.clearBrowserTakeovers(client);
            this.#attention.clearApprovals(client);
            this.#compaction.clientEnded(client);
            this.#codexIdleSessions.clientStopped(client);
            yield* this.#warmGenerations.ownerStopped(client);
            yield* this.#turn.interruptTurnsOf(client);
          }),
        onAgentClientLost: (agentId, client) =>
          Effect.gen({ self: this }, function* () {
            this.#attention.clearPrompts(client);
            this.#attention.clearBrowserTakeovers(client);
            this.#attention.clearApprovals(client);
            this.#boot.orphanDeliveriesOfAgent(agentId);
            this.#compaction.clientEnded(client);
            yield* this.#turn.interruptTurnsOf(client, { keepRecoverable: true });
            const requesters = this.#mailbox
              .unresolvedDeliveries()
              .flatMap(({ delivery }) =>
                delivery.recipientAgentId === agentId && delivery.sender.kind === "agent"
                  ? [delivery.sender.agentId]
                  : [],
              );
            yield* this.#boot.reconcileUnresolvedDeliveries().pipe(
              Effect.catch((failure) =>
                Effect.sync(() => this.#emitError("delivery_reconcile_failed", failure.cause, agentId)),
              ),
              Effect.andThen(
                this.channels
                  .settleAgentDeliveries(agentId)
                  .pipe(
                    Effect.catch((failure) =>
                      Effect.sync(() => this.#emitError("delivery_reconcile_failed", failure.cause, agentId)),
                    ),
                  ),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  this.#drain.scheduleDrain(agentId);
                  for (const requester of new Set(requesters)) this.#drain.scheduleDrain(requester);
                }),
              ),
            );
          }),
        sharedRoot: () => this.#store.sharedRoot,
        isStopping: () => this.#stopping,
        isProviderBusy: (provider) => this.#isProviderBusy(provider),
        releasePersonWaits: (provider) => this.#attention.detachPromptsOf(provider),
        endDroppedTurns: (provider) => this.#endDroppedTurns(provider),
        isProviderBusyApartFrom: (provider, agentId) => this.#isProviderBusyApartFrom(provider, agentId),
        isAgentBusy: (agentId) => this.#runsTurn(agentId),
        isProviderAssigned: (provider) => this.#store.list().some((agent) => providerForAgent(agent) === provider),
        afterIdleCheck: () => this.#deleteReleasedFolders(),
        captureConfigRevision: () => this.#endpoints.committedRevision(),
        endpointsPending: (harness) => this.#endpoints.pending(harness),
        onModelsRelisted: (provider, configRevision) => {
          if (isCustomProviderHarness(provider)) this.#endpoints.clearReleased(provider, configRevision);
        },
        onProviderActivated: (provider, configRevision) =>
          Effect.gen({ self: this }, function* () {
            if (isCustomProviderHarness(provider)) {
              this.#endpoints.clearReleased(provider, configRevision);
              logUnlistedEndpoints(
                provider,
                credentials.customProviders().filter((endpoint) => !this.#endpoints.waits(provider, endpoint.id)),
                this.#providers.listModels(),
              );
            }
            let listConfirmed = true;
            const catalog = requireProviderDriver(provider).catalog;
            if (
              catalog?.partialListAtStart &&
              (catalog.relistAfterStart || this.#endpoints.hasAgentsOffList(provider))
            ) {
              const client = this.#providers.currentClient(provider);
              yield* Effect.sleep(PARTIAL_LIST_RECHECK_MS);
              const fresh = yield* this.#providers.refreshModels();
              listConfirmed = fresh.has(provider) && this.#providers.currentClient(provider) === client;
            }
            yield* this.#endpoints.runExclusive(() =>
              Effect.gen({ self: this }, function* () {
                if (isCustomProviderHarness(provider)) yield* this.#endpoints.moveAgentsToHarness(provider);
                if (!listConfirmed) return;
                yield* catalog?.partialListAtStart
                  ? this.#endpoints.moveAgentsOffModelsUnlistedTwice(provider)
                  : this.#endpoints.moveAgentsOffUnlistedModels(provider);
              }),
            );
          }),
        onAccountModelsListed: (provider, accountId) =>
          requireProviderDriver(provider).catalog?.partialListAtStart
            ? Effect.void
            : this.#endpoints.moveAccountAgentsOffUnlistedModels(provider, accountId),
        onProviderResumed: (provider) => {
          this.#drain.providerResumed(provider);
          this.#drain.scheduleDrains(
            this.#store
              .list()
              .filter((agent) => providerForAgent(agent) === provider)
              .map((agent) => agent.id),
          );
          this.#retryHeldMoves();
          this.#emitProviderQueues(provider);
        },
        onProviderHeld: (provider) => this.#emitProviderQueues(provider),
        onAccountSignedIn: (provider, accountId) => this.#usageLimits.credentialChanged(provider, accountId),
        onAccountsChanged: () => this.#retryHeldMoves(),
        onProvidersUnready: () => this.#refreshHeldAgents(),
      },
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId, context) => this.#emitError(code, error, agentId, context),
      requestTimeoutMs,
      preferredProvider,
      preferredModel,
      clientFactory,
      bundledExecutables,
      credentials: {
        ...credentials,
        ...(options.fitImage ? { fitImage: options.fitImage } : {}),
        ...(credentials.serverEnvironment
          ? {
              agentEnvironment: (inherited, gitConfig) => ({
                ...credentials.serverEnvironment,
                ...credentials.agentEnvironment?.(inherited, gitConfig),
              }),
            }
          : {}),
        history: (provider) => {
          const history = credentials.history
            ? credentials.history(provider)
            : providerHistoryPersistence(this.#store.database, provider);
          const append = history?.append;
          return append
            ? {
                ...history,
                append: (threadId, fragment) =>
                  this.#conversation.isRoutineSession(threadId) ? Effect.void : append(threadId, fragment),
              }
            : history;
        },
        servesModel: (modelId) => this.#endpoints.serves(modelId, "opencode"),
        codexTurnContext: new TurnContext(),
        mcpServers: (agentId) => this.#mcp.record(this.#mcpServersFor(credentials.mcpServers(), agentId)),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
        mcpEndpoint: (config, agentId) => this.#mcp.endpoint(config, agentId).pipe(toMcpOperationError),
      },
      mcpHandoff: this.#mcp.handoffLog(),
      redactMcp: (text) => this.#mcp.redact(text),
      reportMcpSignIn: (provider, server, signInText) => this.#mcp.reportSignInFailure(provider, server, signInText),
      recordMcpStartFailure: (config) => this.#mcp.recordFailedStart(config),
    });
    this.#endpoints = new CustomEndpoints({
      store,
      mailbox: this.#mailbox,
      conversation: this.#conversation,
      providers: this.#providers,
      hooks: {
        applyAgentUpdate: (input) => this.#applyAgentUpdate(input).pipe(toEndpointChangeFailed),
        queueAgentUpdate: (input) => this.#applyAgentUpdate(input, undefined, null, true).pipe(toEndpointChangeFailed),
        endpointHarness: (endpointId) => {
          const endpoint = credentials.customProviders().find((provider) => provider.id === endpointId);
          return endpoint ? (endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS) : null;
        },
        savedEndpoints: () =>
          new Map(
            credentials.customProviders().map((endpoint) => [
              endpoint.id,
              {
                harness: endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS,
                modelIds: endpoint.models.map((model) => model.id),
              },
            ]),
          ),
        modelsChanged: () => this.#emit({ type: "status", status: this.getStatus() }),
        stopProfileClients: () =>
          this.#profileClients
            .stopEndpointClients()
            .pipe(
              Effect.andThen(this.#warmGenerations.stopIdle("opencode")),
              Effect.andThen(this.#warmGenerations.stopIdle("pi")),
            ),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        removedModelBackup: (agent) => {
          const backup = this.#readyBackup(agent);
          return backup ? this.#moveInput(agent.id, backup, agent.reasoningEffort) : null;
        },
        noteModelRemoved: (agent, removed) => this.#appendModelSwitchMarker(agent, "model-removed", removed, false),
        providerAvailable: (provider) => this.#providerAvailable(provider),
        preference: () => this.#preference(),
      },
    });
    this.#compaction = new ContextCompaction({
      timeoutMs: options.contextCompactionTimeoutMs,
      cacheExpiryDelayMs: options.cacheExpiryCompactionDelayMs,
      cacheExpiryEnabled: options.cacheExpiryCompaction,
      changed: () => this.#emitRuntimeSnapshot(),
      store,
      providers: this.#providers,
      emitError: (code, error, agentId, context) => this.#emitError(code, error, agentId, context),
      scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
      rotateSession: (agentId, client, threadId) => this.#threads.rotateProviderSession(agentId, client, threadId),
      loadSession: (agentId, client, threadId) => this.#threads.loadSessionForCompaction(agentId, client, threadId),
      rotatesSession: (agentId, threadId) => this.#threads.rotatesSession(agentId, threadId),
      isStopping: () => this.#stopping,
      compacted: (threadId) => {
        this.channels.contextCompacted(threadId);
        this.messaging.contextCompacted(threadId);
      },
      compactBeforeCacheExpiry: (agentId, threadId) =>
        Effect.runFork(this.#compactBeforeCacheExpiry(agentId, threadId).pipe(Effect.forkIn(this.#scope))),
    });
    this.#attention = new AttentionRegistry({
      conversation: this.#conversation,
      browser: this.#browser,
      hostedSites: this.#hostedSites,
      routines: this.#routines,
      ...(approvalAutomation === undefined ? {} : { approvalAutomation }),
      workspaceSandboxed: (agentId) => {
        const agent = store.get(agentId);
        return agent !== undefined && workspaceAccessEnforced(agent);
      },
      confinedWritesAllowed: (agentId, paths) => {
        const agent = store.get(agentId);
        return agent !== undefined && confinedWritesAllowed(agent, store.sharedRoot, paths);
      },
      messagingThread: (threadId) => this.messaging.store.linkForThread(threadId) !== null,
      messagingRequestTurn: (agentId, turnId) => this.#mailbox.answersMessagingRequest(agentId, turnId),
      approvalChatThread: (agentId, threadId) =>
        this.messaging.store.linkForThread(threadId) ? (this.#store.get(agentId)?.threadId ?? threadId) : threadId,
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
      ...(options.passwordVault === undefined ? {} : { passwordVault: options.passwordVault }),
      ...(options.vaultItems === undefined ? {} : { vaultItems: options.vaultItems }),
      linkWallet: options.linkWallet ?? null,
      nearWallet: options.nearWallet ?? null,
      agentName: (agentId) => store.get(agentId)?.name,
      noteVaultChange: (agentId, threadId, turnId, text) => this.#tools.postVaultNote(agentId, threadId, turnId, text),
      apiKeys: options.agentApiKeys ?? null,
      codexSubagentParent: (childThreadId) => this.#turn.codexSubagentParent(childThreadId),
      lateAnswerTarget: (agentId, publicThreadId) => {
        if (store.get(agentId)?.threadId === publicThreadId) return {};
        const taskId = this.#tasks.taskForThread(publicThreadId);
        return taskId && !this.#tasks.isRoutineThreadId(publicThreadId) ? { taskId } : null;
      },
      sendLateAnswer: (agentId, target, text, sender) =>
        Effect.runFork(
          this.#sendUserMessage(
            { agentId, text, ...target },
            sender,
            undefined,
            undefined,
            false,
            false,
            undefined,
            true,
          ).pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("late_answer_failed", failure.cause, agentId))),
            Effect.forkIn(this.#scope, { startImmediately: true }),
          ),
        ),
    });
    this.#duplication = new DuplicationGate({
      store,
      mailbox,
      conversation: this.#conversation,
      memories: this.#memories,
      routines: this.#routines,
      hooks: {
        emit: (event) => this.#emit(event),
        listAgents: () => this.listAgents(),
        deleteAgentData: (agent) => this.#removal.deleteData(agent).pipe(toAgentDuplicationFailed),
        hasAttentionFor: (agentId) => this.#attention.hasAttentionFor(agentId),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
      },
    });
    let userControlTabIds = "";
    let browserPageStates = "";
    let browserPermissions = "[]";
    let browserHttpSignIns = "";
    this.#browser.onChanged((tabs, activeTabId) => {
      this.#attention.cancelTakeoversForMissingTabs(tabs);
      Effect.runFork(this.#browserUploads.retainTabs(tabs).pipe(Effect.forkIn(this.#scope)));
      this.#emit({ type: "browser-changed", tabs, activeTabId });
      const pageStates = tabs.map((tab) => ({
        tabId: tab.id,
        canGoBack: tab.canGoBack === true,
        canGoForward: tab.canGoForward === true,
      }));
      const pageStateKey = JSON.stringify(pageStates);
      if (pageStateKey !== browserPageStates) {
        browserPageStates = pageStateKey;
        this.#emit({ type: "browser-page-state-changed", tabs: pageStates });
      }
      const permissionRequests = browserPermissionRequests(tabs);
      const permissionKey = JSON.stringify(permissionRequests);
      if (permissionKey !== browserPermissions) {
        browserPermissions = permissionKey;
        this.#emit({ type: "browser-permissions-changed", requests: permissionRequests });
      }
      const httpSignIns = browserHttpSignInPrompts(tabs);
      const httpSignInKey = JSON.stringify(httpSignIns);
      if (httpSignInKey !== browserHttpSignIns) {
        browserHttpSignIns = httpSignInKey;
        this.#emit({ type: "browser-http-sign-in-changed", tabs: httpSignIns });
      }
      const held = tabs.filter((tab) => tab.userControl).map((tab) => tab.id);
      if (held.join("\n") === userControlTabIds) return;
      userControlTabIds = held.join("\n");
      this.#emit({ type: "browser-user-control-changed", tabIds: held });
    });
    this.#browser.onDocumentChanged((tabId, documentIds) =>
      Effect.runFork(this.#browserUploads.retainDocuments(tabId, documentIds).pipe(Effect.forkIn(this.#scope))),
    );
    this.#images = new ImageGenRuntime({
      conversation: this.#conversation,
      mailbox,
      hooks: {
        trackItem: (itemId, turnId) => {
          this.#turn.trackItem(itemId, turnId);
        },
      },
    });
    this.#deltas = new DeltaBuffer({
      conversation: this.#conversation,
      database: store.database,
      hooks: { emit: (event) => this.#emit(event) },
    });
    this.#mailboxSync = new MailboxSync({
      database: store.database,
      mailbox,
      conversation: this.#conversation,
      routines: this.#routines,
      scope: () => this.#scope,
      hooks: {
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        queueHold: (agentId) =>
          (this.#tasks.oneTurnAtATime(agentId) ? this.channels.queueHold(agentId) : null) ??
          this.#providerRestartHold(agentId) ??
          this.#signInHold(agentId),
        threadRequestsChanged: (agentId) => this.#tasks.changed(agentId),
      },
    });
    this.#reader = new ConversationReader({
      store,
      conversation: this.#conversation,
      mailboxSync: this.#mailboxSync,
      hooks: {
        emit: (event, memberId) => this.#emit(event, memberId),
        listAgents: () => this.listAgents(),
      },
    });
    this.#attachments = new AttachmentGateway({
      conversation: this.#conversation,
      mailbox,
      sharedRoot: store.sharedRoot,
      libraryFolders,
      hooks: {
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      },
    });
    this.#browserUploads = new BrowserUploads({
      browser,
      attachments: this.#attachments,
      isStopping: () => this.#stopping,
      hasTakeover: (agentId, threadId, tabId) => this.#attention.browserTakeoverBlocks(agentId, threadId, tabId),
    });
    this.#threads = new ThreadLifecycle({
      store,
      mailbox,
      conversation: this.#conversation,
      memories: this.#memories,
      compaction: this.#compaction,
      mcpServers: (agentId) => this.#mcpServersFor(this.#mcp.enabled(), agentId),
      mcpToolRuntimes: () => this.#mcp.toolRuntimes(),
      mcpEndpoint: (config, agentId) => this.#mcp.endpoint(config, agentId).pipe(toMcpOperationError),
      mcpProxyFingerprint: (configs) => this.#mcp.proxyFingerprint(configs).pipe(toMcpOperationError),
      mcpProxiedServerIds: (configs) => this.#mcp.proxiedServerIds(configs),
      ...(credentials.agentEnvironment ? { agentEnvironment: credentials.agentEnvironment } : {}),
      passwordVaultConnected: () => options.passwordVault?.connected() ?? false,
      vaultItems: (agentId) => ({
        available: options.vaultItems?.ready() ?? false,
        cards: options.vaultItems?.hasCards(agentId) ?? false,
        contacts: options.vaultItems?.hasContacts(agentId) ?? false,
        link: options.linkWallet?.connected() ?? false,
        near: options.nearWallet?.ready() ?? false,
      }),
      serverHost: hostMemory !== null,
      ...(options.hostedStorageGb ? { hostedStorageGb: options.hostedStorageGb } : {}),
      ...(options.agentCursorDrawn ? { agentCursorDrawn: true } : {}),
      ...(options.computerUseOnWayland ? { computerUseOnWayland: true } : {}),
      ...(options.computerUseInputRefused ? { computerUseInputRefused: options.computerUseInputRefused } : {}),
      ...(options.computerUseForegroundInput ? { computerUseForegroundInput: true } : {}),
      ...(options.responseStyle ? { responseStyle: options.responseStyle } : {}),
      memoryReview: () => this.#memoryReview.running(),
      skillRevision: () => options.skillLearning?.() === "automatic",
      sectionTeammates: (agentId) => this.sectionTeammates(agentId),
      channelThread: (threadId) => this.channels.store.channelForThread(threadId) !== null,
      branchThread: (threadId) => this.#tasks.isBranchThread(threadId),
      importedHistory: (threadId) => store.database.threadHasEvent(threadId, HISTORY_IMPORTED_EVENT),
      routineThread: (threadId) => this.#tasks.isRoutineThreadId(threadId),
      ...(approvalAutomation === undefined
        ? {}
        : { asksFirst: (agentId: string) => !approvalAutomation.autoApproves(agentId) }),
      hooks: {
        logRecovery: (agentId, provider, outcome) =>
          logger.warn("Recovered an unavailable provider session.", { agentId, provider, outcome }),
        logReleaseFailure: (provider, error) =>
          logger.warn("Could not close a replaced provider session.", { provider, error }),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
        logHandoffReadFailure: (provider, error) =>
          logger.warn("Could not read the work steps of an earlier provider session.", { provider, error }),
      },
    });
    this.#codexIdleSessions = new CodexIdleSessions({
      releaseAfterMs: options.codexIdleSessions?.releaseAfterMs ?? CODEX_SESSION_IDLE_RELEASE_MS,
      idleLimit: options.codexIdleSessions?.idleLimit ?? CODEX_IDLE_SESSION_LIMIT,
      scope: () => this.#scope,
      tracks: (threadId, client) =>
        this.#conversation.loadedClientFor(threadId) === client &&
        this.#conversation.agentForThread(threadId) !== undefined &&
        !this.#conversation.isRoutineSession(threadId),
      release: (threadId, client) =>
        this.#threads.releaseIdleSession(
          threadId,
          client,
          (agentId) => this.#stopping || this.#runsTurn(agentId) || this.#attention.hasAttentionFor(agentId),
        ),
    });
    this.#boot = new BootRecovery({
      store,
      mailbox,
      providers: this.#providers,
      conversation: this.#conversation,
      mailboxSync: this.#mailboxSync,
      threads: this.#threads,
      planContinuation: this.#planContinuation,
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        turnFailed: (agentId, turnId) => this.#turn.markFailedTurn(agentId, turnId),
        continuesAfterProviderExit: (agentId, turnId, deliveryIds) =>
          this.#turn.continuesAfterProviderExit(agentId, turnId, deliveryIds),
        quietRoutineDelivery: (deliveryId) => {
          const run = this.#routines.runForDelivery(deliveryId);
          return run === null || quietRoutineRun(run);
        },
        quietRunDelivery: (deliveryId) => this.#routines.quietRunForDelivery(deliveryId),
        retriesAfterRestart: (deliveryId) => this.#routines.retriesAfterRestart(deliveryId),
        isRoutineThread: (threadId) => this.#tasks.isRoutineThreadId(threadId),
        executionThreads: () => [...this.channels.store.executionThreads(), ...this.messaging.store.executionThreads()],
        taskThreads: () => this.#tasks.executionThreads(),
        deliveryThreadId: (deliveryId) => this.#deliveryThreadId(deliveryId),
        deliverySettled: (deliveryId, terminal) => this.messaging.deliverySettled(deliveryId, terminal),
        taskOpen: (taskId) => this.#tasks.threadId(taskId) !== null,
      },
    });
    this.channels = new ChannelService(store.database, mailbox, new ChannelImages(store.channelImagesRoot), {
      agents: () => this.listAgents(),
      generate: (lead, prompt, fallbacks = [], background = false) =>
        Effect.gen({ self: this }, function* () {
          const modelOf = (agent: AgentSummary) =>
            (background
              ? backgroundModel(agent, this.#agentModels(agent))
              : this.#agentModels(agent).find((item) => item.provider === agent.provider && item.id === agent.model)) ??
            undefined;
          const leadStarted = yield* Effect.result(this.#providers.ensureProvider(lead.provider));
          let selected = lead;
          let model = Result.isSuccess(leadStarted) ? modelOf(lead) : undefined;
          for (const fallback of fallbacks) {
            if (model) break;
            if (Result.isFailure(yield* Effect.result(this.#providers.ensureProvider(fallback.provider)))) continue;
            model = modelOf(fallback);
            selected = fallback;
          }
          if (!model) {
            if (Result.isFailure(leadStarted)) return yield* Effect.fail(leadStarted.failure);
            return yield* new ProfileGenerationFailed({
              cause: new Error(sourceText("error.backend.channelLeadModelUnavailable")),
            });
          }
          if (selected !== lead)
            logger.info("A channel used a member's model because the lead's model is unavailable.", {
              leadProvider: lead.provider,
              leadModel: lead.model,
              provider: selected.provider,
              model: selected.model,
            });
          if (model.id !== selected.model)
            logger.info("A channel summary uses the provider's smaller model.", {
              provider: selected.provider,
              model: model.id,
              memberModel: selected.model,
            });
          const turnModel = background
            ? withBackgroundEffort(model)
            : model.id === selected.model
              ? { ...model, defaultReasoningEffort: selected.reasoningEffort }
              : model;
          const client = this.#providers.createProfileClient(selected.provider, selected.providerAccountId);
          if (!background) this.#usageLimits.tryStarted(selected.id);
          let providerError: { causeCode: CauseCode; message: string } | null = null;
          const observe = (notification: AppServerNotification) => {
            const params = notification.params;
            if (notification.method !== "error" || !isRecord(params) || params.willRetry === true) return;
            const error = getRecord(params, "error");
            const message = getString(params, "message") ?? getString(error, "message") ?? "";
            const causeCode = isCauseCode(params.causeCode) ? params.causeCode : classifyFailure(error ?? message);
            providerError = { causeCode, message };
          };
          return yield* this.#profileClients
            .run(client, (cancelled) => generateTextWithoutTools(client, turnModel, prompt, cancelled, observe))
            .pipe(
              Effect.tapError((failure) => {
                const resetsAt =
                  failure instanceof GenerationUsageLimitError
                    ? failure.resetsAt
                    : failure.cause instanceof Error && isPlanLimitDiagnostic(failure.cause.message)
                      ? null
                      : undefined;
                if (resetsAt !== undefined) return this.#usageLimits.reached(selected.id, resetsAt, selected.model);
                const failed: { causeCode: CauseCode; message: string } | null = providerError;
                if (
                  !background &&
                  selected === lead &&
                  failed &&
                  FAILOVER_CAUSES.has(failed.causeCode) &&
                  (this.#usageLimitBackup(lead.id) !== undefined || this.#poolBackup(lead.id))
                ) {
                  logger.info("A provider error stopped a routing turn, so the lead moves to its backup model.", {
                    provider: lead.provider,
                    model: lead.model,
                    cause: failed.causeCode,
                  });
                  const resetDelayMs = providerResetDelayMs(failed.message);
                  const spent = resetDelayMs === null && isBalanceDiagnostic(failed.message);
                  this.#usageLimits.failed(
                    lead.id,
                    lead.model,
                    resetDelayMs,
                    spent,
                    failed.causeCode === "authentication",
                  );
                }
                return Effect.void;
              }),
              Effect.mapError((failure) => {
                const failed: { causeCode: CauseCode; message: string } | null = providerError;
                const shown =
                  background || selected !== lead || !failed ? null : channelLeadFailureText(failed.causeCode);
                return shown &&
                  failure instanceof ProfileGenerationFailed &&
                  failure.cause instanceof Error &&
                  failure.cause.message === sourceText("error.agent.profileFailed")
                  ? new ProfileGenerationFailed({ cause: new Error(shown, { cause: failure.cause }) })
                  : failure;
              }),
            );
        }).pipe(toChannelOperationError),
      schedule: (agentId) => this.#drain.scheduleDrain(agentId),
      settleUnconfirmedStart: (deliveryId) => this.#drain.settleUnconfirmedStart(deliveryId),
      spareGeneration: () => this.#profileClients.hasSpare(),
      awaitDrain: (agentId) => this.#drain.taskFor(agentId)?.pipe(toChannelOperationError),
      contextCharacters: (agentId, threadId) => {
        const agent = this.#store.get(agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        return session ? this.#compaction.contextInputCharacters(session.externalSessionId) : 120_000;
      },
      reportsCompactions: (agentId) => this.#reportsCompactions(agentId),
      quietTurn: (turnId) => this.#turn.quietChannelTurn(turnId),
      channelNote: (turnId, messageId) => this.#turn.channelNote(turnId, messageId),
      provisionalAnswers: (agentId) => {
        const agent = this.#store.get(agentId);
        return (agent ? this.#providers.clientForAgent(agent)?.provisionalAnswers : undefined) === true;
      },
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toChannelOperationError),
      loadedSnapshot: (threadId) => this.#conversation.loadedExecutionSnapshot(threadId),
      channelTurnLimit: (agentId) => this.#drain.channelTurnLimit(agentId),
      busy: (agentId, channelId) =>
        this.#channelHeld(agentId) ||
        this.#drain.channelTurnFull(agentId, channelId) ||
        (this.#tasks.oneTurnAtATime(agentId) &&
          (Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)) ||
            this.#mailbox.laneActive(agentId, null) ||
            this.#conversation.workingTaskSnapshots(agentId).some((snapshot) => snapshot.activeTurnId))),
      usageLimited: (agentId) => this.#channelHeld(agentId),
      retry: (agentId) => this.#usageLimits.retry(agentId),
      skipAtLimit: (task) => this.#channelRoutines.skipAtLimit(task.channelId, task.requestMessageId),
      quietRoutineRequest: (requestMessageId) => this.#channelRoutines.quietRun(requestMessageId),
      usageLimitBackup: (agentId) => this.#usageLimitBackup(agentId) !== undefined || this.#poolBackup(agentId),
      failedOver: (agentId) => {
        const agent = this.#store.get(agentId);
        return (
          agent !== undefined &&
          this.#usageLimits.passesOver(agentId) &&
          (this.#usageLimitBackup(agentId) !== undefined || this.#poolBackup(agentId))
        );
      },
      steersWhenBusy: (agentId) => {
        const agent = this.#store.get(agentId);
        return (
          agent !== undefined &&
          (agent.busyMessageMode ?? this.#busyMessageMode()) === "steer" &&
          agentSteersTurns({ provider: providerForAgent(agent), model: agent.model }, this.#endpoints.available())
        );
      },
      steer: (agentId, threadId, turnId, messageId, text) =>
        Effect.gen({ self: this }, function* () {
          this.#turn.keepChannelTurnAnswers(turnId);
          const agent = this.#store.get(agentId);
          const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
          const client = agent ? this.#providers.clientForAgent(agent) : null;
          if (!agent || !session || !client) return "rejected" as const;
          const releaseQuestions = Effect.sync(() => this.#attention.releaseForUserMessage(agentId, threadId, turnId));
          const steerFirst = providerForAgent(agent) === "claude";
          if (!steerFirst) yield* releaseQuestions;
          return yield* client
            .request(
              "turn/steer",
              {
                threadId: session.externalSessionId,
                expectedTurnId: turnId,
                clientUserMessageId: messageId,
                input: [{ type: "text", text }],
              },
              decodeRecordResponse,
            )
            .pipe(
              Effect.match({
                onSuccess: () => "accepted" as const,
                onFailure: (failure) =>
                  isRequestTimeout(failure.cause, "turn/steer") ? ("uncertain" as const) : ("rejected" as const),
              }),
              Effect.ensuring(steerFirst ? releaseQuestions : Effect.void),
            );
        }),
      releaseQuestions: (agentId, threadId, turnId) => this.#attention.releaseForUserMessage(agentId, threadId, turnId),
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId).pipe(toChannelOperationError),

      changed: (channelId, revision, messagesOnly) => {
        if (!messagesOnly) {
          this.#channelRoutines.reconcile(channelId);
          this.#returnChannelResults(channelId);
          this.#routineTimer.arm();
        }
        this.#emit({ type: "channels-changed", channelId, revision });
      },
      memoriesChanged: (channelId) => this.#emit({ type: "channel-memories-changed", channelId }),
      ...(options.channelPersonAgentLevel ? { personAgentLevel: options.channelPersonAgentLevel } : {}),
      ...(options.channelRemotePerson ? { remotePerson: options.channelRemotePerson } : {}),
      routines: {
        list: (channelId) => this.#channelRoutines.list(channelId),
        create: (input) => this.#channelRoutines.create(input),
        update: (input) => this.#channelRoutines.update(input),
        delete: (input) => this.#channelRoutines.delete(input),
        timezone: options.timezone ?? localTimezone,
      },
      queueHoldChanged: () => {
        for (const agent of this.#store.list())
          if (this.#mailbox.queuedDeliveryIds(agent.id).length) this.#mailboxSync.emitQueue(agent.id);
      },
      memberFoldersChanged: (agentIds) => {
        for (const agentId of agentIds) this.#conversation.unloadAgentThreads(agentId);
      },
      error: (error) => this.#emitError("channel_coordination_failed", error),
      routingFailed: ({ channelId, taskId, lead, error }) =>
        routingLogger.warn("channel_coordination_failed", {
          channelId,
          taskId,
          ...(lead ? { provider: lead.provider, model: lead.model, effort: lead.reasoningEffort } : {}),
          cause: failureMessages(error).map((message) => this.#mcp.redact(message)),
        }),
    });
    this.#channelRequestReturns = new ChannelRequestReturns(this.channels, mailbox, {
      agentExists: (agentId) => this.#store.has(agentId),
      taskOpen: (taskId) => this.#tasks.threadId(taskId) !== null,
      delivered: (recipientAgentId, deliveryIds) =>
        Effect.gen({ self: this }, function* () {
          for (const deliveryId of deliveryIds) yield* this.#steerAgentMessage(recipientAgentId, deliveryId, false);
          this.#mailboxSync.emitQueue(recipientAgentId);
          this.#drain.scheduleDrain(recipientAgentId);
        }),
      error: (error) => this.#emitError("channel_request_return_failed", error),
    });
    this.#channelRoutines = new ChannelRoutineScheduler({
      channels: this.channels,
      hooks: {
        changed: (channelId) => {
          this.#emit({ type: "channel-routines-changed", channelId });
          this.#routineTimer.arm();
        },
        emitError: (code, error) => this.#emitError(code, error),
        excludedChannels: () => new Set(),
        usageLimited: (channelId) => {
          const lead = this.channels.store.get(channelId).leadAgentId;
          return lead !== null && !this.#usageLimits.mayDrain(lead);
        },
      },
    });
    this.routineRecords = new RoutineRecords({
      database: store.database,
      agentRoutines: this.#routines,
      channelRoutines: this.#channelRoutines,
      agentExists: (agentId) => this.listAgents().some((agent) => agent.id === agentId),
      channelExists: (channelId) => this.channels.store.exists(channelId),
      channelRoutinesChanged: (channelId) => this.#emit({ type: "channel-routines-changed", channelId }),
      routinesHeld: () => this.#routineTimer.held,
    });
    this.messaging = new MessagingThreads(store.database, mailbox, {
      schedule: (agentId) => this.#drain.scheduleDrain(agentId),
      queueChanged: (agentId) => this.#mailboxSync.emitQueue(agentId),
      busy: (agentId, linkId) =>
        this.#mailbox.inMessagingLane(agentId, linkId)
          ? this.#mailbox.laneActive(agentId, MESSAGING_LANE) ||
            this.#mailbox.laneQueuedIds(agentId, MESSAGING_LANE).length > 0 ||
            this.#drain.messagingTurnActive(agentId)
          : Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)),
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId).pipe(toMessagingThreadFailed),
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toMessagingThreadFailed),
      ownChat: (threadId) => this.#store.ownsThread(threadId),
      appendSystemMessage: (agentId, sideThreadId, message) =>
        sideThreadId
          ? this.#appendSideThreadSystemMessage(agentId, sideThreadId, message, "messaging.undelivered")
          : this.#appendSystemMessage(agentId, message, "messaging.undelivered"),
      contextSession: (agentId, threadId) => {
        const agent = this.#store.get(agentId);
        if (!agent || !this.#reportsCompactions(agentId)) return null;
        return this.#store.database.activeProviderSession(threadId, agent.provider)?.externalSessionId ?? null;
      },
      progressUpdates: (agentId) =>
        (options.responseStyle?.() ?? DEFAULT_RESPONSE_STYLE) === "natural"
          ? (this.#store.get(agentId)?.provider ?? null)
          : null,
    });
    this.#memoryHold = new MemoryHold({
      memory: hostMemory,
      chosenTurnLimit: () => hostTurnLimits?.turnLimit() ?? null,
      hooks: {
        scheduleAll: () => this.#drain.scheduleDrains(this.#store.list().map((agent) => agent.id)),
        retryWaiting: () => this.#drain.retrySlotWaiters(),
        releaseIdleThreads: () =>
          Effect.sync(() => this.#codexIdleSessions.releaseIdle()).pipe(
            Effect.andThen(this.#providers.releaseIdleThreads()),
          ),
        releaseQuietBackgroundThreads: () => this.#providers.releaseQuietBackgroundThreads(),
        releaseIdleBrowserTabs: () =>
          Effect.suspend(
            () =>
              this.#browser.releaseIdleTabs?.(new Set(this.#store.database.readRunningTurnIds().keys())) ?? Effect.void,
          ),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      },
    });
    this.#usageLimits = new UsageLimitGate({
      store,
      hooks: {
        emit: (event) => this.#emit(event),
        emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        readUsage: (provider, model, accountId) =>
          this.#providers.usage({ provider, model, ...(accountId ? { accountId } : {}) }).pipe(toUsageReadFailed),
        held: (agentIds) =>
          Effect.sync(() => {
            for (const agentId of agentIds) this.#drain.scheduleDrain(agentId);
          }).pipe(
            Effect.andThen(
              this.#settleHeldQueues(
                agentIds.filter(
                  (agentId) =>
                    !this.#usageLimitBackup(agentId, this.#queuedContinuation(agentId)) && !this.#poolBackup(agentId),
                ),
              ),
            ),
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause))),
            Effect.forkIn(this.#scope, { startImmediately: true }),
            Effect.asVoid,
          ),
        released: (limit) =>
          this.channels.wake().pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_release_failed", failure.cause))),
            Effect.andThen(
              Effect.forEach(
                this.#store
                  .list()
                  .filter(
                    (agent) =>
                      agent.usageLimitReturn?.provider === limit.provider &&
                      agent.usageLimitReturn.model === limit.model,
                  ),
                (agent) => Effect.sync(() => this.#drain.scheduleDrain(agent.id)),
                { discard: true },
              ),
            ),
            Effect.andThen(Effect.sync(() => this.#retryHeldMoves())),
            Effect.forkIn(this.#scope, { startImmediately: true }),
            Effect.asVoid,
          ),
      },
    });
    this.#drain = new DrainScheduler({
      channels: this.channels,
      messaging: this.messaging,
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      providers: this.#providers,
      duplication: this.#duplication,
      profileSave: this.#profileSave,
      compaction: this.#compaction,
      routines: this.#routines,
      threads: this.#threads,
      memory: this.#memoryHold,
      usageLimits: this.#usageLimits,
      planContinuation: this.#planContinuation,
      tasks: this.#tasks,
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        redactMcp: (text) => this.#mcp.redact(text),
        tagReferences: (agentId, threadId) => this.#tagReferences(agentId, threadId),
        liveVoiceRelayed: (deliveryId) => this.#liveVoiceRelayed.get(deliveryId) ?? null,
        fromChrome: (deliveryId) => this.#fromChrome.has(deliveryId),
        isStopping: () => this.#stopping,
        isDeleting: (agentId) => this.#removal.deleting().has(agentId),
        servesModel: (model, provider, configRevision) => this.#endpoints.servesClient(model, provider, configRevision),
        requeueChannelDelivery: (deliveryId, continueWork) => this.#requeueChannelDelivery(deliveryId, continueWork),
        mayContinueOnBackup: (agentId) => this.#mayContinueStoppedWork(agentId),
        mayFailOver: (agentId) => this.#mayFailOver(agentId),
        turnEnded: (turnId) => this.#turn.hasEnded(turnId),
        staleTurnSettlement: (agentId, threadId, turnId, channelLaneId) =>
          this.#turnRunsNowhere(agentId, turnId, channelLaneId)
            ? this.#settleStaleTurn(agentId, threadId, turnId, channelLaneId)
            : null,
        orphanedDeliveryRecovery: (agentId) =>
          this.#mayRecoverOrphanedDeliveries(agentId) ? this.#recoverOrphanedDeliveries(agentId) : null,
        turnRestarting: (turnId) => this.#turn.forgetEnded(turnId),
        deliveriesStarting: (deliveryIds, start) => this.#turn.deliveriesStarting(deliveryIds, start),
        startRequestedNewChat: (agentId, queuedRuns) => this.#startRequestedNewChat(agentId, queuedRuns),
        dropRequestedNewChat: (agentId) => {
          if (this.#requestedNewChats.delete(agentId))
            logger.info(`Agent ${agentId} dropped its new chat request: a turn in its chat started first.`);
        },
        followPendingRuntime: (agentId) => this.#startPendingRuntime(agentId),
        pendingRuntimeWaits: (agentId) =>
          Boolean(this.#store.get(agentId)?.pendingRuntime) && this.#runtimeHandoverBusy(agentId),
        settleStaleTaskTurns: (agentId) => this.#settleStaleTaskTurnsOnce(agentId),
        signInWait: (agentId, provider) => this.signInWaits.note(agentId, provider),
        followUsageLimit: (agentId) => {
          if (this.#startPendingRuntime(agentId)) return true;
          if (!this.#usageLimitMove(agentId)) return this.#returnCheckPending(agentId);
          Effect.runFork(
            this.#followUsageLimit(agentId).pipe(
              Effect.tap((moved) =>
                moved || this.#usageLimits.mayDrain(agentId)
                  ? Effect.void
                  : this.#settleHeldQueues([agentId]).pipe(
                      Effect.catch((failure) =>
                        Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause, agentId)),
                      ),
                    ),
              ),
              Effect.tap((moved) =>
                moved
                  ? this.channels
                      .wake()
                      .pipe(
                        Effect.catch((failure) =>
                          Effect.sync(() => this.#emitError("channel_coordination_failed", failure.cause, agentId)),
                        ),
                      )
                  : Effect.void,
              ),
              Effect.andThen((moved) => Effect.sync(() => this.#drain.scheduleDrain(agentId, moved))),
              Effect.forkIn(this.#scope, { startImmediately: true }),
            ),
          );
          return true;
        },
      },
    });
    this.#sessionSettings = new SessionSettings({
      store,
      providers: this.#providers,
      threads: this.#threads,
      drain: this.#drain,
      busy: (agentId) => this.#runsTurn(agentId),
      exclusive: (run) => this.#endpoints.runExclusive(run),
      changed: (agentId) => this.#emit({ type: "agent-session-settings-changed", agentId }),
    });
    this.#liveVoice = new LiveVoice({
      agent: (agentId) => {
        const agent = this.#store.get(agentId);
        if (!agent) throw new Error(sourceText("error.agent.selectedGone"));
        return agent;
      },
      relay: (agent) => this.#liveVoiceRelay(agent),
      send: (agentId, relayed, sender) =>
        this.#sendUserMessage(
          { agentId, text: relayed.shown },
          sender,
          undefined,
          undefined,
          false,
          false,
          relayed,
        ).pipe(
          Effect.flatMap((receipt) => {
            const deliveryId = receipt.deliveries[0]?.id;
            return deliveryId
              ? Effect.succeed(deliveryId)
              : Effect.fail({ cause: new Error(sourceText("error.voice.live.disconnected")) });
          }),
        ),
      reply: (agentId, deliveryId) => this.#liveVoiceReply(agentId, deliveryId),
      busy: (agentId) => this.#drain.ownChatHold(agentId) !== null,
      answer: (agentId, threadId, turnId) =>
        this.#store.get(agentId)?.threadId === threadId ? this.#turnAnswer(agentId, turnId) : null,
      summarize: (agentId, prompt) => this.#liveVoiceSummary(agentId, prompt),
      emit: (event, memberId) => this.emit("liveVoice", event, memberId),
      redact: (text) => this.#mcp.redact(text),
      otherAccounts: (agentId) =>
        this.#providers.otherCodexAccounts(
          this.#liveVoiceAccountId(this.#store.get(agentId)) ?? DEFAULT_PROVIDER_ACCOUNT_ID,
        ),
    });
    this.#browser.onControlChanged((state) => {
      this.#emit({ type: "browser-control-changed", state });
    });
    this.#queue = new QueueControls({
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      providers: this.#providers,
      endpoints: this.#endpoints,
      drain: this.#drain,
      routines: this.#routines,
      hooks: {
        channelAssignment: (deliveryId) => this.channels.store.assignmentForDelivery(deliveryId),
        taskThreadId: (deliveryId) => {
          if (this.#tasks.deliveryTaskGone(deliveryId)) throw new Error(sourceText("error.backend.threadNotFound"));
          return this.#tasks.threadForDelivery(deliveryId);
        },
        tagReferences: (agentId, threadId) => this.#tagReferences(agentId, threadId),
        liveVoiceRelayed: (deliveryId) => this.#liveVoiceRelayed.get(deliveryId) ?? null,
        fromChrome: (deliveryId) => this.#fromChrome.has(deliveryId),
      },
    });
    this.#turn = new TurnLifecycle({
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      providers: this.#providers,
      memories: this.#memories,
      instructions: this.#instructionChanges,
      attention: this.#attention,
      browser,
      compaction: this.#compaction,
      images: this.#images,
      deltas: this.#deltas,
      usageLimits: this.#usageLimits,
      planContinuation: this.#planContinuation,
      hooks: {
        emitFailure: (failure) => this.emit("failure", failure),
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId, context, link) => this.#emitError(code, error, agentId, context, link),
        emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        steerAgentMessage: (recipientAgentId, deliveryId) =>
          this.#steerAgentMessage(recipientAgentId, deliveryId, false).pipe(Effect.asVoid),
        dropRefusedSession: (agentId, externalThreadId) =>
          this.#threads.dropRefusedProviderSession(agentId, externalThreadId),
        listAgents: () => this.listAgents(),
        redactMcp: (text) => this.#mcp.redact(text),
        ...(options.finishCheck === true
          ? { checkFinish: (agentId: string, input: FinishCheckInput) => this.#checkFinish(agentId, input) }
          : {}),
        emitToolUsage: (usage) => this.emit("toolUsage", usage),
        turnModel: (agentId, turnId) => this.#drain.modelForTurn(agentId, turnId),
        mayFailOver: (agentId) => this.#mayFailOver(agentId),
        backupReadyAt: (agentId) => this.#backupReadyAt(agentId),
        backupsAtLimit: (agentId) => this.#backupsAtLimit(agentId),
        poolHasOtherAccount: (agentId) => this.#poolHasOtherAccount(agentId),
        mayContinueOnBackup: (agentId) => this.#mayContinueStoppedWork(agentId),
        requeueChannelDelivery: (deliveryId, continueWork) => this.#requeueChannelDelivery(deliveryId, continueWork),
        keepChannelDelivery: (deliveryId) => this.channels.keepForRetry(deliveryId),
        quietRoutineDelivery: (deliveryId) => this.#routines.quietRunForDelivery(deliveryId),
        closeRoutineSession: (externalThreadId, archive) => this.#threads.closeRoutineThread(externalThreadId, archive),
        conversationTurnEnded: (agentId, sideThreadId, counts, memoryCommitted) =>
          this.#memoryReview.turnEnded(agentId, sideThreadId, counts, memoryCommitted),
        turnStopped: (agentId, taskId, turnId) =>
          this.#stoppedTurn(agentId, taskId) === turnId || (taskId === null && this.#requestedNewChats.has(agentId)),
        hasOpenWait: (agentId, deliveryIds) =>
          this.#waits
            .list(agentId)
            .waits.some(
              (wait) =>
                deliveryIds.includes(wait.requestMessageId) ||
                (wait.wakeDeliveryId !== null && deliveryIds.includes(wait.wakeDeliveryId)),
            ),
        routineAnswered: (agentId, deliveryId, answer) => {
          const agent = this.#store.get(agentId);
          const run = this.#routines.runForDelivery(deliveryId);
          if (!agent || !run) return Effect.void;
          const thread = this.#tasks.threadOfRoutine(agentId, run.routineId);
          const routineThread = thread && thread.taskId === this.#mailbox.taskIdForDelivery(deliveryId) ? thread : null;
          return this.#threads
            .addRoutineDigest(agent, run.routineName, answer, routineThread?.threadId)
            .pipe(
              Effect.catch((failure) =>
                Effect.sync(() => this.#emitError("routine_digest_failed", failure.cause, agentId)),
              ),
            );
        },
        attachAnswerFiles: (agentId, snapshot, answer, paths) =>
          this.#attachments
            .attachAnswerFiles(agentId, snapshot, answer, paths)
            .pipe(
              Effect.catch((failure) =>
                Effect.sync(() => this.#emitError("answer_attachments_failed", failure.cause, agentId)),
              ),
            ),
        taskForThread: (threadId) => this.#tasks.taskForThread(threadId),
        inMessagingLane: (agentId, threadId) => this.messaging.inMessagingLane(agentId, threadId),
        isRoutineThread: (threadId) => this.#tasks.isRoutineThreadId(threadId),
        taskOpen: (taskId) => this.#tasks.threadId(taskId) !== null,
        taskBackgroundLost: (taskId) =>
          Effect.runFork(
            this.#tasks.releaseAfterLostWork(taskId).pipe(Effect.forkIn(this.#scope, { startImmediately: true })),
          ),
        taskReporting: (taskId) => this.#tasks.reporting(taskId),
        taskFailed: (taskId, message) => this.#tasks.failed(taskId, this.#mcp.redact(message)),
      },
    });
    this.#removal = new AgentRemoval({
      store,
      mailbox,
      conversation: this.#conversation,
      browser,
      channels: this.channels,
      messaging: this.messaging,
      routines: this.#routines,
      duplication: this.#duplication,
      drain: this.#drain,
      threads: this.#threads,
      turn: this.#turn,
      hostedSites: this.#hostedSites,
      compaction: this.#compaction,
      apiKeys: options.agentApiKeys ?? null,
      deleteWithRevokedApproval: options.deleteWithRevokedApproval ?? ((_agentId, remove) => remove()),
      logger: createOpenBotLogger("agent-removal"),
      hooks: {
        emit: (event) => this.#emit(event),
        listAgents: () => this.listAgents(),
        deleteTasks: (agentId) =>
          Effect.gen({ self: this }, function* () {
            this.#attention.expireDetached(agentId, null);
            const threadIds = yield* lifecycleStep("list agent tasks", () => this.#tasks.threadIdsForAgent(agentId));
            for (const threadId of threadIds) yield* this.#forgetExecutionThread(threadId);
            yield* lifecycleStep("delete agent tasks", () => this.#tasks.deleteForAgent(agentId));
          }).pipe(Effect.mapError((failure) => new AgentRemovalFailed({ cause: failure.cause }))),
        clearChannelContexts: (agentId) =>
          Effect.gen({ self: this }, function* () {
            const threadIds = yield* lifecycleStep("list agent channel contexts", () =>
              this.channels.store.contextThreadsForAgent(agentId),
            );
            for (const threadId of threadIds) yield* this.#forgetExecutionThread(threadId);
            yield* lifecycleStep("clear agent channel contexts", () => this.channels.store.clearAgentContexts(agentId));
          }).pipe(Effect.mapError((failure) => new AgentRemovalFailed({ cause: failure.cause }))),
        cancelMemoryReview: (agentId) => this.#memoryReview.cancel(agentId),
        stopAgentProcess: (agentId) =>
          Effect.gen({ self: this }, function* () {
            yield* this.#providers
              .stopAgentProcess(agentId)
              .pipe(Effect.mapError((failure) => new AgentRemovalFailed({ cause: failure.cause })));
            if (process.platform !== "win32") return false;
            const providers = yield* Effect.try({
              try: () => this.#sharedProcessesToRelease(agentId),
              catch: (cause) => new AgentRemovalFailed({ cause }),
            });
            return providers.includes("opencode") ? yield* this.#providers.releaseSharedProcess("opencode") : false;
          }),
        releaseFolderHolders: (agentId) =>
          Effect.gen({ self: this }, function* () {
            if (process.platform !== "win32") return false;
            const providers = yield* Effect.try({
              try: () => this.#sharedProcessesToRelease(agentId),
              catch: (cause) => new AgentRemovalFailed({ cause }),
            });
            const folder = this.#store.list().find((agent) => agent.id === agentId)?.workspacePath;
            let kept = false;
            for (const provider of providers) {
              if (provider === "opencode" || provider === "codex") continue;
              const folderKept = folder ? yield* this.#providers.releaseFolderProcesses(provider, folder) : null;
              if (folderKept ?? (yield* this.#providers.releaseSharedProcess(provider))) kept = true;
            }
            return kept;
          }),
        folderHeld: (agentId) => this.#folderHeld(agentId),
        currentClient: (provider) => this.#providers.currentClient(provider),
        usageLimitHolds: (agentId) => !this.#usageLimits.mayDrain(agentId),
        settleModelMoves: () => this.#endpoints.runExclusive(() => Effect.void),
      },
    });
    this.#tools = new OpenBotToolRouter({
      capturedSteps: (session) => this.#threads.capturedWorkSteps(session).pipe(toToolOperationFailed),
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      attention: this.#attention,
      browser,
      browserUploads: this.#browserUploads,
      attachments: this.#attachments,
      channels: this.channels,
      messaging: this.messaging,
      hostedSites: this.#hostedSites,
      routines: this.#routines,
      memories: this.#memories,
      waits: this.#waits,
      tasks: this.#tasks,
      messagePins: this.#messagePins,
      drain: this.#drain,
      tables: this.#tables,
      sidebarLayout: this.#sidebarLayout,
      libraryFolders: this.#libraryFolders,
      ...(this.#localSkillTools === undefined ? {} : { localSkillTools: this.#localSkillTools }),
      ...(this.#routineFlowTools === undefined ? {} : { routineFlowTools: this.#routineFlowTools }),
      ...(this.#workflowTools === undefined ? {} : { workflowTools: this.#workflowTools }),
      ...(options.chosenTimezone === undefined ? {} : { chosenTimezone: options.chosenTimezone }),
      ...(approvalAutomation === undefined ? {} : { approvalAutomation }),
      ...(options.visualPreview === undefined ? {} : { visualPreview: options.visualPreview }),
      ...(options.setCommitCoAuthor === undefined ? {} : { setCommitCoAuthor: options.setCommitCoAuthor }),
      ...(options.screenCapture === undefined ? {} : { screenCapture: options.screenCapture }),
      ...(options.videoReader === undefined ? {} : { videoReader: options.videoReader }),
      ...(options.avatarDecoder === undefined ? {} : { avatarDecoder: options.avatarDecoder }),
      ...(options.fitImage === undefined ? {} : { fitImage: options.fitImage }),
      creditMediaTools: new CreditMediaTools({
        media: () => this.#creditMedia,
        approvalCredits: () => options.mediaApprovalCredits?.().credits ?? DEFAULT_MEDIA_APPROVAL_CREDITS,
        agentsAllowed: () => options.mediaApprovalCredits?.().agents ?? true,
        askWhenBlocked: () => options.mediaApprovalCredits?.().askWhenBlocked ?? true,
        asksMuted: (personIds) => options.creditAsks?.muted(personIds) ?? false,
        enableAgents: () => options.creditAsks?.enableAgents() ?? Effect.void,
        muteAsks: (person) => options.creditAsks?.mute(person) ?? Effect.void,
        defaultModel: (kind) => {
          const setting = options.mediaApprovalCredits?.();
          return (kind === "image" ? setting?.imageModel : setting?.videoModel) ?? CREDIT_MEDIA_PREFERRED_MODELS[kind];
        },
        fitImage: options.fitImage ?? null,
        scope: () => this.#scope,
        report: (report) => this.emit("creditMedia", report),
      }),
      mcpServers: mcpServersFromGateway(
        this.#mcp,
        options.prepareMcpTest,
        (agentId) => {
          const agent = this.#store.get(agentId) ?? { access: "workspace" };
          const saved = new Set(this.#mcp.list().map((config) => config.id));
          return agentFallbackMcpServers(this.enabledMcpServers(agentId), saved, agent);
        },
        (mcpServerId, agentId) => this.#mcpAgentAccess?.(mcpServerId, agentId) ?? true,
      ),
      ...(options.marketplaceAppServer === undefined ? {} : { marketplaceAppServer: options.marketplaceAppServer }),
      githubConnected: () => Boolean(githubConnector?.mcpServer()),
      ...(options.passwordManagerConnected === undefined
        ? {}
        : { passwordManagerConnected: options.passwordManagerConnected }),
      feedbackFacts: options.feedbackFacts ?? null,
      feedback: options.feedback ?? null,
      feedbackWithdrawal: this.#feedbackWithdrawal,
      serverClaims: options.serverClaims ?? null,
      ...(options.browserProfiles === undefined ? {} : { browserProfiles: options.browserProfiles }),
      ...(options.clientBrowser === undefined ? {} : { clientBrowser: options.clientBrowser }),
      fromChrome: (deliveryId) => this.#fromChrome.has(deliveryId),
      ...(options.crm === undefined ? {} : { crm: options.crm }),
      ...(options.crmAgentVisibleToMembers === undefined
        ? {}
        : { crmAgentVisibleToMembers: options.crmAgentVisibleToMembers }),
      ...(options.personCanAdminister === undefined ? {} : { personCanAdminister: options.personCanAdminister }),
      ...(options.mcpServerOwners === undefined ? {} : { mcpServerOwners: options.mcpServerOwners }),
      apiKeys: options.agentApiKeys ?? null,
      vaultItems: options.vaultItems ?? null,
      codexSubagentParent: (childThreadId) => this.#turn.codexSubagentParent(childThreadId),
      hooks: {
        listAgents: () => this.listAgents(),
        listModels: () => this.listModels(),
        refreshStaleModels: (provider) => this.#providers.rereadModels(provider),
        hiddenModels: (provider) => this.#hiddenModels?.(provider),
        agentModels: (choice) => this.#agentModels(choice),
        providerAccounts: (provider) => this.getStatus().providers?.find((row) => row.id === provider)?.accounts,
        providerStatuses: () => this.getStatus().providers ?? [],
        customEndpoints: () =>
          credentials.customProviders().map((endpoint) => {
            const provider = endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
            return {
              id: endpoint.id,
              name: endpoint.name,
              provider,
              loading: this.#endpoints.waits(provider, endpoint.id),
            };
          }),
        preferredProvider: () => this.preferredProvider(),
        createAgent: (input, configure) =>
          this.createAgent(
            input,
            configure
              ? (agent) =>
                  configure(agent).pipe(
                    Effect.mapError(
                      (failure) =>
                        new AgentLifecycleFailed({ operation: "configure tool agent", cause: failure.cause }),
                    ),
                  )
              : undefined,
            undefined,
            undefined,
            false,
            true,
          ).pipe(toToolOperationFailed),
        updateAgent: (input, initiatingAgentId) =>
          this.updateAgent(input, initiatingAgentId).pipe(toToolOperationFailed),
        setAvatar: (agentId, image) => this.setAvatar(agentId, image).pipe(toToolOperationFailed),
        ensureAgentDeletable: (agentId) => this.ensureAgentDeletable(agentId).pipe(toToolOperationFailed),
        deleteAgent: (agentId) => this.#deleteAgentAndPlaces(agentId).pipe(toToolOperationFailed),
        enabledMcpServers: (agentId) => this.enabledMcpServers(agentId),
        computerUseMissingPermissions: () => options.computerUseMissingPermissions?.() ?? [],
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        redactMcp: (text) => this.#mcp.redact(text),
        redactMcpForAgent: (text) => this.#mcp.redactForAgent(text),
        runsTurn: (agentId) => this.#runsTurn(agentId),
        interrupt: (agentId, turnId, mayStop) =>
          this.#interruptTurn(agentId, turnId, undefined, mayStop).pipe(toToolOperationFailed),
        turnActivity: (agentId, turnId) => ({
          startedAt: turnId ? this.#turn.turnStartedAt(turnId) : null,
          lastEventAt: this.#turn.lastEventAt(agentId),
        }),
        turnUnfinished: (turnId) => this.#turn.turnStartedAt(turnId) !== null || this.#turn.isCompleting(turnId),
        startedTask: (turnId) => this.#turn.startedTask(turnId),
        requestNoUpdate: (agentId, threadId, turnId, channelRun) =>
          this.#turn.requestNoUpdate(agentId, threadId, turnId, channelRun),
        reportRoutineFailure: (agentId, turnId, reason, channelRun) =>
          this.#turn.reportRoutineFailure(agentId, turnId, reason, channelRun),
        requestNewChat: (agentId) => {
          this.#requestedNewChats.add(agentId);
        },
        steerAgentMessage: (recipientAgentId, deliveryId) =>
          this.#steerAgentMessage(recipientAgentId, deliveryId, true),
        searchWeb: (agentId, query) => this.#searchWeb(agentId, query),
        providerVersion: (provider) => this.getStatus().providers?.find((row) => row.id === provider)?.version ?? null,
      },
    });
  }

  getStatus(): AgentStatus {
    return this.#providers.status();
  }

  getProviderAccountKind(provider: AgentProvider): { type: string; planType: string | null } | null {
    return this.#providers.accountKind(provider);
  }

  getAnalytics(input: AgentAnalyticsInput) {
    if (!this.listAgents().some((agent) => agent.id === input.agentId))
      throw new Error(sourceText("error.team.agentNotFound"));
    return this.#store.database.usage.read(input);
  }

  getHostAnalytics(input: HostAnalyticsInput) {
    if (
      input.agentId &&
      input.agentId !== WORKFLOWS_USAGE_ID &&
      !this.listAgents().some((agent) => agent.id === input.agentId)
    )
      throw new Error(sourceText("error.team.agentNotFound"));
    return this.#store.database.usage.readHost(input);
  }

  getTurnUsage(agentId: string, turnId: string, since: string) {
    return this.#store.database.usage.readTurn(agentId, turnId, since);
  }

  takeTurnTiming(turnId: string) {
    return this.#turn.takeTurnTiming(turnId);
  }

  readonly getUsage = Effect.fn("AgentService.getUsage")(function* (this: AgentService, agentId?: string) {
    const agent = yield* lifecycleStep("find usage agent", () => {
      if (!agentId) return null;
      const found = this.listAgents().find((candidate) => candidate.id === agentId);
      if (!found) throw new Error(sourceText("error.team.agentNotFound"));
      return found;
    });
    return yield* this.#providers
      .usage(
        agent
          ? {
              provider: agent.provider,
              model: agent.model,
              ...(agent.providerAccountId ? { accountId: agent.providerAccountId } : {}),
            }
          : undefined,
      )
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "get usage", cause: failure.cause })));
  }).bind(this);

  getProviderAccountUsage() {
    return this.#providers.accountUsage();
  }

  listAgents(): AgentSummary[] {
    return this.#duplication.visibleAgents(this.#store.list());
  }

  get sharedRoot(): string {
    return this.#store.sharedRoot;
  }

  agentDefaultsChanged(previous: AgentDefaults): void {
    const defaults = this.#store.agentDefaults();
    for (const agent of this.#store.list()) {
      if (standingProfileChanged(agent, agent, defaults, previous)) this.#conversation.unloadAgentThreads(agent.id);
    }
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
  }

  responseStyleChanged(): void {
    for (const agent of this.#store.list()) this.#conversation.unloadAgentThreads(agent.id);
  }

  skillRevisionChanged(): void {
    for (const agent of this.#store.list()) this.#conversation.unloadAgentThreads(agent.id);
  }

  sectionTeammates(agentId: string): SectionTeammates | null {
    const layout = this.#sidebarLayout?.getSnapshot();
    const section = layout?.sections.find((entry) => entry.id === layout.agentAssignments[agentId]);
    if (!layout || !section || section.name === sourceText("status.messaging.integrationsSection")) return null;
    const rank = (id: string) => {
      const index = layout.agentOrder.indexOf(id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const members = this.listAgents()
      .filter((agent) => agent.id !== agentId && layout.agentAssignments[agent.id] === section.id)
      .sort((a, b) => rank(a.id) - rank(b.id))
      .slice(0, MAX_SECTION_TEAMMATES)
      .map((agent) => ({ id: agent.id, name: agent.name, title: agent.title }));
    return members.length > 0 ? { name: section.name, members } : null;
  }

  sidebarChatIds(): Set<string> {
    const ids = new Set(this.channels.store.ids());
    for (const agent of this.listAgents()) ids.add(agent.id);
    return ids;
  }

  getRuntimeSnapshot(): AgentRuntimeSnapshot {
    return buildRuntimeSnapshot({
      contextStates: this.#compaction.snapshot(),
      threadContextStates: this.#compaction.threadSnapshot(this.#tasks.openExecutionThreads()),
      agents: this.listAgents(),
      conversation: this.#conversation,
      database: this.#store.database,
      mailbox: this.#mailbox,
      turn: this.#turn,
      attention: this.#attention,
      usageLimits: this.#usageLimits,
      waitsForLimit: (agentId) => this.#waitsForLimit(agentId),
    });
  }

  agentIdForRequest(requestId: string | number): string | undefined {
    return this.#attention.agentIdForRequest(requestId);
  }

  pendingApproval(requestId: string | number): AgentApproval | undefined {
    return this.#attention.pendingApproval(requestId);
  }

  pendingMediaApproval(agentId: string, requestId: string | number): MediaApprovalOffer | undefined {
    return this.#attention.pendingMediaApproval(agentId, requestId);
  }

  pendingCreditsHold(agentId: string, requestId: string | number, canEnable: boolean): CreditsHold | undefined {
    return this.#attention.pendingCreditsHold(agentId, requestId, canEnable);
  }

  recheckCreditsHolds(): void {
    this.#attention.recheckCreditsHolds();
  }

  approvalExecutionThreadId(requestId: string | number): string | undefined {
    return this.#attention.approvalExecutionThreadId(requestId);
  }

  pendingPrompts(): AgentRuntimePrompt[] {
    return this.#attention.pendingPrompts();
  }

  getLocalAttention(agentId: string) {
    return this.#attention.localAttention(agentId);
  }

  respondToLocalAttention(agentId: string, input: LocalAttentionResponse): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToLocalAttention(agentId, input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToLocalAttention", cause: failure.cause }),
        ),
      );
  }

  nextRoutineDueAt(): string | null {
    return this.#routineTimer.nextDueAt();
  }

  workingAgents(): AgentSummary[] {
    const working = new Set<string>();
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      if (snapshot.activeTurnId) working.add(agentId);
    }
    return this.listAgents().filter((agent) => working.has(agent.id) || this.#mailbox.hasUnfinishedDelivery(agent.id));
  }

  hasActiveWork(): string[] {
    return this.#activeWork(() => false);
  }

  workBeforeRestart(): string[] {
    return this.#activeWork((agentId) => this.#queueWaitsForLimitReset(agentId));
  }

  #queueWaitsForLimitReset(agentId: string): boolean {
    return !this.#usageLimits.mayDrain(agentId) && !this.#usageLimits.mayTry(agentId) && this.#waitsForLimit(agentId);
  }

  #activeWork(queuedWorkWaits: (agentId: string) => boolean): string[] {
    const reasons: string[] = [];
    const unfinishedDelivery = (agentId: string) =>
      queuedWorkWaits(agentId)
        ? this.#mailbox.hasStartedDelivery(agentId)
        : this.#mailbox.hasUnfinishedDelivery(agentId);
    for (const [, snapshot] of this.#conversation.activeSnapshots()) {
      if (snapshot.activeTurnId && !this.#conversation.isExecutionThread(snapshot.threadId)) {
        reasons.push("agent-turn");
        break;
      }
    }
    const agents = this.listAgents();
    if (!reasons.includes("agent-turn") && agents.some((agent) => this.#mailbox.hasStartedDelivery(agent.id))) {
      reasons.push("agent-turn");
    }
    if (agents.some((agent) => !queuedWorkWaits(agent.id) && this.#mailbox.hasQueuedDelivery(agent.id))) {
      reasons.push("queued-delivery");
    }
    for (const agent of agents) {
      if (
        this.#drain.taskFor(agent.id) &&
        (unfinishedDelivery(agent.id) || this.#conversation.anyWorkingSnapshot(agent.id)?.activeTurnId)
      ) {
        reasons.push("drain-task");
        break;
      }
    }
    if (this.#routines.hasActiveRuns(queuedWorkWaits) || this.#channelRoutines.hasActiveRuns())
      reasons.push("routine-run");
    if (this.channels.hasActiveWork()) reasons.push("channel-work");
    if (this.#providers.activeProcessCount() > 0) reasons.push("provider-process");
    return reasons;
  }

  hasProviderOperation(): boolean {
    return this.#providers.hasPendingOperation();
  }

  instructionsSaving(agentId: string, text: string): (written: boolean) => void {
    return this.#instructionChanges.saving(agentId, text);
  }

  listMemories(agentId: string): AgentMemory[] {
    return this.#memories.list(agentId);
  }

  getMemorySelection(agentId: string): AgentMemorySelectionState {
    return this.#memories.selectionState(agentId);
  }

  setMemoryInclusion(input: SetAgentMemoryInclusionInput): AgentMemorySelectionState {
    return this.#memories.setInclusions(input);
  }

  initializeMemorySelection(agentId: string): void {
    this.#memories.initializeSelection(agentId);
  }

  memoryLimit(): number {
    return this.#memories.limit();
  }

  turnLimitsChanged(): void {
    const agentIds = this.#store.list().map((agent) => agent.id);
    for (const agentId of agentIds) this.#tasks.changed(agentId);
    this.#drain.scheduleDrains(agentIds);
    this.#drain.retrySlotWaiters();
    this.#emit({ type: "host-turn-limits-changed" });
  }

  memoryLimitChanged(): void {
    for (const agent of this.listAgents()) this.#conversation.unloadAgentThreads(agent.id);
  }

  createMemory(input: CreateAgentMemoryInput): AgentMemory {
    return this.#memories.create(input);
  }

  updateMemory(input: UpdateAgentMemoryInput): AgentMemory {
    return this.#memories.update(input);
  }

  deleteMemory(input: DeleteAgentMemoryInput): void {
    this.#memories.delete(input);
  }

  clearMemories(agentId: string): void {
    this.#memories.clear(agentId);
  }

  listTables(): Effect.Effect<SharedTable[], AgentLifecycleFailed> {
    return (
      this.#tables
        ?.listShared()
        .pipe(Effect.mapError((cause) => new AgentLifecycleFailed({ operation: "list tables", cause }))) ??
      Effect.succeed([])
    );
  }

  readonly deleteTable = Effect.fn("AgentService.deleteTable")(function* (
    this: AgentService,
    input: DeleteSharedTableInput,
  ) {
    if (!this.#tables)
      return yield* new AgentLifecycleFailed({
        operation: "delete table",
        cause: new Error(sourceText("error.backend.sharedDataUnavailable")),
      });
    yield* this.#tables
      .removeAsUser(input.name)
      .pipe(Effect.mapError((cause) => new AgentLifecycleFailed({ operation: "delete table", cause })));
  }).bind(this);

  armRoutines(): void {
    this.#routineTimer.arm();
  }

  suspendRoutines(): void {
    this.#routineTimer.suspend();
  }

  resumeRoutines(): void {
    this.#routineTimer.resume();
  }

  holdRoutines(): void {
    this.#routineTimer.hold();
  }

  releaseRoutines(): void {
    this.#routineTimer.release();
  }

  listRoutines(agentId: string): Routine[] {
    return this.#routines.list(agentId);
  }

  createRoutine(input: CreateRoutineInput, options: RoutineMutationOptions = {}): Routine {
    return this.#routines.create(input, options);
  }

  updateRoutine(input: UpdateRoutineInput, options: RoutineMutationOptions = {}): Routine {
    return this.#routines.update(input, options);
  }

  deleteRoutine(
    input: DeleteRoutineInput,
    options: RoutineMutationOptions = {},
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#routines
      .delete(input, options)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteRoutine", cause: failure.cause })),
      );
  }

  testRoutine(input: TestRoutineInput): Effect.Effect<RoutineRun, AgentLifecycleFailed> {
    return this.#routines
      .test(input)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "testRoutine", cause: failure.cause })));
  }

  stopRoutineRun(input: {
    agentId: string;
    routineId: string;
    runId: string;
  }): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#routines
      .stopRun(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "stopRoutineRun", cause: failure.cause })),
      );
  }

  enqueueRoutineHandoff(input: {
    run: Pick<RoutineRun, "id" | "routineId" | "routineName" | "scheduledFor">;
    agentId: string;
    text: string;
    sourcePaths?: readonly string[];
    idempotencyKey: string;
  }): Effect.Effect<string, AgentLifecycleFailed> {
    return this.#routines
      .enqueueHandoff(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "enqueueRoutineHandoff", cause: failure.cause }),
        ),
      );
  }

  readonly runRoutineFromAutomation = Effect.fn("AgentService.runRoutineFromAutomation")(function* (
    this: AgentService,
    input: TestRoutineInput & { payload: string; waitId?: string },
  ) {
    yield* lifecycleStep("validate automation run", () => {
      this.#requireAutomationAllowed(input.agentId);
      if (input.payload.length > INPUT_LIMITS.automationPayload) {
        throw new Error(sourceText("error.agent.automationPayloadTooLong", { limit: INPUT_LIMITS.automationPayload }));
      }
    });
    return yield* this.#routines
      .runWithPayload({ ...input, source: "script" })
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "run routine from automation", cause: failure.cause }),
        ),
      );
  }).bind(this);

  automationRunCommand(input: TestRoutineInput): string {
    this.#requireAutomationAllowed(input.agentId);
    if (!this.#routines.list(input.agentId).some((routine) => routine.id === input.routineId)) {
      throw new Error(sourceText("error.backend.routineGone"));
    }
    return automationRunCommand({
      root: this.#store.automationRoot,
      agentId: input.agentId,
      routineId: input.routineId,
      payload: "",
      platform: process.platform,
    });
  }

  #requireAutomationAllowed(agentId: string): void {
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent || !agentAutomationAllowed(agent, this.#store.agentDefaults()))
      throw new Error(sourceText("error.agent.automationOff"));
  }

  importRoutineRuns(agentId: string, routineId: string, runs: readonly ImportedRoutineRun[]): string[] {
    return this.#routines.importRuns(agentId, routineId, runs);
  }

  importChannelRoutineRuns(channelId: string, routineId: string, runs: readonly ImportedRoutineRun[]): string[] {
    return this.#channelRoutines.importRuns(channelId, routineId, runs);
  }

  listRoutineRuns(input: ListRoutineRunsInput, withSkipped = false): RoutineRun[] {
    return this.#routines.listRuns(input, withSkipped);
  }

  listChannelMemories(channelId: string): ChannelMemory[] {
    return this.channels.listMemories(channelId);
  }

  createChannelMemory(input: CreateChannelMemoryInput): ChannelMemory {
    return this.channels.createMemory(input);
  }

  updateChannelMemory(input: UpdateChannelMemoryInput): ChannelMemory {
    return this.channels.updateMemory(input);
  }

  deleteChannelMemory(input: DeleteChannelMemoryInput): void {
    this.channels.deleteMemory(input);
  }

  clearChannelMemories(channelId: string): void {
    this.channels.clearMemories(channelId);
  }

  listChannelRoutines(channelId: string): ChannelRoutine[] {
    return this.#channelRoutines.list(channelId);
  }

  createChannelRoutine(input: CreateChannelRoutineInput): ChannelRoutine {
    return this.#channelRoutines.create(input);
  }

  updateChannelRoutine(input: UpdateChannelRoutineInput): ChannelRoutine {
    return this.#channelRoutines.update(input);
  }

  deleteChannelRoutine(input: DeleteChannelRoutineInput): void {
    this.#channelRoutines.delete(input);
  }

  testChannelRoutine(input: TestChannelRoutineInput): Effect.Effect<ChannelRoutineRun, AgentLifecycleFailed> {
    return this.#channelRoutines
      .test(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "testChannelRoutine", cause: failure.cause }),
        ),
      );
  }

  listChannelRoutineRuns(input: ListChannelRoutineRunsInput, withSkipped = false): ChannelRoutineRun[] {
    return this.#channelRoutines.listRuns(input, withSkipped);
  }

  listMcpServers(): McpServerConfig[] {
    return this.#mcp.list();
  }

  saveMcpServer(input: SaveMcpServerInput): Effect.Effect<McpServerConfig[], AgentLifecycleFailed> {
    return this.#mcp
      .save(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "saveMcpServer", cause: failure.cause })),
      );
  }

  removeMcpServer(input: RemoveMcpServerInput): Effect.Effect<McpServerConfig[], AgentLifecycleFailed> {
    return this.#mcp
      .remove(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "removeMcpServer", cause: failure.cause })),
      );
  }

  setMcpServerEnabled(input: SetMcpServerEnabledInput): Effect.Effect<McpServerConfig[], AgentLifecycleFailed> {
    return this.#mcp
      .setEnabled(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "setMcpServerEnabled", cause: failure.cause }),
        ),
      );
  }

  refreshAllAgentRuntimes(timing: RuntimeRefreshTiming): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#threads.refreshAllAgentRuntimes(timing);
  }

  testMcpServer(
    input: TestMcpServerInput,
    options: TestMcpServerOptions = {},
  ): Effect.Effect<McpTestResult, AgentLifecycleFailed> {
    return this.#mcp
      .test(input, options)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "testMcpServer", cause: failure.cause })),
      );
  }

  signInMcpServer(
    input: TestMcpServerInput,
    open?: McpSignInOpener,
    deepLinkRedirectUrl?: string,
  ): Effect.Effect<McpTestResult, AgentLifecycleFailed> {
    return this.#mcp
      .signIn(input, open, deepLinkRedirectUrl)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "signInMcpServer", cause: failure.cause })),
      );
  }

  cancelMcpSignIn(input: CancelMcpSignInInput): void {
    this.#mcp.cancelSignIn(input.url);
  }

  mcpSignInLink(input: CancelMcpSignInInput): string | null {
    return this.#mcp.signInLink(input.url);
  }

  receiveMcpSignInAddress(input: CompleteMcpSignInRelayInput): McpSignInAddressOutcome {
    return this.#mcp.receiveSignInAddress(input.url, input.address);
  }

  signOutMcpServer(input: SignOutMcpServerInput): Effect.Effect<McpSignInState[], AgentLifecycleFailed> {
    return this.#mcp
      .signOut(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "signOutMcpServer", cause: failure.cause })),
      );
  }

  listMcpSignIns(): McpSignInState[] {
    return this.#mcp.signIns();
  }

  mcpSignInApp(input: McpSignInAppInput): McpSignInAppState {
    return this.#mcp.signInApp(input);
  }

  saveMcpSignInApp(input: SaveMcpSignInAppInput): Effect.Effect<McpSignInAppState, AgentLifecycleFailed> {
    return this.#mcp
      .saveSignInApp(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "saveMcpSignInApp", cause: failure.cause })),
      );
  }

  removeMcpSignInApp(input: McpSignInAppInput): Effect.Effect<McpSignInAppState, AgentLifecycleFailed> {
    return this.#mcp
      .removeSignInApp(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "removeMcpSignInApp", cause: failure.cause }),
        ),
      );
  }

  enabledMcpServers(agentId?: string | null): McpServerConfig[] {
    return this.#mcpServersFor(this.#mcp.enabled(), agentId);
  }

  #mcpServersFor(configs: readonly McpServerConfig[], agentId: string | null | undefined): McpServerConfig[] {
    const allows = this.#mcpAgentAccess;
    if (agentId === undefined || !allows) return [...configs];
    const saved = new Set(this.#mcp.list().map((server) => server.id));
    return configs.filter((config) => !saved.has(config.id) || allows(config.id, agentId));
  }

  setComputerUseCapability(state: CapabilityState): void {
    this.#providers.setComputerUseCapability(state);
  }

  notifyComputerUseChanged(): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#mcp.changed("now", [COMPUTER_USE_MCP_SERVER_NAME]).pipe(
      Effect.asVoid,
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "refresh computer use", cause: failure.cause }),
      ),
    );
  }

  earliestRunningTurnStartedAt(): number | null {
    return this.#turn.earliestRunningTurnStartedAt();
  }

  readonly notifyGitHubConnectorChanged = Effect.fn("AgentService.notifyGitHubConnectorChanged")(function* (
    this: AgentService,
  ) {
    yield* this.#mcp
      .changed("now", [GITHUB_CONNECTOR_MCP_SERVER_NAME])
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "refresh GitHub tools", cause: failure.cause }),
        ),
      );
    yield* this.#providers.reloadAgentEnvironment();
  }).bind(this);

  notifyAgentsChanged(): void {
    this.#attention.answerGrantedRequests();
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
  }

  notifySkillsChanged(agentId: string): void {
    this.#emit({ type: "skills-changed", agentId });
  }

  notifyRoutineResultsChanged(agentId: string): void {
    this.#emit({ type: "routines-changed", agentId });
  }

  notifyRoutineFlowsChanged(agentId: string): void {
    this.#emit({ type: "routine-flows-changed", agentId });
  }

  notifyCrmChanged(): void {
    this.#emit({ type: "crm-changed" });
  }

  notifyWorkflowsChanged(workflowId: string, agentId?: string): void {
    this.#emit({ type: "workflows-changed", workflowId, ...(agentId === undefined ? {} : { agentId }) });
  }

  notifyVaultChanged(): void {
    this.#emit({ type: "vault-changed" });
  }

  notifyBrowserProfilesChanged(): void {
    this.#emit({ type: "browser-profiles-changed" });
  }

  notifyLibraryFoldersChanged(): void {
    this.#emit({ type: "library-folders-changed" });
  }

  notifyWorkflowFoldersChanged(): void {
    this.#emit({ type: "workflow-folders-changed" });
  }

  notifyWorkflowRunEnded(end: WorkflowRunEnd): void {
    this.emit("workflowRun", end);
  }

  listModels(): AgentModelOption[] {
    return this.#endpoints.available();
  }

  requestModelsRefresh(): void {
    this.#providers.requestModelsRefresh();
  }

  #agentModels(agent: { provider: AgentProvider; providerAccountId?: string | undefined }): AgentModelOption[] {
    const models = this.#endpoints.available();
    const own = this.#providers
      .accountModels(agent.provider, agent.providerAccountId)
      .filter((option) => !models.some((model) => model.provider === option.provider && model.id === option.id));
    return own.length ? [...models, ...own] : models;
  }

  notifyProviderSettingsChanged(): void {
    this.#emit({ type: "status", status: this.getStatus() });
  }

  readonly generateProfile = Effect.fn("AgentService.generateProfile")(
    function* (this: AgentService, input: GenerateAgentProfileInput, sections: SidebarSection[]) {
      const agent = input.agentId ? this.listAgents().find((candidate) => candidate.id === input.agentId) : null;
      if (input.agentId && !agent)
        return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.agent.gone")) });
      if (this.#stopping)
        return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.backend.shuttingDown")) });
      if (this.#profileClients.busy())
        return yield* new ProfileGenerationFailed({
          cause: new Error(sourceText("error.agent.profileGenerationBusy")),
        });
      const provider = agent?.provider ?? this.#startingChoice()?.provider ?? this.#providers.preferredProvider();
      yield* this.#providers.ensureProvider(provider);
      const models = agent ? this.#agentModels(agent) : this.#endpoints.available();
      const model = agent
        ? models.find((candidate) => candidate.id === agent.model && candidate.provider === provider)
        : startingModel(provider, models, this.#preference());
      if (!model) return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.provider.noModel")) });
      if (this.#stopping)
        return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.backend.shuttingDown")) });
      if (this.#profileClients.busy())
        return yield* new ProfileGenerationFailed({
          cause: new Error(sourceText("error.agent.profileGenerationBusy")),
        });
      const client = this.#providers.createProfileClient(provider, agent?.providerAccountId);
      return yield* this.#profileClients.run(client, (cancelled) =>
        generateProfile(client, withBackgroundEffort(model), input, sections, cancelled),
      );
    },
    Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "generate profile", cause: failure.cause })),
  ).bind(this);

  readonly askSideQuestion = Effect.fn("AgentService.askSideQuestion")(
    function* (this: AgentService, input: AskSideQuestionInput) {
      const failed = (message: string) => new ProfileGenerationFailed({ cause: new Error(message) });
      const agent = this.listAgents().find((candidate) => candidate.id === input.agentId);
      if (!agent) return yield* failed(sourceText("error.agent.gone"));
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.agent.sideQuestionBusy"));
      yield* this.#providers.ensureProvider(agent.provider);
      const model = this.#agentModels(agent).find(
        (candidate) => candidate.provider === agent.provider && candidate.id === agent.model,
      );
      if (!model) return yield* failed(sourceText("error.provider.noModel"));
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.agent.sideQuestionBusy"));
      const taskId = input.taskId;
      if (taskId !== undefined && !this.#tasks.has(agent.id, taskId))
        return yield* failed(sourceText("error.backend.threadNotFound"));
      const taskThreadId = taskId === undefined ? undefined : this.#tasks.require(agent.id, taskId).threadId;
      const threadId = taskThreadId ?? agent.threadId;
      const loaded =
        taskThreadId === undefined
          ? this.#conversation.loadedSnapshot(agent.id)
          : this.#conversation.loadedExecutionSnapshot(taskThreadId);
      const messages =
        loaded?.messages ??
        this.#store.database.readConversationPage(agent.id, threadId, { type: "latest" }, SIDE_QUESTION_CHAT_MESSAGES)
          .messages;
      const client = this.#providers.createProfileClient(agent.provider, agent.providerAccountId);
      return yield* this.#profileClients
        .run(client, (cancelled) =>
          generateTextWithoutTools(
            client,
            { ...model, defaultReasoningEffort: agent.reasoningEffort },
            sideQuestionPrompt(agent, messages, input),
            cancelled,
          ),
        )
        .pipe(
          Effect.tapError((failure) =>
            Effect.sync(() =>
              logger.warn("Could not answer a side question.", { provider: agent.provider, error: failure.cause }),
            ),
          ),
          Effect.mapError((failure) =>
            failed(
              failure instanceof GenerationUsageLimitError
                ? sourceText("error.provider.usageLimitReached")
                : sourceText("error.agent.sideQuestionFailed"),
            ),
          ),
        );
    },
    Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "ask side question", cause: failure.cause })),
  ).bind(this);

  readonly #checkFinish = Effect.fn("AgentService.checkFinish")(
    function* (this: AgentService, agentId: string, input: FinishCheckInput) {
      const agent = this.listAgents().find((candidate) => candidate.id === agentId);
      if (!agent || this.#stopping) return null;
      yield* this.#providers.ensureProvider(agent.provider);
      const model = backgroundModel(agent, this.#agentModels(agent));
      if (!model || this.#stopping || !this.#profileClients.hasSpare()) return null;
      const client = yield* Effect.try(() =>
        this.#providers.createProfileClient(agent.provider, agent.providerAccountId),
      );
      const answer = yield* this.#profileClients.run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          withBackgroundEffort(model),
          finishCheckPrompt(input),
          cancelled,
          sideSessionUsageObserver("finish-check", this.#store.database.usage, agent.id, agent.provider, model.id),
        ),
      );
      const json = yield* Effect.try(() => extractJsonObject(answer));
      const result = yield* Schema.decodeUnknownEffect(FinishCheckResult)(json);
      logger.info("A finish check answered.", { agentId, verdict: result.verdict, model: model.id });
      return result;
    },
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        logger.warn("Could not run the finish check of a turn.", { error: Cause.squash(cause) });
        return null;
      }),
    ),
  ).bind(this);

  readonly saveSkillSuggestion = Effect.fn("AgentService.saveSkillSuggestion")(function* (
    this: AgentService,
    input: SaveSkillSuggestionInput,
  ) {
    const agent = this.listAgents().find((candidate) => candidate.id === input.agentId);
    if (!agent || this.#stopping) return { saved: false };
    const saved = yield* this.#memoryReview.saveSuggestion(agent.id, null, input.messageId);
    return { saved };
  }).bind(this);

  readonly #workflowModel = Effect.fn("AgentService.workflowModel")(function* (
    this: AgentService,
    input: WorkflowModelInput,
  ) {
    const starting = this.#startingChoice()?.provider ?? this.#providers.preferredProvider();
    const provider =
      input.provider ??
      (input.model === null
        ? workflowProvider(starting, this.#preference(), this.getStatus().providers ?? [], this.#endpoints.available())
        : starting);
    yield* this.#providers.ensureProvider(provider);
    const models = this.#endpoints.available();
    const model =
      (input.model === null
        ? undefined
        : models.find((candidate) => candidate.provider === provider && candidate.id === input.model)) ??
      startingModel(provider, models, this.#preference());
    if (!model) return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.provider.noModel")) });
    return { provider, model };
  }).bind(this);

  readonly chooseWorkflowModel = Effect.fn("AgentService.chooseWorkflowModel")(
    function* (this: AgentService, input: WorkflowModelInput) {
      if (this.#stopping)
        return yield* new ProfileGenerationFailed({ cause: new Error(sourceText("error.backend.shuttingDown")) });
      const { provider, model } = yield* this.#workflowModel(input);
      return { provider, model: model.id, effort: input.effort ?? model.defaultReasoningEffort };
    },
    Effect.mapError(
      (failure) => new AgentLifecycleFailed({ operation: "choose workflow model", cause: failure.cause }),
    ),
  ).bind(this);

  readonly generateWorkflowText = Effect.fn("AgentService.generateWorkflowText")(
    function* (
      this: AgentService,
      input: WorkflowModelInput & {
        prompt: string;
        images: readonly string[];
        outputSchema?: DynamicRecord;
      },
    ) {
      const failed = (message: string) => new ProfileGenerationFailed({ cause: new Error(message) });
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      const { provider, model } = yield* this.#workflowModel(input);
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      return yield* this.#warmGenerations
        .generate(
          provider,
          { ...model, defaultReasoningEffort: input.effort ?? model.defaultReasoningEffort },
          input.prompt,
          workflowUsageObserver(this.#store.database.usage, provider, model.id),
          input.images,
          input.outputSchema ?? null,
        )
        .pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => logger.warn("Could not answer a workflow step.", { provider, error: failure.cause })),
          ),
          Effect.mapError((failure) =>
            failed(
              failure instanceof GenerationUsageLimitError
                ? sourceText("error.provider.usageLimitReached")
                : workflowGenerationError(failure.cause, provider, (text) => redactText(this.#mcp.redact(text))),
            ),
          ),
        );
    },
    Effect.mapError(
      (failure) => new AgentLifecycleFailed({ operation: "generate workflow text", cause: failure.cause }),
    ),
  ).bind(this);

  #mediaSignIn(provider: WorkflowCatalogProvider) {
    return this.#mcp.serviceSignIn(MEDIA_SERVICE_HOSTS[provider]);
  }

  #mediaServiceAccounts() {
    const perService = Math.floor(WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX / WORKFLOW_CATALOG_PROVIDERS.length);
    return WORKFLOW_CATALOG_PROVIDERS.flatMap((provider) =>
      this.#mcp
        .serviceSignIns(MEDIA_SERVICE_HOSTS[provider])
        .slice(0, perService)
        .map((signIn) => ({
          provider,
          signIn,
          account: {
            provider,
            id: signIn.id,
            name: signIn.name?.slice(0, WORKFLOW_MEDIA_SERVICE_ACCOUNT_NAME_MAX) ?? null,
          },
        })),
    );
  }

  #mediaStepSignIn(provider: WorkflowCatalogProvider, account: string | null) {
    const signIn = this.#mcp.serviceSignIn(MEDIA_SERVICE_HOSTS[provider], account);
    return account !== null && !signIn
      ? Effect.fail(
          new ProfileGenerationFailed({
            cause: new Error(sourceText("error.provider.accountNotFound", { provider: MEDIA_SERVICE_NAMES[provider] })),
          }),
        )
      : Effect.succeed(() => this.#mcp.serviceSignIn(MEDIA_SERVICE_HOSTS[provider], account));
  }

  readonly workflowMediaCatalog = Effect.fn("AgentService.workflowMediaCatalog")(function* (
    this: AgentService,
    only?: WorkflowCatalogSource,
  ) {
    if (this.#stopping) return { models: [] } satisfies WorkflowMediaCatalog;
    const credit =
      this.#creditMedia && (only === undefined || only === "openbot")
        ? this.#creditMedia.catalog()
        : Effect.succeed({ models: [], unavailable: [] } satisfies WorkflowMediaCatalog);
    const services =
      only === "openbot"
        ? Effect.succeed({ models: [] } satisfies WorkflowMediaCatalog)
        : this.#mediaCatalog.catalog(only);
    const [listed, credits] = yield* Effect.all([services, credit], { concurrency: "unbounded" });
    return {
      models: [...credits.models, ...listed.models].slice(0, WORKFLOW_MEDIA_CATALOG_MAX),
      ...(credits.unavailable.length > 0
        ? { unavailable: credits.unavailable.slice(0, WORKFLOW_MEDIA_CATALOG_MAX) }
        : {}),
    } satisfies WorkflowMediaCatalog;
  }).bind(this);

  readonly workflowMediaPrice = Effect.fn("AgentService.workflowMediaPrice")(function* (
    this: AgentService,
    request: WorkflowMediaPriceRequest,
  ) {
    if (this.#stopping) return { credits: null } satisfies WorkflowMediaPrice;
    if (workflowCatalogSource(request.model) === "openbot")
      return {
        credits: this.#creditMedia ? yield* this.#creditMedia.price(request) : null,
      } satisfies WorkflowMediaPrice;
    return yield* this.#mediaCatalog.price(request);
  }).bind(this);

  workflowMediaProviders(): WorkflowMediaProviders {
    return {
      ...workflowMediaProvidersOf(this.#mediaServiceAccounts().map(({ account }) => account)),
      openbot: this.#creditMedia?.available() === true,
    };
  }

  readonly workflowMediaCredits = Effect.fn("AgentService.workflowMediaCredits")(function* (
    this: AgentService,
    only?: WorkflowCatalogSource,
  ) {
    if (this.#stopping) return { sunra: null, higgsfield: null, accounts: null } satisfies WorkflowMediaCredits;
    const openbot =
      this.#creditMedia && (only === undefined || only === "openbot") ? yield* this.#creditMedia.credits() : null;
    if (only === "openbot")
      return { sunra: null, higgsfield: null, accounts: null, openbot } satisfies WorkflowMediaCredits;
    const all = this.#mediaServiceAccounts();
    const accounts = only ? all.filter((account) => account.provider === only).slice(0, 1) : all;
    const orNull = <A>(read: Effect.Effect<A, { readonly message: string }>, service: string) =>
      read.pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not read the media credits.", { service, error: failure.message });
            return null;
          }),
        ),
      );
    const credits = yield* Effect.all(
      accounts.map(({ provider, signIn }) =>
        orNull(provider === "sunra" ? readSunraCredits(signIn) : readHiggsfieldCredits(signIn), provider),
      ),
      { concurrency: "unbounded" },
    );
    const listed = accounts.map(({ account }, index) => ({ ...account, credits: credits[index] ?? null }));
    return {
      ...workflowMediaCreditsOf(listed),
      accounts: only ? null : listed,
      ...(only ? {} : { openbot }),
    } satisfies WorkflowMediaCredits;
  }).bind(this);

  readonly generateWorkflowMedia = Effect.fn("AgentService.generateWorkflowMedia")(
    function* (
      this: AgentService,
      input: {
        jobId: string;
        earlierJobIds: readonly string[];
        kind: GeneratedMediaKind;
        provider: WorkflowMediaProvider;
        model: string;
        catalogId: string;
        account: string | null;
        specs: WorkflowMediaSpecs;
        prompt: string;
        images: readonly { role: MediaImageRole; attachmentId: string }[];
        voice: string | null;
      },
    ) {
      const failed = (message: string) => new ProfileGenerationFailed({ cause: new Error(message) });
      const pictures = input.images.filter(
        (image): image is { role: MediaPictureRole; attachmentId: string } => image.role !== "file",
      );
      if (input.provider === "openbot") {
        if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
        if (!this.#creditMedia) return yield* failed(sourceText("error.billing.mediaSignInRequired"));
        return yield* this.#creditMedia
          .generate(
            {
              resolveAttachment: (attachmentId) => this.#mailbox.resolveAttachment(attachmentId),
              store: (file) => this.#mailbox.storeGeneratedAttachment(file),
            },
            {
              jobId: input.jobId,
              earlierJobIds: input.earlierJobIds,
              kind: input.kind,
              model: input.catalogId,
              prompt: input.prompt,
              specs: input.specs,
              images: pictures,
            },
          )
          .pipe(
            Effect.tapError((failure) =>
              Effect.sync(() => logger.warn("Could not make workflow media with credits.", { error: failure.message })),
            ),
            Effect.mapError((failure) => failed(failure.message)),
          );
      }
      if (input.provider === "sunra") {
        if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
        const signIn = yield* this.#mediaStepSignIn("sunra", input.account);
        const plan = yield* this.#mediaCatalog.sunraPlan(input.catalogId, input.kind);
        return yield* generateSunraMedia(
          {
            signIn,
            resolveAttachment: (attachmentId) => this.#mailbox.resolveAttachment(attachmentId),
            store: (file) => this.#mailbox.storeGeneratedAttachment(file),
          },
          {
            kind: input.kind,
            model: input.model,
            prompt: input.prompt,
            specs: input.specs,
            images: pictures,
            plan,
          },
        ).pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => logger.warn("Could not make workflow media with Sunra.", { error: failure.message })),
          ),
          Effect.mapError((failure) => failed(failure.message)),
        );
      }
      if (input.provider === "higgsfield") {
        if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
        const signIn = yield* this.#mediaStepSignIn("higgsfield", input.account);
        const plan = yield* this.#mediaCatalog.higgsfieldPlan(input.catalogId, input.model, input.kind);
        return yield* generateHiggsfieldMedia(
          {
            signIn,
            resolveAttachment: (attachmentId) => this.#mailbox.resolveAttachment(attachmentId),
            store: (file) => this.#mailbox.storeGeneratedAttachment(file),
          },
          {
            kind: input.kind,
            model: input.model,
            prompt: input.prompt,
            specs: input.specs,
            images: input.images,
            plan,
          },
        ).pipe(
          Effect.tapError((failure) =>
            Effect.sync(() =>
              logger.warn("Could not make workflow media with Higgsfield.", { error: failure.message }),
            ),
          ),
          Effect.mapError((failure) => failed(failure.message)),
        );
      }
      const provider = input.provider;
      const images: { role: MediaPictureRole; path: string }[] = [];
      for (const image of pictures) {
        const file = yield* this.#mailbox
          .resolveAttachment(image.attachmentId)
          .pipe(Effect.mapError(() => failed(sourceText("error.workflow.mediaInputMissing"))));
        if (!file) return yield* failed(sourceText("error.workflow.mediaInputMissing"));
        if (!file.mimeType.startsWith("image/")) return yield* failed(sourceText("error.workflow.mediaInputNotImage"));
        images.push({ role: image.role, path: file.path });
      }
      const prompt = [input.prompt, mediaInputText(provider, input.kind, images, input.voice)]
        .filter(Boolean)
        .join("\n\n");
      const paths = [...new Set(images.map((image) => image.path))];
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      yield* this.#providers.ensureProvider(provider);
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      const models = this.#endpoints.available().filter((model) => model.provider === provider);
      const model =
        models.find((candidate) => candidate.id === agentProviderDescriptor(provider).defaultModel) ??
        startingModel(provider, models, this.#preference());
      if (!model) return yield* failed(sourceText("error.provider.noModel"));
      const effort: AgentReasoningEffort = model.supportedReasoningEfforts.includes("low")
        ? "low"
        : model.defaultReasoningEffort;
      const account = input.account;
      if (
        account &&
        !this.getStatus()
          .providers?.find((row) => row.id === provider)
          ?.accounts?.some((row) => row.id === account)
      )
        return yield* failed(sourceText("error.provider.accountNotFound", { provider: providerLabel(provider) }));
      const client = yield* Effect.try({
        try: () => this.#providers.createMediaClient(provider, account ?? undefined),
        catch: () => failed(sourceText("error.workflow.mediaFailed")),
      });
      const usage = workflowUsageObserver(this.#store.database.usage, provider, model.id);
      const made: { item: ThreadItem | null } = { item: null };
      const observe = (notification: { method: string; params?: unknown }) => {
        usage(notification);
        if (notification.method !== "item/completed") return;
        const record = getRecord(notification.params, "item");
        const type = getString(record, "type");
        if (!record || !type) return;
        const item: ThreadItem = { ...record, type };
        if (generatedMediaKind(item) === input.kind) made.item = item;
      };
      const answer = yield* this.#profileClients
        .run(client, (cancelled) =>
          generateTextWithoutTools(
            client,
            { ...model, defaultReasoningEffort: effort },
            prompt,
            cancelled,
            observe,
            "media",
            paths,
          ),
        )
        .pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => logger.warn("Could not make workflow media.", { provider, error: failure.cause })),
          ),
          Effect.mapError((failure) =>
            failed(
              failure instanceof GenerationUsageLimitError
                ? sourceText("error.provider.usageLimitReached")
                : workflowMediaError(failure.cause, provider),
            ),
          ),
        );
      const item = made.item;
      if (!item) return yield* failed(workflowMediaAnswerError(answer));
      if (imageGenerationUsageLimited(item)) return yield* failed(sourceText("error.provider.usageLimitReached"));
      const failure = imageGenerationFailure(item);
      if (failure) return yield* failed(failure);
      if (item.status === "failed") return yield* failed(workflowMediaAnswerError(answer));
      const savedPath = getString(item, "saved_path");
      const result = input.kind === "image" ? getString(item, "result") : null;
      const clear = this.#clearPictureBackground;
      if (input.specs.transparent && provider === "grok" && clear && (savedPath || result)) {
        const source = savedPath
          ? yield* Effect.tryPromise({ try: () => readFile(savedPath), catch: () => null }).pipe(
              Effect.orElseSucceed(() => null),
            )
          : yield* Effect.try({ try: () => decodeGeneratedImage(result ?? ""), catch: () => null }).pipe(
              Effect.orElseSucceed(() => null),
            );
        const bytes = source
          ? yield* Effect.try({ try: () => clear(source), catch: () => null }).pipe(Effect.orElseSucceed(() => null))
          : null;
        const attachment = bytes
          ? yield* Effect.result(
              this.#mailbox.storeGeneratedAttachment({ bytes, name: "generated-image.png", mimeType: "image/png" }),
            )
          : null;
        if (attachment && Result.isSuccess(attachment)) return attachment.success.id;
        logger.warn("Could not make the background of a Grok image clear.");
      }
      const stored = savedPath
        ? yield* Effect.result(
            this.#mailbox.storeGeneratedAttachment({
              sourcePath: savedPath,
              kind: input.kind,
              name:
                input.kind === "video" ? generatedVideoName(savedPath, input.prompt) : generatedImageName(savedPath),
            }),
          )
        : null;
      if (stored && Result.isSuccess(stored)) return stored.success.id;
      if (!result) return yield* failed(sourceText("error.workflow.mediaFailed"));
      const bytes = yield* Effect.try({
        try: () => decodeGeneratedImage(result),
        catch: () => failed(sourceText("error.workflow.mediaFailed")),
      });
      const attachment = yield* this.#mailbox
        .storeGeneratedAttachment({ bytes, name: "generated-image.png", mimeType: "image/png" })
        .pipe(Effect.mapError(() => failed(sourceText("error.workflow.mediaFailed"))));
      return attachment.id;
    },
    Effect.mapError(
      (failure) => new AgentLifecycleFailed({ operation: "generate workflow media", cause: failure.cause }),
    ),
  ).bind(this);

  saveProfile(
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
    sender?: ConversationMessageSender,
  ): Effect.Effect<SaveAgentProfileResult, AgentLifecycleFailed> {
    return this.#profileSave
      .save(input, sidebar, sender)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "saveProfile", cause: failure.cause })));
  }

  preferredProvider(): AgentProvider {
    return this.#providers.preferredProvider();
  }

  newAgentProvider(input: Pick<CreateAgentInput, "provider" | "model"> = {}): AgentProvider | null {
    return (
      (creationModel(input, this.#endpoints.available(), this.#providers.status().providers) ?? this.#startingChoice())
        ?.provider ?? null
    );
  }

  #reportsCompactions(agentId: string): boolean {
    const agent = this.#store.get(agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    return mode === "native" || mode === "events" || mode === "handoff";
  }

  #preference(): ProviderPreference {
    return { provider: this.#providers.preferredProvider(), model: this.#providers.preferredModel() };
  }

  readonly createAgent = Effect.fn("AgentService.createAgent")(function* (
    this: AgentService,
    input: CreateAgentInput,
    configure?: (agent: AgentSummary) => Effect.Effect<AgentSummary, AgentLifecycleFailed>,
    profileOperationId?: string,
    sender?: ConversationMessageSender,
    welcome = false,
    agentSetup = false,
  ): Effect.fn.Return<AgentSummary, AgentLifecycleFailed> {
    const create = (key?: string) =>
      this.#createAgent(input, configure, profileOperationId, sender, welcome, agentSetup, key);
    if (!input.operationId) return yield* create();
    const key = agentCreateKey(sender, input.operationId);
    this.#mailbox.forgetIdempotencyKeys("agent-create:", new Date(Date.now() - USER_SEND_RETRY_WINDOW_MS));
    const pending = this.#pendingAgentCreates.get(key);
    if (pending) return yield* Deferred.await(pending);
    const createdId = this.#mailbox.receiptForKey(key)?.deliveries[0]?.recipientAgentId;
    const created = createdId ? this.#store.get(createdId) : undefined;
    if (created) return created;
    this.#mailbox.forgetIdempotencyKey(key);
    const start = Deferred.makeUnsafe<AgentSummary, AgentLifecycleFailed>();
    this.#pendingAgentCreates.set(key, start);
    return yield* create(key).pipe(
      Effect.onExit((exit) => Deferred.done(start, exit)),
      Effect.ensuring(Effect.sync(() => this.#pendingAgentCreates.delete(key))),
    );
  }).bind(this);

  readonly #createAgent = Effect.fn("AgentService.createNewAgent")(function* (
    this: AgentService,
    input: CreateAgentInput,
    configure: ((agent: AgentSummary) => Effect.Effect<AgentSummary, AgentLifecycleFailed>) | undefined,
    profileOperationId: string | undefined,
    sender: ConversationMessageSender | undefined,
    welcome: boolean,
    agentSetup: boolean,
    idempotencyKey: string | undefined,
  ) {
    const initialMessage = yield* lifecycleStep("validate initial message", () => {
      const text = input.initialMessage.trim();
      if (!text) throw new Error(sourceText("error.agent.initialMessageRequired"));
      if (input.initialMessage.length > INPUT_LIMITS.messageText)
        throw new Error(sourceText("error.agent.initialMessageTooLong"));
      return text;
    });
    let agent = yield* this.#store
      .createAgent(input, profileOperationId)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "create agent", cause: failure.cause })),
      );
    const result = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        yield* this.#prepareAgentWorkspace(agent);
        agent = yield* this.#assignNewAgentModel(agent, input, true);
        if (configure) agent = yield* configure(agent);
        yield* this.#store
          .ensureThreadId(agent.id)
          .pipe(
            Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "create agent", cause: failure.cause })),
          );
        yield* this.#sendUserMessage(
          { agentId: agent.id, text: initialMessage, attachmentDraftIds: [] },
          sender,
          undefined,
          idempotencyKey,
          welcome,
          agentSetup,
        );
        return this.#store.get(agent.id) ?? agent;
      }).pipe(
        Effect.catchDefect((cause) => Effect.fail(new AgentLifecycleFailed({ operation: "create agent", cause }))),
      ),
    );
    if (Result.isSuccess(result)) return result.success;
    const rollback = yield* Effect.result(this.#removal.deleteData(agent));
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return yield* new AgentLifecycleFailed({
      operation: "create agent",
      cause: Result.isFailure(rollback)
        ? new AggregateError(
            [result.failure.cause, rollback.failure.cause],
            sourceText("error.agent.setupCleanupFailed"),
          )
        : result.failure.cause,
    });
  }, Effect.uninterruptible).bind(this);

  #assignNewAgentModel(
    agent: AgentSummary,
    input: Omit<CreateAgentInput, "initialMessage">,
    needsModel: boolean,
    startOnRunnableProvider = false,
  ) {
    return this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const requested = yield* lifecycleStep("select requested model", () =>
            creationModel(input, this.#endpoints.available(), this.#providers.status().providers),
          );
          if (requested) {
            yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requested.provider));
            const account = agentProviderAccount(input);
            if (account)
              yield* lifecycleStep("check provider account", () => {
                if (!this.#providers.hasProviderAccount(requested.provider, account))
                  throw new Error(
                    sourceText("error.provider.accountNotFound", { provider: providerLabel(requested.provider) }),
                  );
              });
            const development = developmentStartingModel({
              enabled: developmentDefaultsApply(this.#preference(), this.#developmentDefaults),
              models: [requested.model],
              providerAvailable: () => true,
            });
            return yield* this.#store.updateAgent({
              agentId: agent.id,
              provider: requested.provider,
              model: requested.model.id,
              reasoningEffort:
                input.reasoningEffort && requested.model.supportedReasoningEfforts.includes(input.reasoningEffort)
                  ? input.reasoningEffort
                  : (development?.model ?? requested.model).defaultReasoningEffort,
              ...(account ? { providerAccountId: account } : {}),
            });
          }
          const starting = startOnRunnableProvider ? this.#runnableStartingChoice() : this.#startingChoice();
          if (starting) return yield* this.#landOnStartingChoice(agent, starting);
          yield* lifecycleStep("check starting model", () => {
            this.#providers.requireProviderOn(agent.provider);
            if (needsModel)
              throw new Error(
                sourceText("error.agent.noStartingModelInSettings", {
                  provider: providerLabel(this.#preference().provider),
                }),
              );
          });
          return agent;
        }),
      )
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "assignNewAgentModel", cause: failure.cause }),
        ),
      );
  }

  #startingModels(): AgentModelOption[] {
    return this.#endpoints.available().filter((model) => this.#hiddenModels?.(model.provider)?.has(model.id) !== true);
  }

  #startingChoice(): ModelChoice | null {
    return startingChoice(this.#startingModels(), this.#preference(), {
      developmentDefaults: this.#developmentDefaults,
      providerAvailable: (provider) => this.#providerAvailable(provider),
    });
  }

  #runnableStartingChoice(): ModelChoice | null {
    return runnableStartingChoice(this.#startingModels(), this.#preference(), this.getStatus().providers ?? [], {
      developmentDefaults: this.#developmentDefaults,
      providerAvailable: (provider) => this.#providerAvailable(provider),
    });
  }

  readonly #landOnStartingChoice = Effect.fn("AgentService.landOnStartingChoice")(function* (
    this: AgentService,
    agent: AgentSummary,
    starting: ModelChoice,
  ) {
    if (starting.provider === agent.provider && starting.model.id === agent.model) return agent;
    return yield* this.#store
      .updateAgent({
        agentId: agent.id,
        provider: starting.provider,
        model: starting.model.id,
        reasoningEffort: starting.model.defaultReasoningEffort,
      })
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "set starting model", cause: failure.cause }),
        ),
      );
  });

  readonly createAgentProfile = Effect.fn("AgentService.createAgentProfile")(function* (
    this: AgentService,
    input: Omit<CreateAgentInput, "initialMessage"> & { title?: string; startOnRunnableProvider?: boolean },
  ) {
    let agent = yield* this.#store
      .createAgent(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "create agent profile", cause: failure.cause }),
        ),
      );
    const result = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        yield* this.#prepareAgentWorkspace(agent).pipe(
          Effect.mapError(
            (failure) => new AgentLifecycleFailed({ operation: "prepare agent workspace", cause: failure.cause }),
          ),
        );
        agent = yield* this.#assignNewAgentModel(agent, input, false, input.startOnRunnableProvider);
        if (input.title)
          agent = yield* this.#store
            .updateAgent({ agentId: agent.id, title: input.title })
            .pipe(
              Effect.mapError(
                (failure) => new AgentLifecycleFailed({ operation: "set profile title", cause: failure.cause }),
              ),
            );
        this.#emit({ type: "agents-changed", agents: this.listAgents() });
        return agent;
      }).pipe(
        Effect.catchDefect((cause) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "create agent profile", cause })),
        ),
      ),
    );
    if (Result.isSuccess(result)) return result.success;
    yield* this.#removal
      .deleteData(agent)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "rollback agent profile", cause: failure.cause }),
        ),
      );
    return yield* result.failure;
  }, Effect.uninterruptible).bind(this);

  committedAgentDuplication(operationId: string, sourceAgentId: string): DuplicateAgentResult | null {
    return this.#store.committedAgentDuplication(operationId, sourceAgentId);
  }

  duplicateAgent(
    sourceAgentId: string,
    operationId: string = randomUUID(),
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed> {
    return this.#duplication
      .duplicate(sourceAgentId, operationId)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "duplicateAgent", cause: failure.cause })),
      );
  }

  commitAgentDuplication(
    agentId: string,
    layout: SidebarLayoutSnapshot,
  ): Effect.Effect<DuplicateAgentResult, AgentLifecycleFailed> {
    return this.#duplication
      .commit(agentId, layout)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "commitAgentDuplication", cause: failure.cause }),
        ),
      );
  }

  listHiddenAgents(): HiddenAgentsSnapshot {
    return {
      agents: this.listAgents()
        .flatMap((agent) => (agent.hiddenAt === undefined ? [] : [{ agentId: agent.id, hiddenAt: agent.hiddenAt }]))
        .sort(
          (left, right) => left.hiddenAt.localeCompare(right.hiddenAt) || left.agentId.localeCompare(right.agentId),
        ),
    };
  }

  readonly setAgentHidden = Effect.fn("AgentService.setAgentHidden")(function* (
    this: AgentService,
    input: SetAgentHiddenInput,
  ) {
    const changed = yield* lifecycleStep("set agent hidden", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId)) {
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
      }
      if (this.#store.isHidden(input.agentId) === input.hidden) return false;
      this.#store.setHidden(input.agentId, input.hidden ? new Date().toISOString() : null);
      return true;
    });
    const snapshot = this.listHiddenAgents();
    if (!changed) return snapshot;
    this.#emit({ type: "hidden-agents-changed", agents: snapshot.agents });
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return snapshot;
  }).bind(this);

  setMarketplaceSource(agentId: string, source: NonNullable<AgentSummary["marketplaceSource"]>): AgentSummary {
    const agent = this.#store.setMarketplaceSource(agentId, source);
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return agent;
  }

  readAgentSessionSettings(agentId: string): Effect.Effect<AgentSessionSettings, AgentLifecycleFailed> {
    return this.#sessionSettings
      .read(agentId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "read session settings", cause: failure.cause }),
        ),
      );
  }

  setAgentSessionSetting(
    input: SetAgentSessionSettingInput,
  ): Effect.Effect<AgentSessionSettings, AgentLifecycleFailed> {
    return this.#sessionSettings
      .set(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "set session setting", cause: failure.cause }),
        ),
      );
  }

  resetAgentSessionSetting(
    input: ResetAgentSessionSettingInput,
  ): Effect.Effect<AgentSessionSettings, AgentLifecycleFailed> {
    return this.#sessionSettings
      .reset(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "reset session setting", cause: failure.cause }),
        ),
      );
  }

  updateAgent(
    input: AgentUpdate,
    initiatingAgentId?: string,
    queueWhileBusy = true,
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed> {
    return this.#endpoints
      .runExclusive(() => {
        const before = this.#store.get(input.agentId);
        return this.#applyAgentUpdate(this.#withAccountModel(input), initiatingAgentId, null, queueWhileBusy).pipe(
          Effect.tap((agent) => Effect.sync(() => this.#modelChosen(before, agent))),
        );
      })
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "updateAgent", cause: failure.cause })));
  }

  #modelChosen(before: AgentSummary | undefined, after: AgentSummary): void {
    const chosen = (agent: AgentSummary): AgentModelChoice => agent.pendingRuntime ?? agentModelChoice(agent);
    if (before && !sameAgentModelChoice(chosen(before), chosen(after)))
      this.#usageLimits.chosen(after.id, usageLimitOf(chosen(after)));
  }

  #accountPin(
    input: AgentUpdate,
    move: ModelMove | null,
    initiatingAgentId: string | undefined,
    next: AgentModelChoice | undefined,
  ): string | null | undefined {
    if (move !== null || input.leaveUsageLimit) return undefined;
    if (initiatingAgentId === undefined)
      return input.provider !== undefined || input.model !== undefined || input.providerAccountId !== undefined
        ? null
        : undefined;
    if (input.providerAccountId === undefined) return undefined;
    if (!next || !this.#pooled(next)) return null;
    if (next.providerAccountId) return next.providerAccountId;
    return input.providerAccountId === DEFAULT_PROVIDER_ACCOUNT_ID ? DEFAULT_PROVIDER_ACCOUNT_ID : null;
  }

  #withAccountModel(input: AgentUpdate): AgentUpdate {
    if (input.providerAccountId === undefined || input.model !== undefined || input.provider !== undefined)
      return input;
    const agent = this.#store.get(input.agentId);
    const model = agent
      ? this.#modelForAccount({ ...agent, provider: providerForAgent(agent) }, input.providerAccountId ?? undefined)
      : null;
    return model ? { ...input, ...model } : input;
  }

  #modelForAccount(
    choice: AgentModelChoice & { reasoningEffort: AgentReasoningEffort },
    accountId: string | undefined,
  ): { model: AgentModelId; reasoningEffort: AgentReasoningEffort } | null {
    const lists = (models: AgentModelOption[]) =>
      models.some((model) => model.provider === choice.provider && model.id === choice.model);
    const models = this.#agentModels({ provider: choice.provider, providerAccountId: accountId });
    if (lists(models) || !lists(this.#providers.accountModels(choice.provider, choice.providerAccountId))) return null;
    const model = startingModel(choice.provider, models, this.#preference());
    if (!model) return null;
    return {
      model: model.id,
      reasoningEffort: model.supportedReasoningEfforts.includes(choice.reasoningEffort)
        ? choice.reasoningEffort
        : model.defaultReasoningEffort,
    };
  }

  #applyFieldsNow(
    input: AgentUpdate,
    initiatingAgentId: string | undefined,
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed> {
    return this.#applyAgentUpdate(withoutRuntimeFields(input), initiatingAgentId).pipe(
      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "updateAgent", cause: failure.cause })),
    );
  }

  readonly #settleStaleTaskTurns = Effect.fn("AgentService.settleStaleTaskTurns")(function* (
    this: AgentService,
    agentId: string,
  ) {
    const stale = yield* lifecycleStep("find stale task turns", () =>
      this.#conversation.workingTaskSnapshots(agentId).flatMap(({ activeTurnId: turnId, threadId }) => {
        if (!turnId || !threadId) return [];
        if (this.#turn.turnStartedAt(turnId) !== null || this.#turn.isCompleting(turnId)) return [];
        if (this.#mailbox.findDeliveriesByTurn(agentId, turnId).length > 0) return [];
        const taskId = this.#tasks.taskForThread(threadId) ?? undefined;
        if (this.#mailbox.startingDeliveriesForAgent(agentId, taskId).length > 0) return [];
        return [{ turnId, threadId }];
      }),
    );
    for (const { turnId, threadId } of stale) {
      logger.warn("A task turn that no provider runs held the agent. It ends as interrupted.", { agentId, turnId });
      yield* this.#turn.settleOrphanedTurn(agentId, threadId, turnId, "interrupted");
    }
  });

  #settleStaleTaskTurnsOnce(agentId: string): void {
    if (this.#settlingStaleTaskTurns.has(agentId)) return;
    this.#settlingStaleTaskTurns.add(agentId);
    Effect.runFork(
      this.#settleStaleTaskTurns(agentId).pipe(
        Effect.catch((failure) => Effect.sync(() => this.#emitError("stale_task_settlement_failed", failure, agentId))),
        Effect.ensuring(Effect.sync(() => this.#settlingStaleTaskTurns.delete(agentId))),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  #turnRunsNowhere(agentId: string, turnId: string, channelLaneId?: string): boolean {
    return (
      !this.#stopping &&
      this.#turn.hasEnded(turnId) &&
      this.#turn.turnStartedAt(turnId) === null &&
      !this.#turn.isCompleting(turnId) &&
      this.#mailbox.findDeliveriesByTurn(agentId, turnId).length === 0 &&
      this.#mailbox.startingDeliveriesForAgent(agentId, channelLaneId).length === 0 &&
      this.#turn.workingCodexChildren(agentId, turnId).length === 0
    );
  }

  #mayRecoverOrphanedDeliveries(agentId: string): boolean {
    if (this.#stopping || !this.#boot.hasOrphanedOwnChatDelivery(agentId)) return false;
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    return agent !== undefined && this.#providers.clientFor(providerForAgent(agent)) !== null;
  }

  readonly #recoverOrphanedDeliveries = Effect.fn("AgentService.recoverOrphanedDeliveries")(function* (
    this: AgentService,
    agentId: string,
  ) {
    if (!this.#mayRecoverOrphanedDeliveries(agentId)) return;
    logger.warn("A message that no provider runs held the agent's queue. OpenBot settles it again.", { agentId });
    yield* this.#boot
      .reconcileUnresolvedDeliveries(agentId)
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#emitError("delivery_reconcile_failed", failure.cause, agentId)),
        ),
      );
    if (!this.#boot.hasOrphanedOwnChatDelivery(agentId)) this.#drain.scheduleDrain(agentId);
  });

  readonly #settleStaleTurn = Effect.fn("AgentService.settleStaleTurn")(function* (
    this: AgentService,
    agentId: string,
    threadId: string,
    turnId: string,
    channelLaneId: string | undefined,
  ) {
    if (!this.#turnRunsNowhere(agentId, turnId, channelLaneId)) return;
    logger.warn("A chat turn that no provider runs held the agent's queue. It ends as interrupted.", {
      agentId,
      threadId,
      turnId,
    });
    yield* this.#turn.settleOrphanedTurn(agentId, threadId, turnId, "interrupted");
  });

  readonly #applyAgentUpdate = Effect.fn("AgentService.updateAgent")(function* (
    this: AgentService,
    input: AgentUpdate,
    initiatingAgentId?: string,
    move: ModelMove | null = null,
    queueWhileBusy = false,
  ) {
    const returning = move === "return";
    const failingOver = move === "provider-error";
    const handedOverThreads = (previous: AgentSummary) => [
      ...(previous.threadId ? [previous.threadId] : []),
      ...this.#tasks.threadIdsForAgent(previous.id),
      ...this.channels.store.contextThreadsForAgent(previous.id),
    ];
    const idleRefusal = (previous: AgentSummary) => {
      const hasPendingWork =
        move === null && this.#usageLimits.mayDrain(input.agentId)
          ? this.#mailbox.hasUnfinishedDelivery(input.agentId)
          : this.#mailbox.hasStartedDelivery(input.agentId);
      const activeTurn =
        this.#conversation.anyWorkingSnapshot(input.agentId)?.activeTurnId ??
        (previous.threadId ? this.#store.database.readActiveTurnId(input.agentId, previous.threadId) : null);
      if (this.#conversation.workingTaskSnapshots(input.agentId).length > 0)
        return sourceText("error.agent.waitForTasksBeforeProviderChange");
      if (hasPendingWork || activeTurn) return sourceText("error.agent.waitBeforeProviderChange");
      return null;
    };
    const requireIdle = (previous: AgentSummary) => {
      const refusal = idleRefusal(previous);
      if (refusal !== null) throw new AgentSettingsRefused(refusal);
    };
    if (input.provider !== undefined || input.model !== undefined || input.providerAccountId !== undefined)
      yield* this.#settleStaleTaskTurns(input.agentId);
    const { previous, requestedModel, requestedProvider, previousAccount, requestedAccount } = yield* lifecycleStep(
      "validate agent update",
      () => {
        this.#conversation.requireKnownAgent(input.agentId);
        const previous = this.#store.get(input.agentId);
        const modelProvider = input.provider ?? (previous ? providerForAgent(previous) : undefined);
        const requestedModel = input.model
          ? (this.#endpoints
              .available()
              .find((model) => model.id === input.model && (!modelProvider || model.provider === modelProvider)) ??
            (modelProvider
              ? this.#providers
                  .accountModels(
                    modelProvider,
                    input.providerAccountId !== undefined
                      ? (input.providerAccountId ?? undefined)
                      : previous?.providerAccountId,
                  )
                  .find((model) => model.id === input.model)
              : undefined))
          : undefined;
        if (input.model && !requestedModel) {
          throw modelUnavailableError(
            input.model,
            modelProvider,
            this.#endpoints.available(),
            this.#providers.status().providers ?? [],
          );
        }
        const requestedProvider = input.provider ?? requestedModel?.provider ?? previous?.provider;
        if (input.provider && requestedModel && requestedModel.provider !== input.provider) {
          throw new AgentSettingsRefused(sourceText("error.agent.modelProviderMismatch"));
        }
        const confinedProvider = requestedProvider ?? (previous ? providerForAgent(previous) : undefined);
        const providerMove =
          (move === null || move === "next-turn" || move === "pool") &&
          previous !== undefined &&
          confinedProvider !== providerForAgent(previous);
        if (
          (input.access ?? (providerMove ? previous?.access : undefined)) === "workspace" &&
          confinedProvider !== undefined &&
          workspaceOnlyUnavailable(confinedProvider)
        ) {
          throw new AgentSettingsRefused(sourceText("error.agent.workspaceOnlyMacOnly"));
        }
        if (requestedProvider && previous && requestedProvider !== providerForAgent(previous)) {
          if (!input.model || !input.provider) {
            throw new Error("Changing provider requires an atomic provider and model selection.");
          }
          if (!queueWhileBusy) requireIdle(previous);
        }
        const previousAccount = previous ? agentProviderAccount(previous) : null;
        const requestedAccount =
          input.providerAccountId !== undefined
            ? agentProviderAccount({ providerAccountId: input.providerAccountId ?? undefined })
            : previous && requestedProvider !== providerForAgent(previous)
              ? null
              : previousAccount;
        if (
          requestedAccount &&
          input.providerAccountId !== undefined &&
          (!requestedProvider || !this.#providers.hasProviderAccount(requestedProvider, requestedAccount))
        )
          throw new AgentSettingsRefused(
            sourceText("error.provider.accountNotFound", {
              provider: requestedProvider ? providerLabel(requestedProvider) : "",
            }),
          );
        if (previous && requestedAccount !== previousAccount && !queueWhileBusy) requireIdle(previous);
        return { previous, requestedModel, requestedProvider, previousAccount, requestedAccount };
      },
    );
    const accountChanged = previous !== undefined && requestedAccount !== previousAccount;
    const nextModelId = requestedModel?.id ?? previous?.model;
    const customAgentChanged = Boolean(
      previous &&
        requestedProvider === "acp" &&
        providerForAgent(previous) === "acp" &&
        nextModelId !== undefined &&
        customAgentIdOfModel(nextModelId) !== customAgentIdOfModel(previous.model),
    );
    const handoverNeeded = Boolean(
      previous &&
        requestedProvider &&
        (requestedProvider !== providerForAgent(previous) || accountChanged || customAgentChanged),
    );
    const runtimeFields =
      input.provider !== undefined ||
      input.model !== undefined ||
      input.reasoningEffort !== undefined ||
      input.providerAccountId !== undefined;
    const queueable = queueWhileBusy && previous !== undefined && !input.leaveUsageLimit;
    const runtimeOnly = Object.keys(input).every((key) => RUNTIME_UPDATE_KEYS.has(key));
    const providerBound = Object.keys(input).some((key) => PROVIDER_BOUND_UPDATE_KEYS.has(key));
    const pinnedAccountId = this.#accountPin(
      input,
      move,
      initiatingAgentId,
      previous && requestedProvider
        ? {
            provider: requestedProvider,
            model: requestedModel?.id ?? previous.model,
            ...(requestedAccount ? { providerAccountId: requestedAccount } : {}),
          }
        : undefined,
    );
    const pin = pinnedAccountId === undefined ? {} : { pinnedAccountId };
    const queue = (pendingRuntime: AgentPendingRuntime) =>
      this.#store.updateAgent({ agentId: input.agentId, pendingRuntime, ...pin }, initiatingAgentId).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            this.#emit({ type: "agents-changed", agents: this.listAgents() });
            this.#drain.scheduleDrain(input.agentId);
          }),
        ),
      );
    const queuedEffort = (effort: AgentReasoningEffort, model = requestedModel) =>
      model && !model.supportedReasoningEfforts.includes(effort) ? model.defaultReasoningEffort : effort;
    if (
      queueable &&
      !providerBound &&
      previous &&
      requestedProvider &&
      runtimeFields &&
      handoverNeeded &&
      idleRefusal(previous)
    ) {
      yield* this.#providers.ensureProvider(requestedProvider);
      if (input.provider || input.model)
        yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requestedProvider));
      if (!runtimeOnly) yield* this.#applyFieldsNow(input, initiatingAgentId);
      return yield* queue({
        provider: requestedProvider,
        model: requestedModel?.id ?? previous.model,
        reasoningEffort: queuedEffort(
          input.reasoningEffort ?? previous.pendingRuntime?.reasoningEffort ?? previous.reasoningEffort,
        ),
        ...(requestedAccount ? { providerAccountId: requestedAccount } : {}),
      });
    }
    const queued = previous?.pendingRuntime;
    if (
      queueable &&
      runtimeOnly &&
      queued &&
      !handoverNeeded &&
      input.provider === undefined &&
      input.providerAccountId === undefined &&
      (requestedModel ? requestedModel.provider === queued.provider : input.reasoningEffort !== undefined)
    ) {
      const queuedModel =
        requestedModel ??
        this.#agentModels(queued).find((model) => model.provider === queued.provider && model.id === queued.model);
      return yield* queue({
        ...queued,
        ...(requestedModel ? { model: requestedModel.id } : {}),
        reasoningEffort: queuedEffort(input.reasoningEffort ?? queued.reasoningEffort, queuedModel),
      });
    }
    const wasHeld = !this.#usageLimits.mayDrain(input.agentId);
    const captures: Array<readonly [ProviderSession, string]> = [];
    if (handoverNeeded && requestedProvider && previous) {
      yield* this.#providers.ensureProvider(requestedProvider);
      const sessions = yield* lifecycleStep("read provider sessions", () =>
        handedOverThreads(previous).flatMap((threadId) => this.#store.database.listProviderSessions(threadId)),
      );
      for (const session of sessions.filter((one) => one.state === "active")) {
        const steps = yield* this.#threads.readWorkSteps(session);
        if (steps !== null) captures.push([session, steps]);
      }
      yield* lifecycleStep("validate agent update", () => requireIdle(previous));
    }
    if (requestedProvider && (input.provider || input.model))
      yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requestedProvider));
    const previousChoice = previous ? agentModelChoice(previous) : undefined;
    const nextChoice: AgentModelChoice | undefined =
      previous && requestedProvider
        ? {
            provider: requestedProvider,
            model: requestedModel?.id ?? previous.model,
            ...(requestedAccount ? { providerAccountId: requestedAccount } : {}),
          }
        : undefined;
    const moved = previousChoice && nextChoice && !sameAgentModelChoice(previousChoice, nextChoice);
    const leaving = Boolean(moved && input.leaveUsageLimit && (wasHeld || failingOver));
    const spentBalance =
      failingOver && previousChoice !== undefined && this.#usageLimits.isSpent(usageLimitOf(previousChoice));
    const returnTo =
      leaving && previous && previousChoice
        ? (previous.usageLimitReturn ??
          (spentBalance
            ? null
            : {
                ...previousChoice,
                reasoningEffort: previous.reasoningEffort,
                ...(failingOver ? { cause: "provider-error" as const } : {}),
                ...(previous.fastMode ? { fastMode: true } : {}),
                ...(previous.fastMode && previous.ultrafast ? { ultrafast: true } : {}),
              }))
        : move === "pool"
          ? previous?.usageLimitReturn
          : undefined;
    const usageLimitReturn =
      returning || (returnTo && nextChoice && sameAgentModelChoice(returnTo, nextChoice))
        ? null
        : returnTo !== undefined || moved || input.leaveUsageLimit
          ? returnTo
          : this.#returnWithChosenEffort(previous, input.reasoningEffort);
    const agent = yield* this.#store.updateAgent(
      {
        ...input,
        ...(requestedModel && !input.provider ? { provider: requestedModel.provider } : {}),
        ...(previous && (accountChanged || input.providerAccountId !== undefined)
          ? { providerAccountId: requestedAccount }
          : {}),
        ...(usageLimitReturn !== undefined ? { usageLimitReturn } : {}),
        ...(runtimeFields && (queueWhileBusy || handoverNeeded) ? { pendingRuntime: null } : {}),
        ...pin,
      },
      initiatingAgentId,
    );
    if (previous && !sameAgentBrowserProfile(agentBrowserProfile(previous), agentBrowserProfile(agent)))
      yield* this.#removal.closeBrowserTabs(agent);
    if (moved && (leaving || returning))
      this.#appendModelSwitchMarker(
        agent,
        leaving
          ? failingOver
            ? "provider-error"
            : "usage-limit"
          : previous?.usageLimitReturn?.cause === "provider-error"
            ? "provider-error-ended"
            : "usage-limit-ended",
        previousChoice,
        leaving && spentBalance,
      );
    const profileChanged = standingProfileChanged(previous, agent, this.#store.agentDefaults());
    const activeSession = this.#store.activeProviderSession(agent.id);
    const providerChanged = handoverNeeded;
    if (previous && providerChanged) {
      for (const threadId of handedOverThreads(previous)) this.#store.database.deactivateProviderSessions(threadId);
      for (const [session, steps] of captures) yield* this.#threads.saveWorkSteps(session, steps);
    } else if (activeSession && (input.model || input.reasoningEffort)) {
      this.#store.database.updateProviderSessionConfig(
        activeSession.id,
        activeSession.threadId,
        agent.model,
        agent.reasoningEffort,
      );
    }
    if (previous?.pendingRuntime && !agent.pendingRuntime) this.#drain.scheduleDrain(agent.id);
    if (profileChanged) this.#conversation.unloadAgentThreads(agent.id);
    if (previous && workspaceAccessEnforced(previous) && !workspaceAccessEnforced(agent))
      this.#attention.answerGrantedRequests();
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    if (
      providerChanged ||
      (previous &&
        agentTaskLimit(previous, this.#defaultTaskLimit()) !== agentTaskLimit(agent, this.#defaultTaskLimit()))
    ) {
      this.#tasks.changed(agent.id);
      this.#drain.scheduleDrain(agent.id);
    }
    const isHeld = !this.#usageLimits.mayDrain(agent.id);
    if (providerChanged || wasHeld !== isHeld) this.#emitRuntimeSnapshot();
    if (wasHeld && !isHeld) {
      this.#drain.scheduleDrain(agent.id);
      yield* this.channels
        .wake()
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#emitError("usage_limit_release_failed", failure.cause, agent.id)),
          ),
        );
    } else if (!wasHeld && isHeld) {
      yield* this.#settleHeldQueues([agent.id]).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause, agent.id)),
        ),
        Effect.forkIn(this.#scope),
      );
    } else if (providerChanged && !isHeld) {
      this.#drain.scheduleDrain(agent.id);
    } else if (isHeld && input.backupModels !== undefined) {
      this.#drain.scheduleDrain(agent.id);
      this.#emitRuntimeSnapshot();
    }
    return agent;
  }, Effect.uninterruptible);

  #usageLimitMove(agentId: string): { input: UpdateAgentInput; move: ModelMove | null } | null {
    const agent = this.#store.get(agentId);
    if (!agent) return null;
    const pooled =
      this.#runsTurn(agentId) ||
      this.#mailbox.hasStartedDelivery(agentId) ||
      !this.#movesInPool(agent) ||
      !this.#hasWaitingWork(agentId)
        ? null
        : this.#poolMove(agent);
    if (pooled)
      return {
        input: {
          agentId,
          provider: pooled.provider,
          model: pooled.model,
          providerAccountId: pooled.providerAccountId ?? null,
        },
        move: "pool",
      };
    if (!agent.usageLimitReturn && !agent.backupModels) return null;
    if (this.#runsTurn(agentId) || this.#mailbox.hasStartedDelivery(agentId)) return null;
    const move = (choice: AgentModelChoice, reasoningEffort = agent.reasoningEffort) =>
      this.#moveInput(agentId, choice, reasoningEffort);
    const returnTo = agent.usageLimitReturn && this.#returnTarget(agent.usageLimitReturn);
    if (returnTo && this.#usageLimitReady(returnTo) && this.#usageLimits.returnConfirmed(usageLimitOf(returnTo)))
      return {
        input: {
          ...move(returnTo, returnTo.reasoningEffort),
          ...(returnTo.fastMode ? { fastMode: true } : {}),
          ...(returnTo.fastMode && returnTo.ultrafast ? { ultrafast: true } : {}),
        },
        move: "return",
      };
    const limited = !this.#usageLimits.mayDrain(agentId);
    if (limited && this.#usageLimits.mayTry(agentId) && this.#modelChoiceReady(agentModelChoice(agent))) return null;
    const failed = !limited && this.#usageLimits.passesOver(agentId);
    if (!limited && !failed) return null;
    if (!this.#hasWaitingWork(agentId)) return null;
    const next = this.#usageLimitBackup(agentId, this.#queuedContinuation(agentId));
    return next ? { input: { ...move(next), leaveUsageLimit: true }, move: failed ? "provider-error" : null } : null;
  }

  #returnWithChosenEffort(
    agent: AgentSummary | undefined,
    effort: AgentReasoningEffort | undefined,
  ): AgentUsageLimitReturn | undefined {
    const returnTo = agent?.usageLimitReturn;
    if (!returnTo || effort === undefined || effort === agent.reasoningEffort) return undefined;
    const model = this.#agentModels(returnTo).find(
      (option) => option.provider === returnTo.provider && option.id === returnTo.model,
    );
    if (model && !model.supportedReasoningEfforts.includes(effort)) return undefined;
    return { ...returnTo, reasoningEffort: effort };
  }

  #returnCheckPending(agentId: string): boolean {
    const returnTo = this.#store.get(agentId)?.usageLimitReturn;
    return returnTo !== undefined && this.#usageLimits.returnPending(usageLimitOf(this.#returnTarget(returnTo)));
  }

  #returnTarget(returnTo: AgentUsageLimitReturn): AgentUsageLimitReturn {
    if (this.#usageLimitReady(returnTo) || !this.#pooled(returnTo)) return returnTo;
    this.#readPoolWhenStale(returnTo.provider);
    const pick = this.#poolPick(returnTo.provider, returnTo.model, null, true);
    if (pick === null) return returnTo;
    const { providerAccountId: _savedAccount, ...choice } = returnTo;
    return pick === DEFAULT_PROVIDER_ACCOUNT_ID ? choice : { ...choice, providerAccountId: pick };
  }

  #hasWaitingWork(agentId: string): boolean {
    return (
      Boolean(this.#mailbox.nextQueued(agentId)) ||
      [...this.#mailbox.queuedTaskIds(agentId), ...this.#mailbox.sideLanes(agentId, true)].some((laneId) =>
        this.#mailbox.nextQueued(agentId, laneId),
      ) ||
      this.channels.ownsWaitingWork(agentId)
    );
  }

  #poolMove(agent: AgentSummary): AgentModelChoice | null {
    const choice = agentModelChoice(agent);
    if (!this.#movesInPool(agent)) return null;
    this.#readPoolWhenStale(choice.provider);
    const current = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const pick = this.#poolPick(choice.provider, choice.model, current);
    if (pick !== null) this.#providers.setPoolInUse(choice.provider, pick);
    if (pick === null || pick === current) return null;
    return {
      provider: choice.provider,
      model: choice.model,
      ...(pick === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: pick }),
    };
  }

  #poolMoveWaits(agentId: string): Effect.Effect<boolean> {
    const agent = this.#store.get(agentId);
    if (!agent || !this.#usageLimits.mayDrain(agentId) || !this.#usageLimitReady(agentModelChoice(agent)))
      return Effect.succeed(false);
    return this.#threads.mainRunsBackgroundWork(agent);
  }

  #mayFailOver(agentId: string): boolean {
    return this.#usageLimitBackup(agentId) !== undefined || this.#poolBackup(agentId);
  }

  #backupReadyAt(agentId: string): number | null {
    const agent = this.#store.get(agentId);
    if (!agent?.backupModels?.automatic || this.#mayFailOver(agentId)) return null;
    const current = agentModelChoice(agent);
    const returnTo = agent.usageLimitReturn;
    return this.#usageLimits.backupWaitEnd(
      (returnTo ? [...agent.backupModels.order, returnTo] : agent.backupModels.order)
        .filter(
          (choice) =>
            !sameAgentModelChoice(choice, current) &&
            this.#modelChoiceReady(choice) &&
            !(workspaceAccessEnforced(agent) && workspaceOnlyUnavailable(choice.provider)),
        )
        .map(usageLimitOf),
    );
  }

  #backupsAtLimit(agentId: string): boolean {
    const agent = this.#store.get(agentId);
    if (!agent?.backupModels?.automatic || this.#mayFailOver(agentId)) return false;
    const current = agentModelChoice(agent);
    const backups = agent.backupModels.order.filter((choice) => !sameAgentModelChoice(choice, current));
    return (
      backups.length > 0 &&
      backups.every((choice) => {
        const limit = usageLimitOf(choice);
        return this.#usageLimits.isLimited(limit) || this.#usageLimits.isFailed(limit);
      })
    );
  }

  #waitsForLimit(agentId: string): boolean {
    return !this.#mayFailOver(agentId);
  }

  #poolBackup(agentId: string): boolean {
    const agent = this.#store.get(agentId);
    if (!agent || !this.#movesInPool(agent)) return false;
    const choice = agentModelChoice(agent);
    const current = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const pick = this.#poolPick(choice.provider, choice.model, current);
    return pick !== null && pick !== current;
  }

  #movesInPool(agent: AgentSummary): boolean {
    return this.#pooled(agentModelChoice(agent)) && !this.#keepsPinnedAccount(agent);
  }

  #keepsPinnedAccount(agent: AgentSummary): boolean {
    const choice = agentModelChoice(agent);
    return (
      agent.pinnedAccountId === (choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) &&
      this.#usageLimitReady(choice)
    );
  }

  #pooled(choice: AgentModelChoice): boolean {
    if (choice.provider === "claude" && choice.providerAccountId === CLAUDE_API_KEY_ACCOUNT_ID) return false;
    return this.#providers.accountPool(choice.provider) !== null;
  }

  #poolPick(provider: AgentProvider, model: string | null, current: string | null, openOnly = false): string | null {
    return pickPoolAccount(this.#readyPoolMembers(provider, model), current, Date.now() / 1000, openOnly);
  }

  #readyPoolMembers(provider: AgentProvider, model: string | null) {
    return this.#providers.poolMembers(provider, model ?? "").filter(
      (member) =>
        model === null ||
        this.#usageLimitReady({
          provider,
          model,
          ...(member.accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: member.accountId }),
        }),
    );
  }

  #poolHasOtherAccount(agentId: string): boolean {
    const agent = this.#store.get(agentId);
    if (!agent) return false;
    const choice = agentModelChoice(agent);
    if (!this.#pooled(choice)) return false;
    const current = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    return this.#readyPoolMembers(choice.provider, choice.model).some((member) => member.accountId !== current);
  }

  #refreshPoolInUse(provider: AgentProvider): void {
    const pool = this.#providers.accountPool(provider);
    if (!pool) return;
    const model = this.#store.list().find((agent) => agentModelChoice(agent).provider === provider)?.model ?? null;
    this.#providers.setPoolInUse(provider, this.#poolPick(provider, model, pool.inUse));
  }

  #readPoolWhenStale(provider: AgentProvider): void {
    const now = Date.now();
    if (this.#poolReading.has(provider) || now - (this.#poolReads.get(provider) ?? 0) < POOL_READ_INTERVAL_MS) return;
    this.#poolReads.set(provider, now);
    this.#poolReading.add(provider);
    Effect.runFork(
      this.#providers.readPoolUsage(provider).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.#poolReading.delete(provider);
            this.#refreshPoolInUse(provider);
            for (const agent of this.#store.list())
              if (agentModelChoice(agent).provider === provider && this.#hasWaitingWork(agent.id))
                this.#drain.scheduleDrain(agent.id);
          }),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  #channelHeld(agentId: string): boolean {
    return !this.#usageLimits.mayDrain(agentId) && !this.#usageLimits.mayTry(agentId);
  }

  #moveInput(agentId: string, choice: AgentModelChoice, reasoningEffort: AgentReasoningEffort): UpdateAgentInput {
    const model = this.#agentModels(choice).find(
      (option) => option.provider === choice.provider && option.id === choice.model,
    );
    return {
      agentId,
      provider: choice.provider,
      model: choice.model,
      providerAccountId: choice.providerAccountId ?? null,
      reasoningEffort:
        model && !model.supportedReasoningEfforts.includes(reasoningEffort)
          ? model.defaultReasoningEffort
          : reasoningEffort,
    };
  }

  #usageLimitBackup(agentId: string, startedWork = false): AgentModelChoice | undefined {
    const agent = this.#store.get(agentId);
    if (!agent?.backupModels || (!agent.backupModels.automatic && !startedWork)) return undefined;
    return this.#readyBackup(agent);
  }

  #readyBackup(agent: AgentSummary): AgentModelChoice | undefined {
    const current = agentModelChoice(agent);
    return agent.backupModels?.order.find(
      (choice) =>
        !sameAgentModelChoice(choice, current) &&
        this.#usageLimitReady(choice) &&
        !(workspaceAccessEnforced(agent) && workspaceOnlyUnavailable(choice.provider)),
    );
  }

  #mayContinueStoppedWork(agentId: string): boolean {
    const returnTo = this.#store.get(agentId)?.usageLimitReturn;
    return (
      Boolean(returnTo && this.#usageLimitReady(this.#returnTarget(returnTo))) ||
      this.#usageLimitBackup(agentId, true) !== undefined ||
      this.#poolBackup(agentId)
    );
  }

  #retryHeldMoves(): void {
    for (const agent of this.#store.list())
      if (
        !this.#usageLimits.mayDrain(agent.id) &&
        this.#hasWaitingWork(agent.id) &&
        (this.#usageLimitBackup(agent.id, this.#queuedContinuation(agent.id)) !== undefined ||
          this.#poolBackup(agent.id))
      )
        this.#drain.scheduleDrain(agent.id);
    this.#refreshHeldAgents();
  }

  #refreshHeldAgents(): void {
    if (this.#usageLimits.limitedAgents().length > 0) this.#emitRuntimeSnapshot();
  }

  #queuedContinuation(agentId: string): boolean {
    return [null, ...this.#mailbox.queuedTaskIds(agentId), ...this.#mailbox.sideLanes(agentId, true)].some(
      (taskId) => this.#mailbox.nextQueued(agentId, taskId)?.resumeAfterUsageLimit !== undefined,
    );
  }

  #usageLimitReady(choice: AgentModelChoice): boolean {
    const limit = usageLimitOf(choice);
    return this.#modelChoiceReady(choice) && !this.#usageLimits.isLimited(limit) && !this.#usageLimits.isFailed(limit);
  }

  #modelChoiceReady(choice: AgentModelChoice): boolean {
    const accountId = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const provider = this.getStatus().providers?.find((status) => status.id === choice.provider);
    const accounts = provider?.accounts;
    return (
      provider !== undefined &&
      provider.off !== true &&
      provider.state === "available" &&
      (accounts === undefined
        ? accountId === DEFAULT_PROVIDER_ACCOUNT_ID
        : accounts.some((account) => account.id === accountId && account.state === "connected")) &&
      this.#agentModels(choice).some((model) => model.provider === choice.provider && model.id === choice.model)
    );
  }

  #runtimeHandoverBusy(agentId: string): boolean {
    const threadId = this.#store.get(agentId)?.threadId;
    return (
      this.#runsTurn(agentId) ||
      this.#mailbox.hasStartedDelivery(agentId) ||
      this.#conversation.workingTaskSnapshots(agentId).length > 0 ||
      (threadId ? this.#store.database.readActiveTurnId(agentId, threadId) !== null : false)
    );
  }

  #pendingRuntimeDue(agentId: string): boolean {
    const agent = this.#store.get(agentId);
    return Boolean(agent?.pendingRuntime) && !this.#runtimeHandoverBusy(agentId);
  }

  #startPendingRuntime(agentId: string): boolean {
    if (!this.#pendingRuntimeDue(agentId)) return false;
    Effect.runFork(
      this.#followPendingRuntime(agentId).pipe(
        Effect.andThen((moved) =>
          Effect.sync(() => this.#drain.scheduleDrain(agentId, moved || !this.#pendingRuntimeDue(agentId))),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
    return true;
  }

  readonly #followPendingRuntime = Effect.fn("AgentService.followPendingRuntime")(function* (
    this: AgentService,
    agentId: string,
  ) {
    return yield* this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const agent = this.#store.get(agentId);
          const pending = agent?.pendingRuntime;
          if (!pending || this.#runtimeHandoverBusy(agentId) || this.#removal.deleting().has(agentId)) return false;
          yield* this.#applyAgentUpdate(
            {
              agentId,
              provider: pending.provider,
              model: pending.model,
              reasoningEffort: pending.reasoningEffort,
              providerAccountId: pending.providerAccountId ?? null,
            },
            undefined,
            "next-turn",
          );
          return true;
        }),
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.gen({ self: this }, function* () {
            this.#emitError("pending_runtime_switch_failed", failure, agentId);
            if (this.#runtimeHandoverBusy(agentId)) return false;
            const agent = this.#store.get(agentId);
            const stalePin =
              agent?.pinnedAccountId !== undefined &&
              agent.pinnedAccountId !== (agent.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID);
            const cleared = yield* Effect.exit(
              this.#store.updateAgent({
                agentId,
                pendingRuntime: null,
                ...(stalePin ? { pinnedAccountId: null } : {}),
              }),
            );
            if (Exit.isSuccess(cleared)) this.#emit({ type: "agents-changed", agents: this.listAgents() });
            return false;
          }),
        ),
      );
  });

  readonly #followUsageLimit = Effect.fn("AgentService.followUsageLimit")(function* (
    this: AgentService,
    agentId: string,
  ) {
    return yield* this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const move = this.#removal.deleting().has(agentId) ? null : this.#usageLimitMove(agentId);
          if (!move) return false;
          if (move.move === "pool" && (yield* this.#poolMoveWaits(agentId))) {
            logger.info("A pool move waits: the agent's Claude session still runs background work.", { agentId });
            return false;
          }
          yield* this.#applyAgentUpdate(move.input, undefined, move.move);
          return true;
        }),
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            this.#emitError("usage_limit_switch_failed", failure, agentId);
            return false;
          }),
        ),
      );
  });

  #appendSystemMessage(agentId: string, message: ConversationMessage, eventType: string): void {
    const database = this.#store.database;
    this.#conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
      snapshot.messages.push(message);
      sortConversationMessages(snapshot.messages);
      snapshot.revision = database.appendConversationMessage({
        agentId,
        threadId,
        activeTurnId: snapshot.activeTurnId,
        message,
        eventType,
      });
      return { result: undefined, snapshot };
    });
  }

  #appendSideThreadSystemMessage(
    agentId: string,
    threadId: string,
    message: ConversationMessage,
    eventType: string,
  ): void {
    const database = this.#store.database;
    this.#conversation.withThreadTransaction(agentId, threadId, ({ threadId: transactionThreadId, snapshot }) => {
      snapshot.messages.push(message);
      sortConversationMessages(snapshot.messages);
      snapshot.revision = database.persistConversationChanges({
        agentId,
        threadId: transactionThreadId,
        activeTurnId: snapshot.activeTurnId,
        changedMessages: [message],
        eventType,
      });
      return { result: undefined, snapshot };
    });
  }

  #appendModelSwitchMarker(
    agent: AgentSummary,
    reason: ModelSwitchReason,
    left: AgentModelChoice | undefined,
    spent: boolean,
  ): void {
    const joined = agentModelChoice(agent);
    const accountOnly = left !== undefined && left.provider === joined.provider && left.model === joined.model;
    const name = (choice: AgentModelChoice, email: boolean) => {
      const model =
        this.#agentModels(choice).find((option) => option.provider === choice.provider && option.id === choice.model)
          ?.name ?? choice.model;
      if (!accountOnly) return model;
      const id = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
      const account = this.getStatus()
        .providers?.find((status) => status.id === choice.provider)
        ?.accounts?.find((candidate) => candidate.id === id);
      const accountName = account?.label || (email ? account?.email : null);
      return accountName ? `${accountName} · ${model}` : model;
    };
    const note = (email: boolean) => {
      const model = name(joined, email);
      if (spent && left)
        return sourceText("status.agent.modelSwitchedForSpentBalance", { previous: name(left, email), model });
      if (reason === "model-removed")
        return sourceText("status.agent.modelSwitchedForRemovedModel", {
          previous: name(left ?? joined, email),
          model,
        });
      return sourceText(MODEL_SWITCH_TEXT[reason], { model });
    };
    const text = note(true);
    try {
      this.channels.noteModelSwitch(agent.id, note(false), MODEL_SWITCH_ITEM_TYPES[reason]);
    } catch (error) {
      this.#emitError("model_switch_marker_failed", error, agent.id);
    }
    const next = this.#mailbox.nextQueued(agent.id);
    const turnId = next && !next.resumeAfterUsageLimit && !next.planContinuation ? next.delivery.id : undefined;
    try {
      this.#appendSystemMessage(
        agent.id,
        {
          id: `model-switch-${randomUUID()}`,
          ...(turnId ? { turnId } : {}),
          author: "system",
          source: "system",
          text,
          createdAt: new Date().toISOString(),
          status: "completed",
          itemType: MODEL_SWITCH_ITEM_TYPES[reason],
        },
        "thread.model-switched",
      );
    } catch (error) {
      this.#emitError("model_switch_marker_failed", error, agent.id);
    }
  }

  readonly setAvatar = Effect.fn("AgentService.setAvatar")(function* (
    this: AgentService,
    agentId: string,
    image: AvatarImageInput | null,
  ) {
    const agent = yield* this.#store
      .setAvatar(agentId, image)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "set avatar", cause: failure.cause })));
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return agent;
  }).bind(this);

  refreshAgentRuntime(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#threads.refreshAgentRuntime(agentId);
  }

  readonly clearAgentContext = Effect.fn("AgentService.clearAgentContext")(function* (
    this: AgentService,
    agentId: string,
    queuedRuns: readonly string[] = [],
  ) {
    yield* this.#drain.endPlanContinuation(agentId, null);
    const threadId = yield* lifecycleStep("clear agent context", () => {
      const agent = this.#conversation.requireKnownAgent(agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(agentId)?.activeTurnId ??
        (agent.threadId ? this.#store.database.readActiveTurnId(agentId, agent.threadId) : null);
      if (
        activeTurn ||
        this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agentId, this.#tasks.oneTurnAtATime(agentId), queuedRuns) ||
        this.#threads.mainContextBusy(agent)
      ) {
        throw new ContextResetBusyError(sourceText("error.agent.waitBeforeClearContext"));
      }
      const database = this.#store.database;
      const threadId = this.#conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
        const last = snapshot.messages.at(-1);
        if (!last || isContextResetMarker(last)) return { result: threadId, snapshot };
        const message: ConversationMessage = {
          id: `context-reset-${randomUUID()}`,
          author: "system",
          source: "system",
          text: sourceText("status.agent.contextCleared"),
          createdAt: new Date().toISOString(),
          status: "completed",
          itemType: CONTEXT_RESET_ITEM_TYPE,
        };
        snapshot.messages.push(message);
        sortConversationMessages(snapshot.messages);
        snapshot.revision = database.appendConversationMessage({
          agentId,
          threadId,
          activeTurnId: snapshot.activeTurnId,
          message,
          eventType: "thread.context-cleared",
        });
        return { result: threadId, snapshot };
      });
      return threadId;
    });
    yield* this.#threads.endThreadContext(threadId);
    yield* this.#memoryReview.chatCleared(agentId);
  }, Effect.uninterruptible).bind(this);

  readonly deleteAgentHistory = Effect.fn("AgentService.deleteAgentHistory")(function* (
    this: AgentService,
    agentId: string,
  ) {
    const busy = () => new ContextResetBusyError(sourceText("error.agent.waitBeforeDeleteHistory"));
    const mainChatBusy = (agent: AgentSummary) => {
      const working = this.#conversation.workingSnapshot(agentId);
      return (
        Boolean(
          working?.activeTurnId && !(working.threadId && this.messaging.inMessagingLane(agentId, working.threadId)),
        ) ||
        this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agentId, this.#tasks.oneTurnAtATime(agentId), [], false) ||
        this.#threads.mainContextBusy(agent)
      );
    };
    const target = yield* lifecycleStep("delete agent history", () => {
      const agent = this.#conversation.requireKnownAgent(agentId);
      if (mainChatBusy(agent)) throw busy();
      return agent.threadId
        ? { threadId: agent.threadId, messageIds: this.#store.database.threadMessageIds(agent.threadId) }
        : null;
    });
    if (!target) return;
    yield* this.#drain.endPlanContinuation(agentId, null);
    const mailbox = yield* this.#mailbox
      .deleteShownMessages(agentId, target.messageIds)
      .pipe(
        Effect.catchTag("StoredStateFailure", ({ cause }) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "delete agent history", cause })),
        ),
      );
    if (mailbox === "busy")
      return yield* new AgentLifecycleFailed({ operation: "delete agent history", cause: busy() });
    yield* lifecycleStep("delete agent history", () =>
      this.#conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
        const agent = this.#conversation.requireKnownAgent(agentId);
        if (threadId !== target.threadId || snapshot.activeTurnId || mainChatBusy(agent)) throw busy();
        const revision = this.#store.database.deleteThreadHistory({ agentId, threadId });
        this.#conversation.forgetDeletedHistory(threadId);
        snapshot.messages = [];
        snapshot.revision = revision;
        return { result: undefined, snapshot };
      }),
    );
    yield* this.#store
      .clearPreview(agentId)
      .pipe(
        Effect.catchTag("StoredStateFailure", ({ cause }) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "delete agent history", cause })),
        ),
      );
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    this.#messagePins.messagesDeleted(agentId);
    yield* this.#threads.endThreadContext(target.threadId);
    yield* this.#memoryReview.chatCleared(agentId);
  }, Effect.uninterruptible).bind(this);

  readonly compactAgentContext = Effect.fn("AgentService.compactAgentContext")(function* (
    this: AgentService,
    agentId: string,
  ) {
    const externalThreadId = yield* lifecycleStep("compact agent context", () => {
      const agent = this.#conversation.requireKnownAgent(agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(agentId)?.activeTurnId ??
        (agent.threadId ? this.#store.database.readActiveTurnId(agentId, agent.threadId) : null);
      if (
        activeTurn ||
        this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agentId, this.#tasks.oneTurnAtATime(agentId)) ||
        this.#threads.mainContextBusy(agent)
      )
        throw new ContextCompactRefusedError(sourceText("error.agent.waitBeforeCompactContext"));
      const session = agent.threadId
        ? this.#store.database.activeProviderSession(agent.threadId, agent.provider)
        : null;
      if (!session || !this.#compaction.reserve(agentId, session.externalSessionId, true))
        throw new ContextCompactRefusedError(sourceText("error.agent.compactContextUnavailable"));
      return session.externalSessionId;
    });
    yield* this.#compaction.request(agentId, externalThreadId);
  }, Effect.uninterruptible).bind(this);

  readonly compactTaskContext = Effect.fn("AgentService.compactTaskContext")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ) {
    const externalThreadId = yield* lifecycleStep("compact task context", () => {
      const agent = this.#conversation.requireKnownAgent(input.agentId);
      const task = this.#tasks.requireOpen(input.agentId, input.taskId);
      const session = this.#store.database.activeProviderSession(task.threadId, agent.provider);
      if (
        this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId ||
        this.#store.database.readActiveTurnId(agent.id, task.threadId) ||
        this.#mailbox.taskBusy(agent.id, task.taskId) ||
        (session && this.#compaction.heldThreads(agent.id).includes(session.externalSessionId))
      )
        throw new ContextCompactRefusedError(sourceText("error.agent.waitBeforeCompactContext"));
      if (!session || !this.#compaction.reserve(agent.id, session.externalSessionId, true))
        throw new ContextCompactRefusedError(sourceText("error.agent.compactContextUnavailable"));
      return session.externalSessionId;
    });
    yield* this.#compaction.request(input.agentId, externalThreadId);
  }, Effect.uninterruptible).bind(this);

  readonly #compactBeforeCacheExpiry = Effect.fn("AgentService.compactBeforeCacheExpiry")(function* (
    this: AgentService,
    agentId: string,
    externalThreadId: string,
  ) {
    if (yield* this.#holdsBackgroundWork(externalThreadId)) return;
    const reserved = yield* lifecycleStep("compact before cache expiry", () =>
      this.#reserveCacheExpiryCompaction(agentId, externalThreadId),
    ).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("The compaction before the prompt cache expires did not start.", { error: failure.cause });
          return false;
        }),
      ),
    );
    if (reserved) yield* this.#compaction.request(agentId, externalThreadId);
  }, Effect.uninterruptible).bind(this);

  readonly #holdsBackgroundWork = Effect.fn("AgentService.holdsBackgroundWork")(function* (
    this: AgentService,
    externalThreadId: string,
  ) {
    const client = this.#conversation.openClientFor(externalThreadId);
    if (!client?.holdsBackgroundWork) return false;
    const background = yield* Effect.result(client.holdsBackgroundWork(externalThreadId));
    return Result.isFailure(background) || background.success;
  }).bind(this);

  #reserveCacheExpiryCompaction(agentId: string, externalThreadId: string): boolean {
    const agent = this.#store.get(agentId);
    const client = agent ? this.#providers.clientForAgent(agent) : null;
    if (
      !agent ||
      !client ||
      client.contextCompaction === "handoff" ||
      !this.#providers.agentClientRunning(agent) ||
      this.#conversation.openClientFor(externalThreadId) !== client
    )
      return false;
    const threadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    if (this.#store.database.activeProviderSession(threadId, agent.provider)?.externalSessionId !== externalThreadId)
      return false;
    const taskId = this.#tasks.taskForThread(threadId);
    const main = threadId === agent.threadId;
    const task = taskId !== null && !this.#tasks.isRoutineThreadId(threadId);
    const channel = this.channels.store.channelForThread(threadId) !== null;
    if (!main && !task && !channel) return false;
    if (
      !this.#usageLimits.mayDrain(agentId) ||
      this.#mailbox.hasUnfinishedDelivery(agentId) ||
      this.#compaction.heldThreads(agentId).length > 0 ||
      this.#conversation.loadedExecutionSnapshot(threadId)?.activeTurnId ||
      this.#conversation.workingSnapshot(agentId)?.activeTurnId ||
      this.#store.database.readActiveTurnId(agentId, threadId) ||
      (main && this.#threads.mainContextBusy(agent)) ||
      (task && taskId !== null && this.#mailbox.taskBusy(agentId, taskId))
    )
      return false;
    return this.#compaction.reserve(agentId, externalThreadId, true, null, "cacheExpiry");
  }

  readonly clearChannelContext = Effect.fn("AgentService.clearChannelContext")(function* (
    this: AgentService,
    channelId: string,
    person: { id: string; name: string },
  ) {
    yield* this.channels.clearContext(channelId, person, {
      busy: (contexts) => {
        const agents = new Map(this.#store.list().map((agent) => [agent.id, agent]));
        return contexts.some(({ agentId, threadId }) => this.#channelSessionBusy(agents.get(agentId), threadId));
      },
      end: (threadIds) =>
        Effect.forEach(threadIds, (threadId) => this.#threads.endThreadContext(threadId), { discard: true }),
    });
  }, Effect.uninterruptible).bind(this);

  readonly deleteChannelHistory = Effect.fn("AgentService.deleteChannelHistory")(function* (
    this: AgentService,
    channelId: string,
  ) {
    yield* this.channels.deleteHistory(channelId, {
      busy: (contexts) => {
        const agents = new Map(this.#store.list().map((agent) => [agent.id, agent]));
        return contexts.some(({ agentId, threadId }) => this.#channelSessionBusy(agents.get(agentId), threadId));
      },
      forget: (contexts) =>
        Effect.forEach(
          contexts,
          ({ agentId, threadId }) =>
            Effect.gen({ self: this }, function* () {
              yield* channelSync(() => this.#deleteChannelThreadHistory(agentId, threadId));
              this.#turn.fileHistory.forgetThread(threadId);
              yield* this.#threads.endThreadContext(threadId);
            }),
          { discard: true },
        ),
    });
  }, Effect.uninterruptible).bind(this);

  #deleteChannelThreadHistory(agentId: string, threadId: string): void {
    const revision = this.#store.database.deleteThreadHistory({ agentId, threadId });
    this.#conversation.forgetDeletedHistory(threadId);
    const loaded = this.#conversation.executionSnapshot(threadId);
    if (!loaded) return;
    const snapshot = { ...loaded, messages: [], revision };
    this.#conversation.setSnapshot(agentId, snapshot);
    this.#conversation.publishConversation(snapshot);
  }

  #channelSessionBusy(agent: AgentSummary | undefined, threadId: string): boolean {
    if (!agent) return false;
    if (
      this.#conversation.loadedExecutionSnapshot(threadId)?.activeTurnId ||
      this.#store.database.readActiveTurnId(agent.id, threadId)
    )
      return true;
    const session = this.#store.database.activeProviderSession(threadId, agent.provider);
    return session !== null && this.#compaction.heldThreads(agent.id).includes(session.externalSessionId);
  }

  readonly compactChannelContext = Effect.fn("AgentService.compactChannelContext")(function* (
    this: AgentService,
    channelId: string,
  ) {
    const contexts = yield* this.channels.compactTargets(channelId);
    const { agents: members, candidates: found } = yield* lifecycleStep("find channel compact members", () =>
      this.#channelCompactCandidates(channelId, contexts),
    );
    const stoppedMembers = [...new Set(found.map(({ agentId }) => members.get(agentId)))].filter(
      (agent): agent is AgentSummary =>
        agent !== undefined &&
        this.#mayCompactOnRequest(agent) &&
        !this.#providers.agentClientRunning(agent) &&
        this.#providers.agentClientCurrent(agent),
    );
    yield* Effect.forEach(
      stoppedMembers,
      (agent) =>
        this.#providers.ensureAgentClient(agent).pipe(
          Effect.asVoid,
          Effect.catch(() =>
            Effect.sync(() =>
              logger.warn("A channel member's provider did not start to compact.", { agentId: agent.id }),
            ),
          ),
        ),
      { discard: true },
    );
    const sessions = yield* lifecycleStep("compact channel context", () => {
      const { agents, candidates } = this.#channelCompactCandidates(channelId, contexts);
      const reserved = candidates.filter(({ agentId, externalSessionId }) =>
        this.#compaction.reserve(agentId, externalSessionId, true),
      );
      if (!reserved.length) throw new ContextCompactRefusedError(this.#channelCompactRefusal(candidates, agents));
      return reserved;
    });
    yield* Effect.forEach(
      sessions,
      ({ agentId, externalSessionId }) => this.#compaction.request(agentId, externalSessionId),
      { discard: true, concurrency: "unbounded" },
    );
  }, Effect.uninterruptible).bind(this);

  #channelCompactCandidates(
    channelId: string,
    contexts: ReadonlyArray<{ agentId: string; threadId: string }>,
  ): {
    agents: Map<string, AgentSummary>;
    candidates: Array<{ agentId: string; threadId: string; externalSessionId: string }>;
  } {
    const agents = new Map(this.#store.list().map((agent) => [agent.id, agent]));
    const candidates = contexts.flatMap(({ agentId, threadId }) => {
      const agent = agents.get(agentId);
      const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
      return agent && session ? [{ agentId, threadId, externalSessionId: session.externalSessionId }] : [];
    });
    if (
      this.channels.compactionBlocked(channelId) ||
      candidates.some(({ agentId, threadId }) => this.#channelSessionBusy(agents.get(agentId), threadId))
    )
      throw new ContextCompactRefusedError(sourceText("error.backend.channelWaitBeforeCompact"));
    return { agents, candidates };
  }

  #channelCompactRefusal(
    candidates: ReadonlyArray<{ agentId: string }>,
    agents: ReadonlyMap<string, AgentSummary>,
  ): string {
    if (!candidates.length) return sourceText("error.backend.channelCompactNoSession");
    const onRequest = candidates
      .map(({ agentId }) => agents.get(agentId))
      .filter((agent): agent is AgentSummary => agent !== undefined && this.#mayCompactOnRequest(agent));
    if (!onRequest.length) return sourceText("error.backend.channelCompactNotSupported");
    return sourceText(
      onRequest.some((agent) => !this.#providers.agentClientRunning(agent))
        ? "error.backend.channelCompactProviderUnavailable"
        : "error.backend.channelCompactUnavailable",
    );
  }

  channelCompactAvailable(channelId: string): boolean {
    const members = new Set(this.channels.store.get(channelId).members.map((member) => member.agentId));
    return this.#store.list().some((agent) => members.has(agent.id) && this.#mayCompactOnRequest(agent));
  }

  #mayCompactOnRequest(agent: AgentSummary): boolean {
    const mode = this.#providers.lastCompactionMode(agent) ?? fixedContextCompaction(agent.provider);
    return mode === undefined || compactsOnRequest(mode);
  }

  #startRequestedNewChat(agentId: string, queuedRuns: readonly string[] = []): Effect.Effect<void> {
    if (!this.#requestedNewChats.has(agentId)) return Effect.void;
    const agent = this.#store.get(agentId);
    if (!agent || !agentNewChatAllowed(agent, this.#store.agentDefaults())) {
      this.#requestedNewChats.delete(agentId);
      return Effect.void;
    }
    const startNewChat = this.clearAgentContext(agentId, queuedRuns).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.#requestedNewChats.delete(agentId);
          logger.info(`Agent ${agentId} started a new chat.`);
        }),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => {
          if (failure.cause instanceof ContextResetBusyError) return;
          this.#requestedNewChats.delete(agentId);
          this.#emitError("agent_new_chat_failed", failure.cause, agentId);
        }),
      ),
    );
    return this.#threads
      .mainRunsBackgroundWork(agent)
      .pipe(Effect.flatMap((background) => (background ? Effect.void : startNewChat)));
  }

  resolveChannelImage(channelId: string): ChannelImageFile | null {
    if (!this.channels.store.exists(channelId)) return null;
    return this.channels.images.resolve(this.channels.store.get(channelId));
  }

  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    return this.#store.resolveAvatar(agentId);
  }

  resolveSharedFile(
    inputPath: string,
    options?: { allowDirectory?: boolean; followLinks?: boolean },
  ): Effect.Effect<ResolvedSharedFile, AgentLifecycleFailed> {
    return resolveSharedFile(this.#store.sharedRoot, inputPath, options).pipe(
      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "resolveSharedFile", cause: failure.cause })),
    );
  }

  readonly resolveWorkspaceFile = Effect.fn("AgentService.resolveWorkspaceFile")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* resolveWorkspaceFile(agent, inputPath).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "resolve workspace file", cause: failure.cause }),
      ),
    );
  }).bind(this);

  readonly resolveLocalWorkspaceFile = Effect.fn("AgentService.resolveLocalWorkspaceFile")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
    options: { exactPath?: boolean } = {},
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* resolveWorkspaceFile(agent, inputPath, {
      ...localWorkspaceAccess(agent),
      ...(options.exactPath
        ? { exactPath: true }
        : {
            fileHistory: this.#turn.fileHistory.paths(agent.id, agent.threadId),
            workFolders: this.#turn.fileHistory.folders(agent.id, agent.threadId),
          }),
    }).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "resolve local workspace file", cause: failure.cause }),
      ),
    );
  }).bind(this);

  readonly listWorkspaceDirectory = Effect.fn("AgentService.listWorkspaceDirectory")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* listWorkspaceDirectory(agent, inputPath).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "list workspace directory", cause: failure.cause }),
      ),
    );
  }).bind(this);

  readonly listLocalWorkspaceDirectory = Effect.fn("AgentService.listLocalWorkspaceDirectory")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* listWorkspaceDirectory(agent, inputPath, localWorkspaceAccess(agent)).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "list local workspace directory", cause: failure.cause }),
      ),
    );
  }).bind(this);

  #agentForFile(agentId: string): AgentSummary {
    const agent = this.#store.get(agentId);
    if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
    return agent;
  }

  ensureAgentDeletable(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#removal
      .ensureDeletable(agentId)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })));
  }

  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return Effect.sync(() => this.#planContinuation.cancel(agentId)).pipe(
      Effect.andThen(this.#removal.delete(agentId)),
      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })),
    );
  }

  #deleteAgentAndPlaces(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.deleteAgent(agentId).pipe(
      Effect.andThen(() =>
        Effect.all([
          this.#sidebarLayout?.removeAgent(agentId) ?? Effect.void,
          this.#libraryFolders?.removeAgent(agentId) ?? Effect.void,
        ]).pipe(
          Effect.catch((failure) =>
            Effect.sync(() =>
              logger.warn("Could not remove the places of a deleted agent.", { agentId, error: failure.cause }),
            ),
          ),
        ),
      ),
      Effect.asVoid,
    );
  }

  #deleteReleasedFolders(): Effect.Effect<void> {
    return Effect.suspend(() =>
      this.#stopping
        ? Effect.void
        : Effect.forEach(
            this.#removal.heldFoldersReleased(),
            (agentId) =>
              this.#deleteAgentAndPlaces(agentId).pipe(
                Effect.catch((failure) =>
                  Effect.sync(() => this.#emitError("agent_delete_failed", failure.cause, agentId)),
                ),
              ),
            { discard: true },
          ),
    );
  }

  deleteChannel(channelId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.channels
      .deleteChannel(channelId)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteChannel", cause: failure.cause })),
      );
  }

  readonly initialize = Effect.fn("AgentService.initialize")(function* (
    this: AgentService,
    options: {
      heldRoutines?: RoutineHoldWindow | undefined;
      rosterLoaded?: Effect.Effect<void> | undefined;
      beforeProviderStart?: Effect.Effect<void> | undefined;
    } = {},
  ) {
    this.#stopping = false;
    yield* this.#store
      .initialize()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "initialize agent store", cause: failure.cause }),
        ),
      );
    yield* this.#mailbox
      .initialize()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "initialize mailbox", cause: failure.cause }),
        ),
      );
    yield* lifecycleStep("restore channel links", () => {
      const ownChatLinks = new Set(
        this.#store.list().flatMap((agent) => {
          const link = agent.threadId ? this.messaging.store.linkForThread(agent.threadId) : null;
          return link ? [link.linkId] : [];
        }),
      );
      this.#mailbox.useMessagingLane((agentId, linkId) => {
        const provider = this.#store.providerOf(agentId);
        return !ownChatLinks.has(linkId) && provider !== undefined && agentProviderDescriptor(provider).concurrentTurns;
      });
      this.#mcp.migrateCatalogRows();
      this.#channelRequestReturns.restore();
      this.channels.restoreDeliveryLinks();
      this.channels.removeDeletedMembers(new Set(this.#store.list().map((agent) => agent.id)));
    });
    yield* this.#threads
      .reconcileProviderSessionFiles()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "reconcile provider sessions", cause: failure.cause }),
        ),
      );
    yield* lifecycleStep("recover agent state", () => {
      this.#boot.recoverPersistedTurns();
      this.#hostedSites.restore();
      const paused = this.#routines.pauseForAgentsHiddenBeforeWork();
      if (paused > 0)
        logger.info("Routines of agents hidden by an earlier version were turned off.", { count: paused });
      this.#routines.skipMissed(new Date(), options.heldRoutines);
      this.#channelRoutines.skipMissed(new Date(), options.heldRoutines);
      this.#initialized = true;
      this.#memoryHold.start();
    });
    if (options.rosterLoaded) yield* options.rosterLoaded;
    if (options.beforeProviderStart) yield* options.beforeProviderStart;
    yield* this.#providers
      .start()
      .pipe(Effect.mapError((error) => new AgentLifecycleFailed({ operation: "start providers", cause: error.cause })));
    yield* lifecycleStep("publish queues", () => {
      for (const agent of this.#store.list()) this.#mailboxSync.emitQueue(agent.id);
    });
    yield* Effect.forEach(
      this.#store.list().flatMap((agent) => this.#tasks.openTaskIds(agent.id)),
      (taskId) => this.#tasks.releaseAfterLostWork(taskId),
      { discard: true },
    );
    yield* this.#routines
      .resumePendingRuns()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "resume agent routines", cause: failure.cause }),
        ),
      );
    yield* this.#channelRoutines
      .resumePendingRuns()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "resume channel routines", cause: failure.cause }),
        ),
      );
    yield* lifecycleStep("arm routines", () => {
      this.#channelRoutines.reconcileAll();
      this.#routineTimer.arm();
    });
  }).bind(this);

  setPreferredProvider(
    provider: AgentProvider,
    model: AgentModelId | null = null,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers.setPreferredProvider(provider, this.#initialized, model);
  }

  ensureProvider(provider: AgentProvider): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers
      .ensureProvider(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "ensureProvider", cause: failure.cause })),
      );
  }

  setProviderOn(provider: AgentProvider, on: boolean): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    const change = () => this.#providers.setProviderOn(provider, on);
    return this.#providerUseChanges
      .withPermit(on ? change() : this.#endpoints.runExclusive(change))
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "setProviderOn", cause: failure.cause })),
      );
  }

  refreshProviders(options: { automatic: boolean }): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .refreshProviders(options)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "refreshProviders", cause: failure.cause })),
      );
  }

  refreshProvider(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .refreshProvider(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "refreshProvider", cause: failure.cause })),
      );
  }

  providerSpawnSettingsChanged(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .spawnSettingsChanged(provider)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "providerSpawnSettingsChanged", cause: failure.cause }),
        ),
      );
  }

  restartProvider(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .restartProviderWhenIdle(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "restartProvider", cause: failure.cause })),
      );
  }

  chooseInstalledCli(provider: AgentProvider, installed: boolean): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .chooseInstalledCli(provider, installed)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "chooseInstalledCli", cause: failure.cause }),
        ),
      );
  }

  cancelProviderRestart(provider: AgentProvider): AgentStatus {
    return this.#providers.cancelProviderRestart(provider);
  }

  connectProvider(
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
    region: SignInRegion = "global",
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .connectProvider(provider, openExternal, region)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "connectProvider", cause: failure.cause })),
      );
  }

  connectProviderAccount(
    provider: AgentProvider,
    accountId: string | null,
    openExternal: (url: string) => Promise<void>,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .connectProviderAccount(provider, accountId, openExternal)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "connectProviderAccount", cause: failure.cause }),
        ),
      );
  }

  startProviderAccountCodeLogin(
    provider: AgentProvider,
    accountId: string | null,
  ): Effect.Effect<ProviderAccountCodeLoginStart, AgentLifecycleFailed> {
    return this.#providers
      .startProviderAccountCodeLogin(provider, accountId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "connectProviderAccount", cause: failure.cause }),
        ),
      );
  }

  submitProviderAccountCodeLogin(provider: AgentProvider, accountId: string, code: string): void {
    this.#providers.submitProviderAccountCodeLogin(provider, accountId, code);
  }

  providerAccountCodeLoginStatus(provider: AgentProvider, accountId: string): ProviderAccountCodeLoginStatus {
    return this.#providers.providerAccountCodeLoginStatus(provider, accountId);
  }

  connectProviderAccountKey(
    provider: AgentProvider,
    accountId: string | null,
    key: string,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .connectProviderAccountKey(provider, accountId, key)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "connectProviderAccount", cause: failure.cause }),
        ),
      );
  }

  signInProviderAccountOnHost(
    provider: AgentProvider,
    accountId: string | null,
    openPage: (url: string) => Promise<void>,
    atHost = false,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers
      .signInProviderAccountOnHost(provider, accountId, openPage, atHost)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "signInProviderAccountOnHost", cause: failure.cause }),
        ),
      );
  }

  cancelProviderAccountSignIn(
    provider: AgentProvider,
    accountId: string,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .cancelProviderAccountSignIn(provider, accountId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "cancelProviderAccountSignIn", cause: failure.cause }),
        ),
      );
  }

  renameProviderAccount(
    provider: AgentProvider,
    accountId: string,
    label: string | null,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .renameProviderAccount(provider, accountId, label)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "renameProviderAccount", cause: failure.cause }),
        ),
      );
  }

  setProviderAccountPool(
    provider: AgentProvider,
    enabled: boolean,
    leftOut: readonly string[],
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers.setProviderAccountPool(provider, enabled, leftOut).pipe(
      Effect.map(() => {
        this.#poolReads.delete(provider);
        this.#refreshPoolInUse(provider);
        if (enabled) this.#readPoolWhenStale(provider);
        return this.getStatus();
      }),
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "setProviderAccountPool", cause: failure.cause }),
      ),
    );
  }

  setLiveVoiceAccount(accountId: string | null): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers.setLiveVoiceAccount(accountId).pipe(
      Effect.map(() => this.getStatus()),
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "setLiveVoiceAccount", cause: failure.cause }),
      ),
    );
  }

  liveVoiceAccount(): string | null {
    return this.#providers.liveVoiceAccount();
  }

  #liveVoiceAccountId(agent: Pick<AgentSummary, "provider" | "providerAccountId"> | undefined): string | undefined {
    const agentAccount = agent?.provider === "codex" ? agent.providerAccountId : undefined;
    const ownAccount = agentAccount === DEFAULT_PROVIDER_ACCOUNT_ID ? undefined : agentAccount;
    const planAccount = this.#providers.codexPlanAccountInPlaceOfKey();
    const chosen = this.#providers.liveVoiceAccount();
    const usableChoice = planAccount && chosen === DEFAULT_PROVIDER_ACCOUNT_ID ? null : chosen;
    return usableChoice ?? ownAccount ?? planAccount ?? agentAccount;
  }

  providerUsageResets(provider: AgentProvider): Effect.Effect<ProviderUsageResets[]> {
    return this.#providers.usageResets(provider);
  }

  readonly resetProviderUsage = Effect.fn("AgentService.resetProviderUsage")(function* (
    this: AgentService,
    provider: AgentProvider,
    accountId: string,
  ) {
    const outcome = yield* this.#providers
      .resetUsage(provider, accountId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "resetProviderUsage", cause: failure.cause }),
        ),
      );
    if (outcome === "reset" || outcome === "nothingToReset")
      yield* this.#usageLimits.accountReset(provider, accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? null : accountId);
    return outcome;
  }).bind(this);

  removeProviderAccount(provider: AgentProvider, accountId: string): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const agents = this.#store
            .list()
            .filter((agent) => providerForAgent(agent) === provider && agentProviderAccount(agent) === accountId);
          yield* lifecycleStep("check provider account", () => {
            if (agents.some((agent) => this.#runsTurn(agent.id) || this.#mailbox.hasUnfinishedDelivery(agent.id)))
              throw new Error(sourceText("error.provider.accountInUse"));
          });
          for (const agent of agents)
            yield* this.#applyAgentUpdate({
              agentId: agent.id,
              providerAccountId: null,
              ...this.#modelForAccount({ ...agent, provider }, undefined),
            });
          const queued = this.#store
            .list()
            .filter(
              (agent) =>
                agent.pendingRuntime?.provider === provider && agentProviderAccount(agent.pendingRuntime) === accountId,
            );
          for (const agent of queued)
            if (agent.pendingRuntime)
              yield* this.#store.updateAgent({
                agentId: agent.id,
                pendingRuntime: {
                  ...agent.pendingRuntime,
                  providerAccountId: undefined,
                  ...this.#modelForAccount(agent.pendingRuntime, undefined),
                },
              });
          if (queued.length > 0) this.#emit({ type: "agents-changed", agents: this.listAgents() });
          return yield* this.#providers.removeProviderAccount(provider, accountId);
        }),
      )
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "removeProviderAccount", cause: failure.cause }),
        ),
      );
  }

  signOutProvider(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .signOutProvider(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "signOutProvider", cause: failure.cause })),
      );
  }

  signInProviderOnHost(
    provider: AgentProvider,
    openPage: (url: string) => Promise<void>,
    atHost = false,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers
      .signInProviderOnHost(provider, openPage, atHost)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "signInProviderOnHost", cause: failure.cause }),
        ),
      );
  }

  cancelProviderSignIn(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .cancelProviderSignIn(provider)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "cancelProviderSignIn", cause: failure.cause }),
        ),
      );
  }

  startProviderCodeLogin(
    provider: AgentProvider,
    onThisComputer = false,
  ): Effect.Effect<ProviderCodeLoginStart, AgentLifecycleFailed> {
    return this.#providers
      .startProviderCodeLogin(provider, onThisComputer)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "startProviderCodeLogin", cause: failure.cause }),
        ),
      );
  }

  signInCodexWithApiKey(apiKey: string): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.changeProviderCredential("codex", () =>
      this.#providers
        .saveCodexApiKey(apiKey)
        .pipe(
          Effect.mapError(
            (failure) => new AgentLifecycleFailed({ operation: "signInCodexWithApiKey", cause: failure.cause }),
          ),
        ),
    );
  }

  submitProviderCodeLogin(provider: AgentProvider, code: string): AgentStatus {
    return this.#providers.submitProviderCodeLogin(provider, code);
  }

  cancelProviderCodeLogin(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .cancelProviderCodeLogin(provider)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "cancelProviderCodeLogin", cause: failure.cause }),
        ),
      );
  }

  changeProviderCredential(
    provider: AgentProvider,
    change: () => Effect.Effect<void, AgentLifecycleFailed>,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    let usedKey = provider !== "claude";
    return this.#providers
      .changeProviderCredential(provider, () =>
        Effect.suspend(() => {
          usedKey ||= this.#providers.ownSignInUsesKey(provider);
          return change();
        }).pipe(toProviderOperationFailed),
      )
      .pipe(
        Effect.tap(() =>
          (usedKey || this.#providers.ownSignInUsesKey(provider)
            ? this.#usageLimits.accountReset(provider, null)
            : Effect.void
          ).pipe(Effect.andThen(this.#usageLimits.credentialChanged(provider, null))),
        ),
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: failure.cause }),
        ),
        Effect.flatMap((status) => (provider === "claude" ? this.#claudeKeyChanged() : Effect.succeed(status))),
      );
  }

  clearProviderCredential(
    provider: AgentProvider,
    clear: () => Effect.Effect<void, AgentLifecycleFailed>,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return Effect.suspend(() => {
      if (provider !== "claude" || !this.#providers.hasProviderAccount(provider, CLAUDE_API_KEY_ACCOUNT_ID))
        return Effect.void;
      if (this.#isProviderBusy(provider))
        return Effect.fail(
          new AgentLifecycleFailed({
            operation: "changeProviderCredential",
            cause: new Error(sourceText("error.provider.cliBusyRetry", { provider: providerLabel(provider) })),
          }),
        );
      return this.removeProviderAccount(provider, CLAUDE_API_KEY_ACCOUNT_ID);
    }).pipe(Effect.andThen(this.changeProviderCredential(provider, clear)));
  }

  readonly #claudeKeyChanged = Effect.fn("AgentService.claudeKeyChanged")(function* (this: AgentService) {
    const status = this.#providers.hasProviderKey("claude")
      ? yield* this.#providers.providerKeyChanged("claude")
      : this.#providers.hasProviderAccount("claude", CLAUDE_API_KEY_ACCOUNT_ID)
        ? yield* this.removeProviderAccount("claude", CLAUDE_API_KEY_ACCOUNT_ID)
        : this.#providers.status();
    yield* this.#usageLimits.accountReset("claude", CLAUDE_API_KEY_ACCOUNT_ID);
    yield* this.#usageLimits.credentialChanged("claude", CLAUDE_API_KEY_ACCOUNT_ID);
    return status;
  });

  updateProviderCli(
    provider: AgentProvider,
    install: () => Effect.Effect<string, AgentLifecycleFailed>,
    signal: AbortSignal,
    onWait: () => void,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .updateProviderCli(provider, () => install().pipe(toProviderOperationFailed), signal, onWait)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "updateProviderCli", cause: failure.cause }),
        ),
      );
  }

  reloadCustomProviderConfig(
    harness: CustomProviderHarness,
  ): Effect.Effect<CustomProviderRestart, AgentLifecycleFailed> {
    return this.#providers.reloadCustomProviderConfig(harness);
  }

  startHarnessForMovedAgents(harness: CustomProviderHarness): Effect.Effect<void> {
    return Effect.suspend(() =>
      this.#endpoints.waitsForHarness(harness)
        ? this.#providers.ensureProvider(harness).pipe(
            Effect.catch((failure) =>
              Effect.sync(() => this.#emitError("agent_model_fallback_failed", failure.cause)).pipe(
                Effect.andThen(this.#endpoints.abandonMovesTo(harness)),
              ),
            ),
            Effect.forkIn(this.#scope),
            Effect.asVoid,
          )
        : Effect.void,
    );
  }

  reloadCustomAgents(): Effect.Effect<CustomProviderRestart, AgentLifecycleFailed> {
    return this.#providers
      .reloadCustomAgents()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "reloadCustomAgents", cause: failure.cause }),
        ),
      );
  }

  withCustomAgentRuntimeRemoval<T>(
    _customAgentIds: readonly string[],
    operation: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#providers
      .withCustomAgentRuntimeRemoval(() => operation().pipe(toProviderOperationFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "removeCustomAgentRuntime", cause: failure.cause }),
        ),
      );
  }

  customAgentUsage() {
    return this.#providers.customAgentUsage();
  }

  saveCustomAgent<T>(persist: () => Effect.Effect<T, AgentLifecycleFailed>): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .saveCustomAgent(() => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "saveCustomAgent", cause: failure.cause })),
      );
  }

  removeCustomAgent<T>(
    customAgentId: string,
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .removeCustomAgent(customAgentId, () => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "removeCustomAgent", cause: failure.cause }),
        ),
      );
  }

  saveCustomProvider<T>(
    providerId: string,
    harness: CustomProviderHarness,
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .save(providerId, harness, () => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "saveCustomProvider", cause: failure.cause }),
        ),
      );
  }

  updateCustomProvider<T>(
    providerId: string,
    harness: CustomProviderHarness,
    removedModelIds: readonly string[],
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .update(providerId, harness, removedModelIds, () => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "updateCustomProvider", cause: failure.cause }),
        ),
      );
  }

  removeCustomProvider<T>(
    providerId: string,
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .remove(providerId, () => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "removeCustomProvider", cause: failure.cause }),
        ),
      );
  }

  #isProviderBusy(provider: AgentProvider): boolean {
    return (
      this.#profileClients.usesProvider(provider) ||
      this.#drain.hasStartingDeliveries(provider) ||
      this.#store.list().some((agent) => providerForAgent(agent) === provider && this.#runsTurn(agent.id))
    );
  }

  #isProviderBusyApartFrom(provider: AgentProvider, agentId: string): boolean {
    return (
      this.#profileClients.usesProvider(provider) ||
      this.#store
        .list()
        .some(
          (agent) =>
            agent.id !== agentId &&
            providerForAgent(agent) === provider &&
            (this.#runsTurn(agent.id) || this.#mailbox.startingDeliveriesForAgent(agent.id).length > 0),
        )
    );
  }

  #runsTurn(agentId: string): boolean {
    return this.#conversation.anyWorkingSnapshot(agentId) != null || !this.#compaction.mayDrain(agentId);
  }

  #sharedProcessesToRelease(agentId: string): AgentProvider[] {
    const reading = this.#providersReadingSessionSettings();
    return this.#folderProviders(agentId).filter((provider) => !reading.has(provider));
  }

  #folderHeld(agentId: string): boolean {
    if (!this.#providers.isReady()) return true;
    const reading = this.#providersReadingSessionSettings();
    return this.#folderProviders(agentId).some(
      (provider) => provider !== "codex" && (reading.has(provider) || this.#providers.keepsSharedProcess(provider)),
    );
  }

  #folderProviders(agentId: string): AgentProvider[] {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return [];
    const providers = new Set<AgentProvider>([providerForAgent(agent)]);
    if (agent.threadId)
      for (const session of this.#store.database.listProviderSessions(agent.threadId)) providers.add(session.provider);
    return [...providers];
  }

  #providersReadingSessionSettings(): Set<AgentProvider> {
    return new Set(
      this.#store
        .list()
        .filter((agent) => this.#drain.holdsSessionSettings(agent.id))
        .map((agent) => providerForAgent(agent)),
    );
  }

  #providerAvailable(provider: AgentProvider): boolean {
    return (
      this.getStatus().providers?.some((candidate) => candidate.id === provider && candidate.state === "available") ??
      false
    );
  }

  readonly stop = Effect.fn("AgentService.stop")(function* (this: AgentService) {
    this.#stopping = true;
    yield* this.#memoryReview.dispose();
    const channelStop = yield* Effect.forkChild(
      this.channels
        .stop()
        .pipe(
          Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "stop channels", cause: failure.cause })),
        ),
      { startImmediately: true },
    );
    this.#initialized = false;
    yield* this.#liveVoice.dispose();
    this.#routineTimer.dispose();
    yield* this.#memoryHold.dispose();
    this.#hostedSites.dispose();
    this.#compaction.dispose();
    this.#deltas.dispose();
    this.#conversation.dispose();
    this.#threads.dispose();
    this.#codexIdleSessions.dispose();
    this.#memories.clearPending();
    this.#tables?.dispose();
    this.#attention.clearPrompts();
    this.#attention.clearBrowserTakeovers();
    this.#attention.clearApprovals();
    const clients = [...(yield* this.#providers.dispose()), ...this.#profileClients.release()];
    for (const client of clients) client.markTurnsStoppedForShutdown?.();
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      if (!snapshot.activeTurnId) continue;
      const agent = this.#store.get(agentId);
      const session = agent && snapshot.threadId ? this.#runningSession(agent, snapshot.threadId) : undefined;
      if (session) this.#images.interrupt(agentId, session, snapshot.activeTurnId);
    }
    yield* this.#turn.dispose();
    yield* this.#usageLimits.dispose();
    this.#drain.dispose();
    this.#queue.dispose();
    this.#planContinuation.dispose();
    this.#browser.clearControls();
    yield* Effect.forEach(clients, (client) => client.stop().pipe(Effect.catch(() => Effect.void)), {
      concurrency: "unbounded",
      discard: true,
    });
    this.#tasks.dispose();
    yield* this.#warmGenerations.dispose();
    yield* Fiber.join(channelStop);
    yield* this.#mcp.close();
    yield* settleLifecycleTasks("finish drain", this.#drain.pendingTasks());
    yield* settleLifecycleTasks("finish image requests", this.#images.pendingOperations());
    yield* this.#images.dispose();
    yield* settleLifecycleTasks("finish attachment commands", this.#attachments.pendingCommands());
    this.#attachments.dispose();
    yield* this.#browserUploads
      .dispose()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "stop browser uploads", cause: failure.cause }),
        ),
      );
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
    this.#providers.markStopped();
  }).bind(this);

  readConversation(agentId: string): Effect.Effect<ConversationSnapshot, AgentLifecycleFailed> {
    return this.#reader
      .read(agentId)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "readConversation", cause: failure.cause })),
      );
  }

  readConversationFor(
    agentId: string,
    memberId: string,
  ): Effect.Effect<ConversationWithReadState, AgentLifecycleFailed> {
    return this.#reader
      .readFor(agentId, memberId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "readConversationFor", cause: failure.cause }),
        ),
      );
  }

  readConversationPageFor(
    agentId: string,
    memberId: string,
    anchor?: ConversationPageAnchor,
    limit?: number,
    options?: ConversationMarkerExclusions,
  ): Effect.Effect<ConversationPage, AgentLifecycleFailed> {
    return this.#reader
      .readPageFor(agentId, memberId, anchor, limit, options)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "readConversationPageFor", cause: failure.cause }),
        ),
      );
  }

  searchConversationMessages(
    query: string,
    agentId?: string,
    cursor?: string,
    limit?: number,
    includeSideThreads = false,
  ): ConversationSearchPage {
    return this.#reader.search(query, agentId, cursor, limit, includeSideThreads);
  }

  searchConversationFiles(query: string, cursor?: string, limit?: number): ConversationFileSearchPage {
    return this.#reader.searchFiles(query, cursor, limit);
  }

  readSentMessageStats(): SentMessageStats {
    return this.#store.database.readSentMessageStats();
  }

  listConversationReads(
    memberId: string,
    options?: ConversationMarkerExclusions,
  ): Record<string, ConversationReadState> {
    return this.#reader.listReads(memberId, options);
  }

  adoptConversationReads(sourceMemberId: string, targetMemberId: string): void {
    this.#reader.adoptReads(sourceMemberId, targetMemberId);
  }

  markConversationRead(
    agentId: string,
    memberId: string,
    throughMessageId: string | null,
    options?: ConversationMarkerExclusions,
  ): Effect.Effect<ConversationReadState, AgentLifecycleFailed> {
    return this.#reader
      .markRead(agentId, memberId, throughMessageId, options)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "markConversationRead", cause: failure.cause }),
        ),
      );
  }

  markConversationUnread(
    agentId: string,
    memberId: string,
    fromMessageId: string | null = null,
    options?: ConversationMarkerExclusions,
  ): Effect.Effect<ConversationReadState, AgentLifecycleFailed> {
    return this.#reader
      .markUnread(agentId, memberId, fromMessageId, options)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "markConversationUnread", cause: failure.cause }),
        ),
      );
  }

  prepareAttachments(paths: string[]): Effect.Effect<DraftAttachment[], AgentLifecycleFailed> {
    return this.#mailbox
      .prepareAttachments(paths)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "prepareAttachments", cause: failure.cause }),
        ),
      );
  }

  prepareImportedAttachments(
    paths: string[],
    data: AttachmentDataInput[],
  ): Effect.Effect<DraftAttachment[], AgentLifecycleFailed> {
    return this.#mailbox
      .prepareImportedAttachments(paths, data)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "prepareImportedAttachments", cause: failure.cause }),
        ),
      );
  }

  startLiveVoice(
    input: VoiceLiveStart,
    voice: CodexLiveVoice | null,
    owner: LiveVoiceOwner | null = null,
  ): Effect.Effect<VoiceLiveSession, AgentLifecycleFailed> {
    return this.#liveVoice
      .start(input, voice, owner)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "startLiveVoice", cause: failure.cause })),
      );
  }

  stopLiveVoice(sessionId: string, memberId: string | null = null): Effect.Effect<void> {
    return this.#liveVoice.stop(sessionId, memberId);
  }

  #sideCodexModel(): AgentModelOption | undefined {
    const models = this.#endpoints.available().filter((model) => model.provider === "codex");
    const model =
      models.find((candidate) => candidate.id === agentProviderDescriptor("codex").defaultModel) ?? models[0];
    if (!model) return undefined;
    return model.supportedReasoningEfforts.includes("low") ? { ...model, defaultReasoningEffort: "low" } : model;
  }

  readonly #liveVoiceRelay = Effect.fn("AgentService.liveVoiceRelay")(function* (
    this: AgentService,
    agent: AgentSummary,
  ) {
    const signIn = () => ({ cause: new Error(sourceText("error.voice.live.signIn")) });
    yield* this.#providers.ensureProvider("codex").pipe(Effect.mapError(signIn));
    const model = this.#sideCodexModel();
    if (!model) return yield* Effect.fail({ cause: new Error(sourceText("error.provider.noModel")) });
    const client = yield* Effect.try({
      try: () => this.#providers.createProfileClient("codex", this.#liveVoiceAccountId(agent)),
      catch: signIn,
    });
    return { client, model: model.id, effort: model.defaultReasoningEffort };
  }).bind(this);

  readonly #searchWeb = Effect.fn("AgentService.searchWeb")(function* (
    this: AgentService,
    agentId: string,
    query: string,
  ) {
    const failed = (message: string) => new ToolOperationFailed({ cause: new Error(message) });
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) return yield* failed(sourceText("error.agent.gone"));
    if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
    if (!this.#profileClients.hasSpare()) return yield* failed(sourceText("error.agent.webSearchBusy"));
    yield* this.#providers.ensureProvider("codex").pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => logger.warn("Codex is not ready for a web search.", { agentId, error: failure })),
      ),
      Effect.mapError(() => failed(sourceText("error.agent.webSearchSignIn"))),
    );
    if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
    if (!this.#profileClients.hasSpare()) return yield* failed(sourceText("error.agent.webSearchBusy"));
    const model = this.#sideCodexModel();
    if (!model) return yield* failed(sourceText("error.provider.noModel"));
    const client = yield* Effect.try({
      try: () => this.#providers.createProfileClient("codex"),
      catch: () => failed(sourceText("error.agent.webSearchSignIn")),
    });
    return yield* this.#profileClients
      .run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          model,
          query,
          cancelled,
          sideSessionUsageObserver("web-search", this.#store.database.usage, agent.id, "codex", model.id),
          "webSearch",
        ),
      )
      .pipe(
        Effect.tapError((failure) =>
          Effect.sync(() => logger.warn("Could not search the web.", { agentId, error: failure.cause })),
        ),
        Effect.mapError((failure) =>
          failed(
            failure instanceof GenerationUsageLimitError
              ? sourceText("error.provider.usageLimitReached")
              : sourceText("error.agent.webSearchFailed"),
          ),
        ),
      );
  }).bind(this);

  #liveVoiceReply(agentId: string, deliveryId: string): LiveVoiceReply | null {
    const delivery = this.#mailbox.getDelivery(deliveryId)?.delivery;
    if (!delivery) return { success: false, text: "The user removed the request." };
    switch (delivery.status) {
      case "queued":
      case "starting":
      case "running":
        return null;
      case "cancelled":
        return { success: false, text: "The user cancelled the request." };
      case "interrupted":
        return { success: false, text: "The user stopped the agent before it finished." };
      case "failed":
        return { success: false, text: delivery.error ?? "The agent could not finish the request." };
      case "completed": {
        const turnId = delivery.turnId;
        const answer = turnId ? this.#turnAnswer(agentId, turnId) : null;
        return {
          success: true,
          text: answer ?? "The agent finished and gave no answer.",
          ...(turnId ? { turnId } : {}),
        };
      }
    }
  }

  #turnAnswer(agentId: string, turnId: string, threadId?: string): string | null {
    const ofTurn = (messages: readonly ConversationMessage[]) =>
      messages.filter((message) => message.turnId === turnId);
    const snapshot = threadId
      ? this.#conversation.loadedExecutionSnapshot(threadId)
      : this.#conversation.loadedSnapshot(agentId);
    const loaded = ofTurn(snapshot?.messages ?? []);
    const messages = loaded.length > 0 ? loaded : this.#store.database.readTurnAssistantMessages(agentId, turnId);
    return messages.findLast(isAnswer)?.text ?? null;
  }

  readonly #liveVoiceSummary = Effect.fn("AgentService.liveVoiceSummary")(function* (
    this: AgentService,
    agentId: string,
    prompt: string,
  ) {
    const failed = (message: string) => ({ cause: new Error(message) });
    if (this.#stopping || !this.#profileClients.hasSpare()) return yield* Effect.fail(failed("No generation slot."));
    yield* this.#providers.ensureProvider("codex").pipe(Effect.mapError((failure) => ({ cause: failure })));
    if (this.#stopping || !this.#profileClients.hasSpare()) return yield* Effect.fail(failed("No generation slot."));
    const model = this.#sideCodexModel();
    if (!model) return yield* Effect.fail(failed("No Codex model."));
    const agent = this.#store.get(agentId);
    const client = yield* Effect.try({
      try: () => this.#providers.createProfileClient("codex", this.#liveVoiceAccountId(agent)),
      catch: (cause) => ({ cause }),
    });
    return yield* this.#profileClients
      .run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          model,
          prompt,
          cancelled,
          sideSessionUsageObserver("voice-summary", this.#store.database.usage, agentId, "codex", model.id),
        ),
      )
      .pipe(Effect.mapError((failure) => ({ cause: failure.cause })));
  }).bind(this);

  prepareVoiceRecording(audio: Uint8Array): Effect.Effect<DraftAttachment[], AgentLifecycleFailed> {
    return this.#mailbox
      .prepareImportedAttachments([], [{ name: "voice.webm", mimeType: "audio/webm", bytes: audio }], {
        voiceRecording: true,
      })
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "prepareVoiceRecording", cause: failure.cause }),
        ),
      );
  }

  discardDraftAttachment(id: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#mailbox
      .discardDraft(id)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "discardDraftAttachment", cause: failure.cause }),
        ),
      );
  }

  listQueue(agentId: string): QueueSnapshot {
    return this.#mailboxSync.queueSnapshot(agentId);
  }

  listActiveQueues(agentIds: readonly string[]): QueueSnapshot[] {
    return this.#mailbox
      .listActiveQueues(agentIds, this.#turn.failedTurns())
      .map((queue) => this.#mailboxSync.withHold(queue));
  }

  #emitProviderQueues(provider: AgentProvider): void {
    for (const agent of this.#store.list())
      if (providerForAgent(agent) === provider && this.#mailbox.queuedDeliveryIds(agent.id).length)
        this.#mailboxSync.emitQueue(agent.id);
  }

  #providerRestartHold(agentId: string): QueueHold | null {
    const agent = this.#store.get(agentId);
    const provider = agent ? providerForAgent(agent) : null;
    return provider && (this.#providers.isReplacingCli(provider) || this.#drain.awaitsEndpointReload(agentId))
      ? { reason: "provider-restart", provider }
      : null;
  }

  #signInHold(agentId: string): QueueHold | null {
    const agent = this.#store.get(agentId);
    if (!agent || this.#drain.ownChatHold(agentId) !== "sign-in") return null;
    return { reason: "sign-in", provider: providerForAgent(agent) };
  }

  #providerStatusChanged(status: AgentStatus): void {
    this.signInWaits.statusChanged(status);
    const providers = status.providers ?? [];
    const signIn = new Set(providers.flatMap((entry) => (entry.state === "sign-in-required" ? [entry.id] : [])));
    const changed = [...signIn, ...this.#signInProviders].filter(
      (provider) => signIn.has(provider) !== this.#signInProviders.has(provider),
    );
    this.#signInProviders = signIn;
    for (const provider of changed)
      if (!signIn.has(provider))
        Effect.runFork(this.#usageLimits.credentialChanged(provider, null).pipe(Effect.forkIn(this.#scope)));
    if (changed.length > 0)
      queueMicrotask(() => {
        for (const provider of changed) this.#emitProviderQueues(provider);
      });
  }

  listWaits(agentId: string): AgentWaitsSnapshot {
    return this.#waits.list(agentId);
  }

  cancelWait(agentId: string, waitId: string): void {
    this.#waits.cancel(agentId, waitId);
  }

  listTasks(agentId: string): AgentTasksSnapshot {
    return this.#tasks.snapshot(agentId);
  }

  listArchivedTasks(input: ListArchivedAgentTasksInput): ArchivedAgentTasksPage {
    return this.#tasks.archivedPage(input.agentId, input.before);
  }

  readTask(agentId: string, taskId: string): ConversationSnapshot {
    return structuredClone(this.#tasks.read(agentId, taskId));
  }

  readTaskPage(input: ReadAgentTaskPageInput, exclusions: ConversationMarkerExclusions = {}): AgentTaskPage {
    const { threadId } = this.#tasks.require(input.agentId, input.taskId);
    const database = this.#store.database;
    const none = (hasOlder: boolean): AgentTaskPage => ({
      conversation: { agentId: input.agentId, threadId, activeTurnId: null, revision: 0, messages: [] },
      hasOlder,
    });
    if (input.limit === 0)
      return none(database.conversationCountBefore(threadId, input.beforeMessageId, exclusions) > 0);
    const cursor = database.conversationCursorAt(threadId, input.beforeMessageId);
    if (!cursor) return none(false);
    const page = database.readConversationPage(
      input.agentId,
      threadId,
      { type: "before", cursor },
      input.limit,
      exclusions,
    );
    return {
      conversation: {
        agentId: input.agentId,
        threadId,
        activeTurnId: page.activeTurnId,
        revision: page.revision,
        messages: page.messages,
      },
      hasOlder: page.pageInfo.hasOlder,
    };
  }

  readTaskAround(input: ReadAgentTaskAroundInput, exclusions: ConversationMarkerExclusions = {}): AgentTaskWindow {
    const { threadId } = this.#tasks.require(input.agentId, input.taskId);
    const database = this.#store.database;
    const page = database.readConversationPage(
      input.agentId,
      threadId,
      { type: "around", messageId: input.messageId },
      input.limit,
      exclusions,
    );
    const last = page.messages.at(-1);
    return {
      conversation: {
        agentId: input.agentId,
        threadId,
        activeTurnId: page.activeTurnId,
        revision: page.revision,
        messages: page.messages,
      },
      hasOlder: page.pageInfo.hasOlder,
      hasNewer: last ? database.conversationHasAfter(threadId, last.id, exclusions) : false,
    };
  }

  readonly startTask = Effect.fn("AgentService.startTask")(function* (
    this: AgentService,
    input: StartAgentTaskInput,
    sender?: ConversationMessageSender,
    timezone?: string,
    fromChrome = false,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed> {
    if (!input.clientMessageId) return yield* this.#startTask(input, sender, timezone, fromChrome);
    const key = userSendKey(sender, input.agentId, input.clientMessageId);
    const pending = this.#pendingTaskStarts.get(key);
    if (pending) return yield* Deferred.await(pending);
    const startedTaskId = this.#mailbox.taskIdForKey(key);
    if (startedTaskId && this.#tasks.has(input.agentId, startedTaskId))
      return this.#tasks.publicTask(this.#tasks.require(input.agentId, startedTaskId));
    if (startedTaskId) this.#mailbox.forgetIdempotencyKey(key);
    const start = Deferred.makeUnsafe<AgentTask, AgentLifecycleFailed>();
    this.#pendingTaskStarts.set(key, start);
    return yield* this.#startTask(input, sender, timezone, fromChrome).pipe(
      Effect.onExit((exit) => Deferred.done(start, exit)),
      Effect.ensuring(Effect.sync(() => this.#pendingTaskStarts.delete(key))),
    );
  }).bind(this);

  readonly #startTask = Effect.fn("AgentService.startNewTask")(function* (
    this: AgentService,
    input: StartAgentTaskInput,
    sender: ConversationMessageSender | undefined,
    timezone: string | undefined,
    fromChrome: boolean,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed> {
    const task = yield* lifecycleStep("start task", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId))
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
      const firstDraft = input.attachmentDraftIds?.[0];
      const titleText = input.text.trim() || (firstDraft ? (this.#mailbox.draftName(firstDraft) ?? "") : "");
      return this.#tasks.create(input.agentId, titleText, "user");
    });
    this.#tasks.changed(task.agentId);
    yield* this.sendMessage(
      {
        agentId: task.agentId,
        taskId: task.taskId,
        text: input.text,
        ...(input.attachmentDraftIds ? { attachmentDraftIds: input.attachmentDraftIds } : {}),
        ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      },
      sender,
      timezone,
      fromChrome,
    ).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          this.#tasks.discard(task);
          this.#tasks.changed(task.agentId);
        }),
      ),
    );
    return this.#tasks.publicTask(task);
  }).bind(this);

  readonly runQueuedMessageAsTask = Effect.fn("AgentService.runQueuedMessageAsTask")(function* (
    this: AgentService,
    input: RunQueuedMessageAsTaskInput,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed> {
    const context = yield* lifecycleStep("find queued message", () => {
      if (this.channels.store.assignmentForDelivery(input.deliveryId))
        throw new Error(sourceText("error.backend.useChannelTaskControls"));
      const found = this.#mailbox.getDelivery(input.deliveryId);
      if (!found || found.delivery.recipientAgentId !== input.agentId || found.delivery.status !== "queued")
        throw new Error(sourceText("error.backend.queuedMessageUnavailable"));
      return found;
    });
    const task = yield* lifecycleStep("create task", () =>
      this.#tasks.create(input.agentId, context.delivery.text, "user"),
    );
    yield* this.#mailbox.moveToTask(input.agentId, input.deliveryId, task.taskId).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "move queued message", cause: failure.cause }),
      ),
      Effect.tapError(() => Effect.sync(() => this.#tasks.discard(task))),
    );
    const agent = this.#store.get(input.agentId);
    if (agent) {
      const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
      snapshot.messages = snapshot.messages.filter((message) => message.id !== input.deliveryId);
      this.#conversation.emitConversation(snapshot, "queue.message-moved-to-task", { deliveryId: input.deliveryId });
    }
    this.#mailboxSync.emitQueue(input.agentId);
    this.#tasks.changed(input.agentId);
    this.#drain.scheduleDrain(input.agentId);
    return this.#tasks.publicTask(task);
  }).bind(this);

  readonly branchTask = Effect.fn("AgentService.branchTask")(function* (
    this: AgentService,
    input: BranchAgentTaskInput,
    readerId: string,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed | AgentTaskBranchFailed> {
    yield* lifecycleStep("find agent", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId))
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
    });
    const task = yield* this.#tasks.branch(input);
    const through = task.branch?.throughMessageId;
    if (through)
      yield* lifecycleStep("mark branch read", () => this.#reader.markThreadRead(readerId, task.threadId, through));
    this.#tasks.changed(task.agentId);
    return this.#tasks.publicTask(task);
  }).bind(this);

  #returnTaskAnswers(task: { agentId: string; taskId: string }): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#mailbox.returnTaskAnswers(task.agentId, task.taskId).pipe(
      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "return answers", cause: failure.cause })),
      Effect.flatMap((moved) =>
        moved === 0
          ? Effect.void
          : Effect.sync(() => {
              this.#mailboxSync.emitQueue(task.agentId);
              this.#drain.scheduleDrain(task.agentId);
            }),
      ),
    );
  }

  stopTask(input: AgentTaskInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#stopTask(input, true);
  }

  readonly #stopTask = Effect.fn("AgentService.stopTask")(function* (
    this: AgentService,
    input: AgentTaskInput,
    byUser: boolean,
  ): Effect.fn.Return<void, AgentLifecycleFailed> {
    const task = yield* lifecycleStep("find task", () => this.#tasks.require(input.agentId, input.taskId));
    yield* this.#drain.endPlanContinuation(task.agentId, task.taskId);
    for (const message of this.#mailbox.queuedTaskMessages(task.agentId, task.taskId, { teammateAnswers: false }))
      yield* this.cancelQueuedMessage(task.agentId, message.deliveryId);
    const turnId = this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId;
    if (turnId) {
      this.#tasks.markStopped(task.taskId, turnId, byUser);
      yield* this.#steerAfterFailedStop(
        task.agentId,
        task.taskId,
        turnId,
        this.#interruptTurn(task.agentId, turnId, task.threadId),
      );
    } else if (byUser) yield* this.#tasks.releaseAfterLostWork(task.taskId);
    this.#tasks.changed(task.agentId);
  }).bind(this);

  readonly closeTask = Effect.fn("AgentService.closeTask")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ): Effect.fn.Return<void, AgentLifecycleFailed> {
    const running = yield* lifecycleStep("find task", () => {
      const found = this.#tasks.require(input.agentId, input.taskId);
      return this.#conversation.loadedExecutionSnapshot(found.threadId)?.activeTurnId
        ? this.#tasks.turnEnd(found.taskId)
        : null;
    });
    yield* this.#returnTaskAnswers(input);
    yield* this.#stopTask(input, false);
    if (running) yield* running.pipe(Effect.timeoutOption(TASK_STOP_WAIT_MS));
    yield* this.#returnTaskAnswers(input);
    const task = yield* lifecycleStep("find task", () => {
      const found = this.#tasks.require(input.agentId, input.taskId);
      if (this.#mailbox.taskBusy(found.agentId, found.taskId))
        throw new Error(sourceText("error.backend.threadStillRunning"));
      return found;
    });
    this.#tasks.close(task);
    yield* this.#tasks.releaseHeldRequests(task);
    this.#attention.expireDetached(task.agentId, task.threadId);
    yield* this.#memoryReview.threadClosed(task.agentId, task.threadId);
    this.#drain.scheduleDrain(task.agentId);
  }).bind(this);

  reopenTask(input: AgentTaskInput): void {
    this.#tasks.reopen(this.#tasks.require(input.agentId, input.taskId));
    this.#drain.scheduleDrain(input.agentId);
  }

  renameTask(input: AgentTaskInput, title: string): void {
    this.#tasks.rename(this.#tasks.require(input.agentId, input.taskId), title);
  }

  listTaskReads(agentId: string, memberId: string, options?: ConversationMarkerExclusions): AgentTaskReadState[] {
    return this.#tasks
      .snapshot(agentId)
      .tasks.filter((task) => task.state !== "closed")
      .slice(0, AGENT_THREAD_READS_LIMIT)
      .map((task) => ({ taskId: task.id, ...this.#reader.readThread(memberId, task.threadId, options) }));
  }

  markTaskRead(
    input: MarkAgentTaskReadInput,
    memberId: string,
    options?: ConversationMarkerExclusions,
  ): AgentTaskReadState {
    const task = this.#tasks.require(input.agentId, input.taskId);
    return {
      taskId: task.taskId,
      ...this.#reader.markThreadRead(memberId, task.threadId, input.throughMessageId, options),
    };
  }

  readonly deleteTask = Effect.fn("AgentService.deleteTask")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ): Effect.fn.Return<void, AgentLifecycleFailed> {
    const { task, wasOpen } = yield* lifecycleStep("archive task", () => {
      const found = this.#tasks.require(input.agentId, input.taskId);
      if (this.#conversation.loadedExecutionSnapshot(found.threadId)?.activeTurnId)
        throw new Error(sourceText("error.backend.threadStillRunning"));
      const wasOpen = found.closedAt === null;
      if (wasOpen) this.#tasks.close(found);
      return { task: found, wasOpen };
    });
    this.#attention.expireDetached(task.agentId, task.threadId);
    yield* this.#memoryReview.forgetThread(task.agentId, task.threadId);
    yield* this.#returnTaskAnswers(task);
    for (const message of this.#mailbox.queuedTaskMessages(task.agentId, task.taskId))
      yield* this.cancelQueuedMessage(task.agentId, message.deliveryId);
    yield* lifecycleStep("check task", () => {
      if (!this.#mailbox.taskBusy(task.agentId, task.taskId)) return;
      if (wasOpen) this.#tasks.reopen(task);
      throw new Error(sourceText("error.backend.threadStillRunning"));
    });
    yield* this.#tasks.releaseHeldRequests(task);
    yield* this.#mailbox
      .deleteTaskMessages(task.agentId, task.taskId)
      .pipe(Effect.mapError(({ cause }) => new AgentLifecycleFailed({ operation: "delete task messages", cause })));
    yield* lifecycleStep("check task", () => {
      if (this.#mailbox.taskBusy(task.agentId, task.taskId))
        throw new Error(sourceText("error.backend.threadStillRunning"));
    });
    yield* this.#forgetExecutionThread(task.threadId);
    yield* lifecycleStep("delete task", () => {
      if (this.#mailbox.taskBusy(task.agentId, task.taskId))
        throw new Error(sourceText("error.backend.threadStillRunning"));
      this.#tasks.delete(task);
    });
    this.#messagePins.messagesDeleted(task.agentId);
    this.#browser.unshareThread(task.threadId);
    this.#drain.scheduleDrain(task.agentId);
  }).bind(this);

  deleteConversationMessage(
    input: DeleteConversationMessageInput,
    access: MessageDeleteAccess,
  ): Effect.Effect<void, MessageDeleteRefused | AgentLifecycleFailed> {
    return this.#messageDeletion.delete(input, access).pipe(
      Effect.tap(() => Effect.sync(() => this.#messagePins.messagesDeleted(input.agentId))),
      Effect.catchTag("StoredStateFailure", ({ cause }) =>
        Effect.fail(new AgentLifecycleFailed({ operation: "deleteConversationMessage", cause })),
      ),
    );
  }

  withdrawFeedback(input: WithdrawFeedbackInput): Effect.Effect<WithdrawFeedbackResult, AgentLifecycleFailed> {
    return this.#feedbackWithdrawal.withdrawCard(input).pipe(
      Effect.map(({ status }) => ({ status })),
      Effect.catchTags({
        StoredStateFailure: ({ cause }) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "withdrawFeedback", cause })),
        ToolOperationFailed: ({ cause }) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "withdrawFeedback", cause })),
      }),
    );
  }

  listPinnedMessages(agentId: string): PinnedMessagesSnapshot {
    return this.#messagePins.list(agentId);
  }

  setMessagePinned(
    input: SetMessagePinnedInput,
    pinner: Extract<MessagePinner, { kind: "person" }>,
  ): Effect.Effect<PinnedMessagesSnapshot, MessagePinRefused | AgentLifecycleFailed> {
    return this.#messagePins
      .set(input, pinner)
      .pipe(
        Effect.catchTag("StoredStateFailure", ({ cause }) =>
          Effect.fail(new AgentLifecycleFailed({ operation: "setMessagePinned", cause })),
        ),
      );
  }

  acknowledgeFailedTurn(agentId: string, turnId: string): void {
    this.#turn.acknowledgeFailedTurn(agentId, turnId);
  }

  cancelQueuedMessage(agentId: string, deliveryId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#queue
      .cancel(agentId, deliveryId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "cancelQueuedMessage", cause: failure.cause }),
        ),
      );
  }

  #requeueChannelDelivery(deliveryId: string, continueWork = false): Effect.Effect<boolean> {
    return this.channels.requeueForLimit(deliveryId, continueWork);
  }

  readonly #settleHeldQueues = Effect.fn("AgentService.settleHeldQueues")(function* (
    this: AgentService,
    agentIds: readonly string[],
  ) {
    const failed = (failure: { readonly cause: unknown }) =>
      new AgentLifecycleFailed({ operation: "settleHeldQueues", cause: failure.cause });
    yield* this.channels.wake().pipe(Effect.mapError(failed));
    for (const agentId of agentIds) {
      for (const deliveryId of this.#mailbox.queuedDeliveryIds(agentId)) {
        if (
          !this.channels.store.assignmentForDelivery(deliveryId) ||
          !(yield* this.#requeueChannelDelivery(deliveryId))
        )
          continue;
        yield* this.#mailbox.cancel(agentId, deliveryId).pipe(Effect.mapError(failed));
        this.#mailboxSync.emitQueue(agentId);
      }
      const skipped = new Set(
        this.#routines
          .listRecordsFor(agentId)
          .filter((routine) => routine.limitPolicy === "skip")
          .map((routine) => routine.id),
      );
      if (skipped.size === 0) continue;
      for (const delivery of [...this.listQueue(agentId).deliveries, ...this.#mailbox.taskRoutineDeliveries(agentId)]) {
        if (delivery.status !== "queued" || delivery.sender.kind !== "routine") continue;
        if (skipped.has(delivery.sender.routineId))
          yield* this.#queue.cancel(agentId, delivery.id).pipe(Effect.mapError(failed));
      }
    }
  });

  editQueuedMessage(
    agentId: string,
    input: QueueEditRequest,
    sender?: ConversationMessageSender,
  ): Effect.Effect<QueueSnapshot, AgentLifecycleFailed> {
    return this.#queue
      .edit(agentId, input, sender)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "editQueuedMessage", cause: failure.cause }),
        ),
      );
  }

  updateQueuedMessage(
    input: UpdateQueuedMessageInput,
    sender?: ConversationMessageSender,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#queue
      .update(input, sender)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "updateQueuedMessage", cause: failure.cause }),
        ),
      );
  }

  reorderQueue(input: ReorderQueueInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#queue
      .reorder(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "reorderQueue", cause: failure.cause })),
      );
  }

  steerQueuedMessage(input: SteerQueuedMessageInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#queue
      .steer(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "steerQueuedMessage", cause: failure.cause }),
        ),
      );
  }

  readonly sendMessage = Effect.fn("AgentService.sendMessage")(function* (
    this: AgentService,
    input: SendMessageInput,
    sender?: ConversationMessageSender,
    timezone?: string,
    fromChrome = false,
  ): Effect.fn.Return<QueuedMessageReceipt, AgentLifecycleFailed> {
    const receipt = yield* this.#sendMessageOnce(input, sender, timezone);
    if (fromChrome) this.#noteFromChrome(receipt.deliveries.map((delivery) => delivery.id));
    return receipt;
  }).bind(this);

  #noteFromChrome(deliveryIds: readonly string[]): void {
    for (const deliveryId of deliveryIds) this.#fromChrome.add(deliveryId);
    for (const deliveryId of this.#fromChrome) {
      if (this.#fromChrome.size <= FROM_CHROME_LIMIT) break;
      this.#fromChrome.delete(deliveryId);
    }
  }

  readonly #sendMessageOnce = Effect.fn("AgentService.sendMessageOnce")(function* (
    this: AgentService,
    input: SendMessageInput,
    sender: ConversationMessageSender | undefined,
    timezone: string | undefined,
  ): Effect.fn.Return<QueuedMessageReceipt, AgentLifecycleFailed> {
    if (!input.clientMessageId) return yield* this.#sendUserMessage(input, sender, timezone);
    const idempotencyKey = userSendKey(sender, input.agentId, input.clientMessageId);
    this.#mailbox.forgetIdempotencyKeys("user-send:", new Date(Date.now() - USER_SEND_RETRY_WINDOW_MS));
    const stored = this.#mailbox.receiptForKey(idempotencyKey);
    if (stored) return stored;
    const pending = this.#pendingUserSends.get(idempotencyKey);
    if (pending) return yield* Deferred.await(pending);
    const send = Deferred.makeUnsafe<QueuedMessageReceipt, AgentLifecycleFailed>();
    this.#pendingUserSends.set(idempotencyKey, send);
    return yield* this.#sendUserMessage(input, sender, timezone, idempotencyKey).pipe(
      Effect.onExit((exit) => Deferred.done(send, exit)),
      Effect.ensuring(Effect.sync(() => this.#pendingUserSends.delete(idempotencyKey))),
    );
  }).bind(this);

  readonly #sendUserMessage = Effect.fn("AgentService.sendUserMessage")(function* (
    this: AgentService,
    input: SendMessageInput,
    sender: ConversationMessageSender | undefined,
    timezone: string | undefined,
    idempotencyKey?: string,
    welcome = false,
    agentSetup = false,
    relayed?: LiveVoiceRelayed,
    lateAnswer = false,
  ) {
    const validateRecipient = yield* lifecycleStep("prepare message delivery", () =>
      this.#mailbox.prepareDelivery([input.agentId]),
    );
    if (this.#duplication.isPending(input.agentId))
      return yield* new AgentLifecycleFailed({
        operation: "send message",
        cause: new Error(sourceText("error.agent.unknown", { id: input.agentId })),
      });
    const agent = yield* this.#store
      .getOrCreate(input.agentId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "load message agent", cause: failure.cause }),
        ),
      );
    const provider = providerForAgent(agent);
    yield* this.#providers.ensureProvider(provider).pipe(
      Effect.catchIf(
        (failure) =>
          this.#providers.signInRecheckPending(provider) &&
          this.#providers.signInRequired(provider) &&
          failure.cause instanceof Error &&
          failure.cause.message ===
            this.#providers.status().providers?.find((status) => status.id === provider)?.message,
        () => Effect.void,
      ),
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "ensure message provider", cause: failure.cause }),
      ),
    );
    yield* lifecycleStep("validate message recipient", validateRecipient);
    const taskId = input.taskId;
    const task = taskId
      ? yield* lifecycleStep("find message task", () => this.#tasks.requireOpen(agent.id, taskId))
      : null;
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "user" },
        ...(sender ? { senderMember: sender } : {}),
        ...(task ? { taskId: task.taskId } : {}),
        recipientAgentIds: [agent.id],
        text: input.text,
        draftIds: input.attachmentDraftIds ?? [],
        ...(input.voiceRecordingDraftId ? { voiceRecordingDraftId: input.voiceRecordingDraftId } : {}),
        replyToMessageId: input.replyToMessageId ?? null,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(welcome ? { welcome } : {}),
        ...(agentSetup ? { agentSetup } : {}),
      })
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "enqueue message", cause: failure.cause })),
      );
    const [queued] = receipt.deliveries;
    const delivery = queued ? this.#mailbox.getDelivery(queued.id) : null;
    if (!delivery)
      return yield* new AgentLifecycleFailed({
        operation: "send message",
        cause: new Error(sourceText("error.agent.queuedMessageCreateFailed")),
      });
    if (relayed) {
      this.#liveVoiceRelayed.set(delivery.delivery.id, relayed);
      for (const deliveryId of this.#liveVoiceRelayed.keys()) {
        if (this.#liveVoiceRelayed.size <= LIVE_VOICE_RELAYED_LIMIT) break;
        this.#liveVoiceRelayed.delete(deliveryId);
      }
    }
    if (task && this.#tasks.threadId(task.taskId) === null) {
      yield* this.cancelQueuedMessage(agent.id, delivery.delivery.id);
      if (idempotencyKey) this.#mailbox.forgetIdempotencyKey(idempotencyKey);
      return yield* new AgentLifecycleFailed({
        operation: "send message",
        cause: new Error(sourceText("error.backend.threadArchived")),
      });
    }
    if (timezone !== undefined) this.#routines.noteDeliveryTimezone(delivery.delivery.id, timezone);
    const targetThreadId = task?.threadId ?? agent.threadId;
    const snapshot = this.#conversation.ensureSnapshot(agent.id, targetThreadId);
    if (!task) this.#mailboxSync.syncMailboxMessages(snapshot);
    if (!task && !welcome)
      yield* this.#store
        .updatePreview(
          agent.id,
          displayMessageReferences(
            delivery.delivery.text,
            delivery.delivery.attachments,
            agentNamesById(this.#store.list()),
            { fileHeadings: false },
          ) || delivery.delivery.attachments.map((item) => item.name).join(", "),
        )
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#emitError("message_preview_failed", failure.cause, agent.id)),
          ),
        );
    const waitingTurnId = snapshot.activeTurnId;
    const releaseQuestions = Effect.sync(() => {
      if (!targetThreadId) return;
      if (!welcome && !agentSetup && !lateAnswer) this.#attention.closeDetachedForUserMessage(agent.id, targetThreadId);
      if (waitingTurnId && !this.#stopHolds(agent.id, task?.taskId ?? null, waitingTurnId))
        this.#attention.releaseForUserMessage(agent.id, targetThreadId, waitingTurnId);
    });
    const steerFirst = providerForAgent(agent) === "claude";
    if (!steerFirst) yield* releaseQuestions;
    yield* this.#steerWhenBusy(
      agent,
      task,
      snapshot,
      delivery.delivery.id,
      true,
      false,
      steerFirst ? releaseQuestions : Effect.void,
    );
    if (!task) {
      this.#emit({ type: "agents-changed", agents: this.listAgents() });
      this.#conversation.emitConversation(snapshot);
    }
    this.#mailboxSync.emitQueue(agent.id);
    this.#usageLimits.retry(agent.id);
    this.#drain.scheduleDrain(agent.id);
    return receipt;
  }, Effect.uninterruptible).bind(this);

  #tagReferences(agentId: string, threadId: string | null): TagReferenceSource {
    return {
      tab: (tabId) => {
        if (threadId) this.#browser.shareTab(tabId, { agentId, threadId });
        return this.#browser.agentTab(tabId, agentId);
      },
      thread: (taskId) => {
        if (!this.#tasks.has(agentId, taskId)) return null;
        const task = this.#tasks.publicTask(this.#tasks.require(agentId, taskId));
        const redact = (text: string | null | undefined) => (text ? this.#mcp.redact(text) : null);
        if (task.state === "running") return { title: task.title, state: "working", detail: redact(task.progress) };
        if (task.state === "queued") return { title: task.title, state: "queued", detail: null };
        if (task.outcome === "failed") return { title: task.title, state: "failed", detail: redact(task.error) };
        if (task.outcome === null) return { title: task.title, state: "idle", detail: null };
        const answer = this.#store.database.readAgentHistory(agentId, task.threadId, { author: "assistant", limit: 1 })
          .messages[0]?.message.text;
        return { title: task.title, state: task.outcome === "completed" ? "done" : "stopped", detail: redact(answer) };
      },
    };
  }

  #stoppedTurn(agentId: string, taskId: string | null): string | null {
    return taskId === null ? (this.#stoppedTurns.get(agentId) ?? null) : this.#tasks.stoppedTurn(taskId);
  }

  readonly #steerWhenBusy = Effect.fn("AgentService.steerWhenBusy")(function* (
    this: AgentService,
    agent: AgentSummary,
    task: Pick<AgentThreadRecord, "taskId" | "threadId"> | null,
    snapshot: ConversationSnapshot,
    deliveryId: string,
    explain: boolean,
    wait: boolean,
    afterSteer: Effect.Effect<void> = Effect.void,
  ): Effect.fn.Return<AgentMessageSteer> {
    const notSteered = <Reason extends AgentMessageSteer>(reason: Reason) => afterSteer.pipe(Effect.as(reason));
    const steerTurnId = this.#turnToSteer(agent.id, task?.taskId ?? null, snapshot);
    const steers = (agent.busyMessageMode ?? this.#busyMessageMode()) === "steer";
    if (!steerTurnId) {
      if (
        explain &&
        steers &&
        snapshot.activeTurnId === null &&
        snapshot.threadId &&
        this.#mailbox.laneActive(agent.id, task?.taskId ?? null)
      )
        this.#steersAfterTurnStart.set(deliveryId, {
          agentId: agent.id,
          taskId: task?.taskId ?? null,
          threadId: snapshot.threadId,
        });
      return yield* notSteered(null);
    }
    const model = this.#drain.modelForTurn(agent.id, steerTurnId) ?? agent.model;
    if (!agentSteersTurns({ provider: providerForAgent(agent), model }, this.#endpoints.available())) {
      if (explain && steers) yield* this.#markSteerFallback(agent.id, deliveryId, "provider-unsupported");
      return yield* notSteered("provider-unsupported");
    }
    if (this.#routineRunsIn(agent, task?.threadId ?? null)) {
      if (explain && steers) yield* this.#markSteerFallback(agent.id, deliveryId, "steer-failed");
      return yield* notSteered("routine-run");
    }
    if (!steers) return yield* notSteered("recipient-queues");
    const steer = this.#steerSentMessage(
      agent,
      snapshot.threadId ?? agent.threadId,
      deliveryId,
      steerTurnId,
      explain,
    ).pipe(Effect.ensuring(afterSteer));
    if (wait) return yield* steer;
    yield* steer.pipe(Effect.forkIn(this.#scope));
    return null;
  });

  #turnToSteer(agentId: string, taskId: string | null, snapshot: ConversationSnapshot): string | null {
    const turnId = snapshot.activeTurnId;
    return turnId !== null && !this.#stopHolds(agentId, taskId, turnId) ? turnId : null;
  }

  #stopHolds(agentId: string, taskId: string | null, turnId: string): boolean {
    return turnId === this.#stoppedTurn(agentId, taskId) && this.#failedStops.get(stopKey(agentId, taskId)) !== turnId;
  }

  #steerAfterFailedStop<E>(
    agentId: string,
    taskId: string | null,
    turnId: string,
    stop: Effect.Effect<boolean, E>,
  ): Effect.Effect<boolean, E> {
    const key = stopKey(agentId, taskId);
    return Effect.suspend(() => {
      this.#failedStops.delete(key);
      return stop.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (!Exit.isSuccess(exit) || !exit.value) this.#failedStops.set(key, turnId);
          }),
        ),
      );
    });
  }

  #steerAfterTurnStart(agentId: string, threadId: string): void {
    const waiting: Array<{ deliveryId: string; taskId: string | null }> = [];
    for (const [deliveryId, pending] of this.#steersAfterTurnStart) {
      const delivery = this.#mailbox.getDelivery(deliveryId)?.delivery;
      if (delivery?.status !== "queued" || delivery.steerFallback) this.#steersAfterTurnStart.delete(deliveryId);
      else if (pending.agentId === agentId && pending.threadId === threadId) {
        this.#steersAfterTurnStart.delete(deliveryId);
        waiting.push({ deliveryId, taskId: pending.taskId });
      }
    }
    if (waiting.length === 0 || this.#scope.state._tag === "Closed") return;
    Effect.runFork(
      Effect.forEach(
        waiting,
        ({ deliveryId, taskId }) => this.#steerStartedTurn(agentId, threadId, deliveryId, taskId),
        {
          discard: true,
        },
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => this.#emitError("message_steer_failed", Cause.squash(cause), agentId)),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  readonly #steerStartedTurn = Effect.fn("AgentService.steerStartedTurn")(function* (
    this: AgentService,
    agentId: string,
    threadId: string,
    deliveryId: string,
    taskId: string | null,
  ) {
    const agent = this.#store.get(agentId);
    const delivery = this.#mailbox.getDelivery(deliveryId)?.delivery;
    if (!agent || delivery?.status !== "queued" || delivery.steerFallback) return;
    const task = taskId === null ? null : this.#runningTask(agentId, taskId);
    if (taskId !== null && !task) return;
    const snapshot = task?.snapshot ?? this.#conversation.ensureSnapshot(agentId, threadId);
    if (snapshot.activeTurnId === null) return;
    yield* this.#steerWhenBusy(agent, task, snapshot, deliveryId, true, true);
  });

  #returnChannelResults(channelId: string): void {
    if (this.#scope.state._tag === "Closed") return;
    Effect.runFork(
      this.#channelRequestReturns.reconcile(channelId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => this.#emitError("channel_request_return_failed", Cause.squash(cause))),
        ),
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  #steerAgentMessage(recipientAgentId: string, deliveryId: string, wait: boolean): Effect.Effect<AgentMessageSteer> {
    const agent = this.#store.get(recipientAgentId);
    if (!agent || !this.#mailbox.joinsRunningTurn(deliveryId)) return Effect.succeed(null);
    const taskId = this.#mailbox.taskIdForDelivery(deliveryId);
    const task = taskId === null ? null : this.#runningTask(recipientAgentId, taskId);
    const snapshot = taskId === null ? this.#conversation.snapshotToUpdate(recipientAgentId) : task?.snapshot;
    if (!snapshot) return Effect.succeed(null);
    if (
      snapshot.activeTurnId &&
      (this.#personTurn(recipientAgentId, snapshot.activeTurnId, taskId) ||
        this.#noticeWaitsForQuietTurn(recipientAgentId, snapshot.activeTurnId, taskId, deliveryId))
    )
      return Effect.succeed(null);
    return this.#steerWhenBusy(agent, task, snapshot, deliveryId, false, wait);
  }

  #turnDeliveries(agentId: string, turnId: string, taskId: string | null) {
    const linked = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    return linked.length > 0 ? linked : this.#mailbox.startingDeliveriesForAgent(agentId, taskId);
  }

  #noticeWaitsForQuietTurn(agentId: string, turnId: string, taskId: string | null, deliveryId: string): boolean {
    const notice = this.#mailbox.getDelivery(deliveryId)?.delivery;
    const followsUpOwnAnswer: FollowsUpOwnAnswer = (delivery) => this.#mailbox.followsUpOwnAnswer(delivery);
    if (!notice || !quietTeammateDelivery(notice, followsUpOwnAnswer)) return false;
    const deliveries = this.#turnDeliveries(agentId, turnId, taskId);
    return (
      deliveries.length > 0 &&
      deliveries.every(({ delivery }) =>
        quietTeammateTurnDelivery(delivery, (request) => this.#mailbox.hasOwnReplyFrom(request.id), followsUpOwnAnswer),
      )
    );
  }

  #runningTask(
    agentId: string,
    taskId: string,
  ): { taskId: string; threadId: string; snapshot: ConversationSnapshot } | null {
    const threadId = this.#tasks.threadId(taskId);
    const snapshot =
      threadId === null
        ? undefined
        : this.#conversation.workingTaskSnapshots(agentId).find((candidate) => candidate.threadId === threadId);
    return threadId !== null && snapshot ? { taskId, threadId, snapshot } : null;
  }

  #personTurn(agentId: string, turnId: string, taskId: string | null): boolean {
    const deliveries = this.#turnDeliveries(agentId, turnId, taskId);
    return (
      deliveries.length > 0 &&
      deliveries.every(({ delivery }) => {
        if (delivery.sender.kind !== "user") return false;
        const member = this.#mailbox.senderMember(delivery.messageId);
        return member === undefined || !(this.channels.hooks.remotePerson?.(member.id) ?? false);
      })
    );
  }

  readonly #steerSentMessage = Effect.fn("AgentService.steerSentMessage")(function* (
    this: AgentService,
    agent: AgentSummary,
    threadId: string | null,
    deliveryId: string,
    turnId: string,
    explain: boolean,
  ): Effect.fn.Return<AgentMessageSteer> {
    return yield* this.#queue.steer({ agentId: agent.id, deliveryId, expectedTurnId: turnId }, true).pipe(
      Effect.as("steered" as const),
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          logger.warn("A message sent to steer the running turn waits in the queue.", {
            agentId: agent.id,
            error: failure.cause,
          });
          if (this.#conversation.ensureSnapshot(agent.id, threadId).activeTurnId !== turnId) return null;
          if (explain) {
            yield* this.#markSteerFallback(agent.id, deliveryId, "steer-failed");
            this.#mailboxSync.emitQueue(agent.id);
          }
          return "steer-failed" as const;
        }),
      ),
    );
  });

  #markSteerFallback(agentId: string, deliveryId: string, reason: QueueSteerFallback): Effect.Effect<void> {
    return this.#mailbox
      .markSteerFallback(deliveryId, reason)
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() =>
            logger.warn("Could not record why a message waits in the queue.", { agentId, error: failure.cause }),
          ),
        ),
      );
  }

  readonly setMessageReaction = Effect.fn("AgentService.setMessageReaction")(function* (
    this: AgentService,
    input: SetMessageReactionInput,
    sender?: ConversationMessageSender,
  ) {
    const agent = yield* this.#store
      .existing(input.agentId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "load reaction agent", cause: failure.cause }),
        ),
      );
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    if (!snapshot.messages.some((message) => message.id === input.messageId)) {
      const [message] = this.#store.database.readConversationMessages(agent.id, agent.threadId, [input.messageId]);
      if (message) snapshot.messages.push(message);
    }
    const message = snapshot.messages.find((candidate) => candidate.id === input.messageId);
    if (!message) {
      return yield* new AgentLifecycleFailed({
        operation: "set message reaction",
        cause: new Error(sourceText("error.agent.messageUnavailable")),
      });
    }
    const previous = this.#mailbox.reactionFor(agent.id, input.messageId);
    const answer =
      message.author === "assistant" && message.status === "completed" && input.emoji !== previous ? input.emoji : null;
    const saveReaction = (emoji: SetMessageReactionInput["emoji"]) =>
      this.#mailbox.setReaction(agent.id, input.messageId, { kind: "user" }, emoji).pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "set message reaction", cause: failure.cause }),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            this.#mailboxSync.syncMailboxMessages(snapshot);
            this.#conversation.emitConversation(snapshot);
          }),
        ),
      );
    yield* saveReaction(input.emoji);
    if (!answer) return;
    yield* this.#sendUserMessage(
      { agentId: agent.id, text: answer, replyToMessageId: input.messageId },
      sender,
      undefined,
    ).pipe(Effect.tapError(() => saveReaction(previous).pipe(Effect.ignore)));
  }, Effect.uninterruptible).bind(this);

  #deliveryThreadId(deliveryId: string): string | null {
    const assignment = this.channels.store.assignmentForDelivery(deliveryId);
    return assignment
      ? this.channels.store.context(assignment.channelId, assignment.agentId).threadId
      : (this.#tasks.threadForDelivery(deliveryId) ?? this.messaging.threadForDelivery(deliveryId));
  }

  interrupt(agentId: string, turnId: string, executionThreadId?: string): Effect.Effect<void, AgentLifecycleFailed> {
    return Effect.suspend(() => {
      if (!executionThreadId) this.#stoppedTurns.set(agentId, turnId);
      const taskId = executionThreadId ? this.#tasks.taskForThread(executionThreadId) : null;
      const endContinuation =
        executionThreadId && taskId === null ? Effect.void : this.#drain.endPlanContinuation(agentId, taskId);
      const stop = this.#interruptTurn(agentId, turnId, executionThreadId);
      return endContinuation.pipe(
        Effect.andThen(executionThreadId ? stop : this.#steerAfterFailedStop(agentId, null, turnId, stop)),
      );
    }).pipe(Effect.asVoid);
  }

  readonly #interruptTurn = Effect.fn("AgentService.interruptTurn")(function* (
    this: AgentService,
    agentId: string,
    turnId: string,
    executionThreadId?: string,
    mayStop?: () => boolean,
  ) {
    const agent = yield* this.#store
      .existing(agentId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "load interrupted agent", cause: failure.cause }),
        ),
      );
    const children = executionThreadId || mayStop ? [] : this.#turn.workingCodexChildren(agentId, turnId);
    if (children.length > 0 && this.#turn.turnStartedAt(turnId) === null) {
      const exits = yield* Effect.forEach(
        children,
        (child) =>
          Effect.exit(
            child.client.request(
              "turn/interrupt",
              { threadId: child.threadId, turnId: child.turnId },
              decodeRecordResponse,
            ),
          ),
        { concurrency: "unbounded" },
      );
      const failure = exits.every(Exit.isFailure) ? exits.find(Exit.isFailure) : undefined;
      if (failure) {
        return yield* new AgentLifecycleFailed({
          operation: "interrupt subagent turn",
          cause: Cause.squash(failure.cause),
        });
      }
      return true;
    }
    if (!mayStop && this.#turn.turnStartedAt(turnId) === null && !this.#turn.isCompleting(turnId)) {
      const owner = this.#conversation.snapshotWithTurn(agentId, turnId);
      if (!owner || this.#turn.hasEnded(turnId)) {
        const deliveries = yield* lifecycleStep("find interrupted deliveries", () =>
          this.#mailbox.findDeliveriesByTurn(agentId, turnId),
        );
        if (owner || deliveries.length > 0) {
          const firstDelivery = deliveries[0]?.delivery.id;
          const threadId =
            executionThreadId ?? owner?.threadId ?? (firstDelivery ? this.#deliveryThreadId(firstDelivery) : null);
          yield* this.#turn.settleOrphanedTurn(agentId, threadId, turnId, "interrupted");
          return true;
        }
      }
    }
    const client = yield* lifecycleStep("find interrupt provider", () =>
      this.#providers.requireReadyClientForAgent(agent),
    );
    const snapshot = [...this.#conversation.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,
    )?.[1];
    if (mayStop && (!snapshot || !mayStop())) return false;
    if (!executionThreadId && !snapshot) return false;
    const targetThreadId = executionThreadId ?? snapshot?.threadId;
    const session = this.#runningSession(agent, targetThreadId);
    if (!session) return false;
    this.#images.interrupt(agentId, session, turnId);
    const response = yield* client
      .request("turn/interrupt", { threadId: session, turnId }, decodeRecordResponse)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "interrupt turn", cause: failure.cause })),
      );
    if (!mayStop && response.turnActive === false && this.#turnRunsOnlyInSnapshot(agentId, turnId)) {
      logger.warn("Stop found a chat turn that its provider does not run. It ends as interrupted.", {
        agentId,
        turnId,
      });
      yield* this.#turn.settleOrphanedTurn(agentId, targetThreadId ?? null, turnId, "interrupted");
    }
    return true;
  }, Effect.uninterruptible);

  #turnRunsOnlyInSnapshot(agentId: string, turnId: string): boolean {
    return (
      this.#turn.turnStartedAt(turnId) === null &&
      !this.#turn.isCompleting(turnId) &&
      !this.#turn.hasEnded(turnId) &&
      this.#conversation.snapshotWithTurn(agentId, turnId) !== undefined
    );
  }

  readonly #endDroppedTurns = Effect.fn("AgentService.endDroppedTurns")(function* (
    this: AgentService,
    provider: AgentProvider,
  ) {
    const dropped = [...this.#conversation.activeSnapshots()].flatMap(([agentId, snapshot]) => {
      const turnId = snapshot.activeTurnId;
      const agent = this.#store.get(agentId);
      if (!turnId || !agent || providerForAgent(agent) !== provider) return [];
      if (!this.#turnRunsOnlyInSnapshot(agentId, turnId)) return [];
      const client = this.#providers.clientForAgent(agent);
      const session = this.#runningSession(agent, snapshot.threadId);
      if (!client?.runsTurn || !session || client.runsTurn(session, turnId)) return [];
      return [{ agentId, threadId: snapshot.threadId, turnId }];
    });
    for (const { agentId, threadId, turnId } of dropped) {
      logger.warn("A provider restart found a turn that its provider does not run. It ends as interrupted.", {
        agentId,
        turnId,
      });
      yield* this.#turn.settleOrphanedTurn(agentId, threadId, turnId, "interrupted");
    }
  });

  #routineRunsIn(agent: AgentSummary, threadId: string | null): boolean {
    const publicThreadId = threadId ?? agent.threadId;
    return publicThreadId !== null && this.#conversation.routineSession(agent.id, publicThreadId) !== undefined;
  }

  #runningSession(agent: AgentSummary, threadId: string | null | undefined): string | undefined {
    const publicThreadId = threadId ?? agent.threadId;
    if (!publicThreadId) return undefined;
    return (
      this.#conversation.routineSession(agent.id, publicThreadId) ??
      this.#store.database.activeProviderSession(publicThreadId, agent.provider)?.externalSessionId
    );
  }

  readonly interruptAll = Effect.fn("AgentService.interruptAll")(function* (this: AgentService) {
    if (!this.#providers.isReady()) return;
    const requests: Effect.Effect<unknown>[] = [];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      const turnId = snapshot.activeTurnId;
      if (!snapshot.threadId || !turnId) continue;
      const agent = this.#store.get(agentId);
      const client = agent ? this.#providers.clientForAgent(agent) : null;
      const session = agent ? this.#runningSession(agent, snapshot.threadId) : undefined;
      if (!client || !session) continue;
      this.#images.interrupt(agentId, session, turnId);
      requests.push(
        client
          .request(
            "turn/interrupt",
            {
              threadId: session,
              turnId,
            },
            decodeRecordResponse,
          )
          .pipe(
            Effect.mapError(
              (failure) => new AgentLifecycleFailed({ operation: "interrupt active turn", cause: failure.cause }),
            ),
          )
          .pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("interrupt_failed", failure.cause, agentId))),
          ),
      );
    }
    yield* Effect.all(requests, { concurrency: "unbounded", discard: true });
  }, Effect.uninterruptible).bind(this);

  respondToPrompt(input: RespondToPromptInput, responder?: PromptResponder): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToPrompt(input, responder)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "respondToPrompt", cause: failure.cause })),
      );
  }

  respondToApproval(
    input: RespondToApprovalInput,
    responder?: ApprovalResponder,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToApproval(input, responder)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToApproval", cause: failure.cause }),
        ),
      );
  }

  respondToMediaApproval(
    input: RespondToMediaApprovalInput,
    responder?: ApprovalResponder,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToMediaApproval(input, responder)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToMediaApproval", cause: failure.cause }),
        ),
      );
  }

  respondToCreditsHold(
    input: RespondToCreditsHoldInput,
    responder?: ApprovalResponder,
  ): Effect.Effect<CreditsHold | null, AgentLifecycleFailed> {
    return this.#attention
      .respondToCreditsHold(input, responder)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToCreditsHold", cause: failure.cause }),
        ),
      );
  }

  respondToBrowserSecret(input: LocalBrowserSecretResponse): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToBrowserSecret(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToBrowserSecret", cause: failure.cause }),
        ),
      );
  }

  respondToBrowserTakeover(
    input: RespondToBrowserTakeoverInput,
    fromMember = false,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToBrowserTakeover(input, fromMember)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToBrowserTakeover", cause: failure.cause }),
        ),
      );
  }

  #emitError(code: string, error: unknown, agentId?: string, context?: FailureContext, link?: string): void {
    const message = this.#reportFailure(code, error, agentId, context);
    this.#emit({
      type: "error",
      ...(agentId !== undefined ? { agentId } : {}),
      code,
      message,
      ...(context?.provider ? { provider: context.provider } : {}),
      ...(context?.model ? { model: context.model } : {}),
      ...(link ? { link } : {}),
    });
  }

  #reportFailure(code: string, error: unknown, agentId?: string, context?: FailureContext): string {
    const causeCode = context?.causeCode ?? classifyFailure(error);
    this.emit("failure", {
      ...context,
      code,
      ...(agentId !== undefined ? { agentId } : {}),
      causeCode,
    });
    const message = this.#mcp.redact(error instanceof Error ? error.message : String(error));
    errorLogger.warn("An agent error was reported.", {
      code,
      agentId: agentId ?? null,
      provider: context?.provider ?? null,
      model: context?.model ?? null,
      turnId: context?.turnId ?? null,
      causeCode,
      message: shortenDiagnostic(message),
    });
    return message;
  }

  #emitRuntimeSnapshot(): void {
    this.#emit({ type: "runtime-snapshot", snapshot: this.getRuntimeSnapshot() });
  }

  readTransferHistory(agentId: string): HistoryThread[] {
    const agent = this.#store.get(agentId);
    if (!agent) return [];
    return this.#history
      .readThreads(agentId, agent.threadId)
      .map((thread) => (thread.main && agent.preview ? { ...thread, preview: agent.preview } : thread));
  }

  resolveTransferFile(attachmentId: string) {
    return this.#history.resolveFile(attachmentId);
  }

  readonly importTransferHistory = Effect.fn("AgentService.importTransferHistory")(function* (
    this: AgentService,
    input: ImportHistoryThreadInput,
    readerId: string,
  ): Effect.fn.Return<void, AgentHistoryTransferFailed> {
    const { threadId, lastMessageId } = yield* this.#history.importThread(input);
    if (lastMessageId) this.#reader.markThreadRead(readerId, threadId, lastMessageId);
    if (!input.thread.main) this.#tasks.changed(input.agentId);
    else if (input.thread.preview) {
      yield* this.#store
        .updatePreview(input.agentId, input.thread.preview)
        .pipe(Effect.mapError((failure) => new AgentHistoryTransferFailed({ cause: failure.cause })));
      this.#emit({ type: "agents-changed", agents: this.listAgents() });
    }
    this.#emit({
      type: "conversation-invalidated",
      agentId: input.agentId,
      revision: this.#store.database.readConversationRevision(input.agentId, threadId),
    });
  });

  #emit(event: AgentEvent, memberId?: string): void {
    recordAgentRestartActivity(event);
    if (event.type === "usage-changed") for (const provider of AGENT_PROVIDERS) this.#refreshPoolInUse(provider);
    this.#liveVoice?.observe(event);
    if (event.type === "turn-started") this.#steerAfterTurnStart(event.agentId, event.threadId);
    if (this.channels?.event(event) || this.messaging?.event(event, this.#scope) || this.#tasks?.event(event)) return;
    this.emit("event", event, memberId);
    if (event.type === "status") this.#providerStatusChanged(event.status);
  }

  readonly #forgetExecutionThread = Effect.fn("AgentService.forgetExecutionThread")(function* (
    this: AgentService,
    threadId: string,
  ) {
    const sessions = yield* lifecycleStep("list execution sessions", () =>
      this.#store.database.listProviderSessions(threadId),
    );
    for (const session of sessions) yield* this.#threads.releaseDeletedSession(session.externalSessionId);
    for (const session of sessions)
      yield* this.#threads
        .deleteProviderSessionFiles(session.externalSessionId, session.id)
        .pipe(
          Effect.mapError(
            (failure) =>
              new AgentLifecycleFailed({ operation: "delete execution session files", cause: failure.cause }),
          ),
        );
    for (const session of sessions) {
      this.#conversation.unbindThread(session.externalSessionId);
      this.#conversation.unloadThread(session.externalSessionId);
      this.#compaction.endThread(session.externalSessionId);
    }
    this.#conversation.forgetExecutionThread(threadId);
    this.#turn.fileHistory.forgetThread(threadId);
  }, Effect.uninterruptible);
}

export class AgentLifecycleFailed extends Schema.TaggedError<AgentLifecycleFailed>()("AgentLifecycleFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const POOL_READ_INTERVAL_MS = 4 * 60_000;

type ModelMove = "return" | "provider-error" | "next-turn" | "pool";

const RUNTIME_UPDATE_KEYS: ReadonlySet<string> = new Set([
  "agentId",
  "provider",
  "model",
  "reasoningEffort",
  "providerAccountId",
  "leaveUsageLimit",
]);

const PROVIDER_BOUND_UPDATE_KEYS: ReadonlySet<string> = new Set(["access", "fastMode", "ultrafast"]);

function withoutRuntimeFields(update: AgentUpdate): AgentUpdate {
  const fields: AgentUpdate = { ...update };
  for (const key of RUNTIME_UPDATE_KEYS) if (key !== "agentId") Reflect.deleteProperty(fields, key);
  return fields;
}

const MODEL_SWITCH_TEXT = {
  "usage-limit": "status.agent.modelSwitchedForLimit",
  "usage-limit-ended": "status.agent.modelReturnedAfterLimit",
  "provider-error": "status.agent.modelSwitchedForError",
  "provider-error-ended": "status.agent.modelReturnedAfterError",
} as const;

function agentModelChoice(agent: AgentSummary): AgentModelChoice {
  return {
    provider: agent.provider,
    model: agent.model,
    ...(agent.providerAccountId ? { providerAccountId: agent.providerAccountId } : {}),
  };
}

function logUnlistedEndpoints(
  harness: CustomProviderHarness,
  endpoints: readonly CustomProviderConfig[],
  catalog: readonly AgentModelOption[],
): void {
  const unlisted = endpoints
    .filter(
      (endpoint) => (endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS) === harness && endpoint.models.length > 0,
    )
    .filter(
      (endpoint) => !catalog.some((option) => option.provider === harness && option.id.startsWith(`${endpoint.id}/`)),
    )
    .map((endpoint) => endpoint.id);
  if (unlisted.length === 0) return;
  logger.warn("The provider lists no model of a saved custom endpoint. Its own config can deny the endpoint id.", {
    provider: harness,
    endpointIds: unlisted,
  });
}

function workspaceOnlyUnavailable(provider: AgentProvider): boolean {
  return agentProviderDescriptor(provider).workspaceEnforcement === "confined-process" && !canConfineProcesses();
}

function usageLimitOf(choice: AgentModelChoice): UsageLimitKey {
  return { provider: choice.provider, accountId: agentProviderAccount(choice), model: choice.model };
}

function stopKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}\u0000${taskId}`;
}

function lifecycleStep<A>(operation: string, run: () => A): Effect.Effect<A, AgentLifecycleFailed> {
  return Effect.try({ try: run, catch: (cause) => new AgentLifecycleFailed({ operation, cause }) });
}

function settleLifecycleTasks<A>(
  operation: string,
  tasks: readonly Effect.Effect<A, { readonly cause: unknown }>[],
): Effect.Effect<void> {
  return Effect.forEach(
    tasks,
    (task) =>
      task
        .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: operation, cause: failure.cause })))
        .pipe(Effect.result),
    {
      concurrency: "unbounded",
      discard: true,
    },
  );
}

function failureMessages(error: unknown): string[] {
  const messages: string[] = [];
  for (let cause = error; cause !== undefined && cause !== null && messages.length < 4; ) {
    messages.push(cause instanceof Error ? cause.message : String(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return messages;
}

function localWorkspaceAccess(agent: AgentSummary): { allowOutside: boolean; allowedRoots: readonly string[] } {
  return { allowOutside: !workspaceAccessEnforced(agent), allowedRoots: effectiveAgentFolders(agent) };
}
