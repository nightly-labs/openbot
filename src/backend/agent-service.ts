import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { agentProviderDescriptor, customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { developmentStartingModel } from "@openbot/contracts/development-defaults";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentAccessLevel,
  AgentAnalyticsInput,
  AgentEvent,
  AgentMemory,
  AgentMemorySelectionState,
  AgentModelId,
  AgentModelOption,
  AgentPendingRuntime,
  AgentReasoningEffort,
  AgentRuntimeSnapshot,
  AgentSessionSettings,
  AgentStatus,
  AgentSummary,
  AgentTask,
  AgentTaskInput,
  AgentTaskReadState,
  AgentTasksSnapshot,
  AgentWaitsSnapshot,
  AskSideQuestionInput,
  AttachmentDataInput,
  AvatarImageInput,
  BranchAgentTaskInput,
  CancelMcpSignInInput,
  CapabilityState,
  ChannelMemory,
  ChannelRoutine,
  ChannelRoutineRun,
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
  DeleteRoutineInput,
  DeleteSharedTableInput,
  DraftAttachment,
  DuplicateAgentResult,
  GenerateAgentProfileInput,
  HiddenAgentsSnapshot,
  HostAnalyticsInput,
  ListChannelRoutineRunsInput,
  ListRoutineRunsInput,
  LocalBrowserSecretResponse,
  MarkAgentTaskReadInput,
  McpServerConfig,
  McpSignInAppInput,
  McpSignInAppState,
  McpSignInState,
  McpTestResult,
  ProviderCodeLoginStart,
  ProviderUsageResets,
  QueuedMessageReceipt,
  QueueSnapshot,
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
  SendMessageInput,
  SetAgentHiddenInput,
  SetAgentMemoryInclusionInput,
  SetAgentSessionSettingInput,
  SetMcpServerEnabledInput,
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
} from "@openbot/contracts/ipc";
import {
  type AgentDefaults,
  type AgentModelChoice,
  agentAutomationAllowed,
  agentBrowserProfile,
  agentNewChatAllowed,
  agentTaskLimit,
  type BusyMessageMode,
  CONTEXT_RESET_ITEM_TYPE,
  DEFAULT_BUSY_MESSAGE_MODE,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isContextResetMarker,
  isCustomProviderHarness,
  MODEL_SWITCH_ITEM_TYPES,
  type ModelSwitchReason,
  type QueueSteerFallback,
  sameAgentBrowserProfile,
  sameAgentModelChoice,
  WORKFLOWS_USAGE_ID,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { AGENT_THREAD_READS_LIMIT } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { classifyFailure } from "@openbot/telemetry";
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
import { BootRecovery } from "./agent/boot-recovery";
import { BrowserUploads } from "./agent/browser-uploads";
import type { ChatVisualPreviewHost } from "./agent/chat-visual-preview";
import { ContextCompaction } from "./agent/context-compaction";
import { ConversationReader } from "./agent/conversation-reader";
import { ConversationRuntime } from "./agent/conversation-runtime";
import { CustomEndpoints, toEndpointChangeFailed } from "./agent/custom-endpoints";
import { agentNamesById, displayMessageReferences } from "./agent/delivery-content";
import { DeltaBuffer } from "./agent/delta-buffer";
import type { SectionTeammates } from "./agent/developer-instructions";
import { DrainScheduler } from "./agent/drain-scheduler";
import { DuplicationGate, toAgentDuplicationFailed } from "./agent/duplication-gate";
import type { FailureContext, FailureSignal } from "./agent/failure-signal";
import { type AgentHostedSites, HostedSiteCoordinator } from "./agent/hosted-site-coordinator";
import { ImageGenRuntime } from "./agent/image-gen-runtime";
import { InstructionsChanges } from "./agent/instructions-changes";
import { MailboxSync } from "./agent/mailbox-sync";
import { type GitHubConnectorSource, McpGateway, type TestMcpServerOptions } from "./agent/mcp-gateway";
import { type MarketplaceAppServer, mcpServersFromGateway } from "./agent/mcp-tools";
import { MemoryHold } from "./agent/memory-hold";
import { MEMORY_REVIEW_MESSAGES, MemoryReview } from "./agent/memory-review";
import {
  creationModel,
  developmentDefaultsApply,
  type ModelChoice,
  modelUnavailableError,
  type ProviderPreference,
  startingChoice,
  startingModel,
} from "./agent/model-choice";
import { OpenBotToolRouter } from "./agent/openbot-tool-router";
import { PlanContinuation } from "./agent/plan-continuation";
import { ProfileClients } from "./agent/profile-clients";
import {
  GenerationUsageLimitError,
  generateProfile,
  generateTextWithoutTools,
  ProfileGenerationFailed,
} from "./agent/profile-generation";
import { ProfileSave, standingProfileChanged, toProfileSaveFailed } from "./agent/profile-save";
import type { ProviderAccountStore } from "./agent/provider-account-store";
import { isPlanLimitDiagnostic } from "./agent/provider-diagnostics";
import { type AgentClientFactory, ProviderRuntime, toProviderOperationFailed } from "./agent/provider-runtime";
import { QueueControls } from "./agent/queue-controls";
import { quietRoutineRun } from "./agent/routine-quiet-runs";
import { type RoutineMutationOptions, RoutineScheduler, toRoutineOperationFailed } from "./agent/routine-scheduler";
import { localTimezone } from "./agent/routine-tools";
import { buildRuntimeSnapshot } from "./agent/runtime-snapshot";
import type { ScreenCaptureHost } from "./agent/screen-capture";
import { SessionSettings } from "./agent/session-settings";
import { SIDE_QUESTION_CHAT_MESSAGES, sideQuestionPrompt } from "./agent/side-question";
import type { AgentSidebar } from "./agent/sidebar-tools";
import type { LocalSkillTools } from "./agent/skill-tools";
import {
  agentProviderAccount,
  isRequestTimeout,
  providerForAgent,
  providerLabel,
  type ToolUsageSignal,
} from "./agent/thread-items";
import { ThreadLifecycle } from "./agent/thread-lifecycle";
import { toToolOperationFailed } from "./agent/tool-operation";
import { type AgentBrowserHost, TurnLifecycle } from "./agent/turn-lifecycle";
import { memoryReviewUsageObserver, workflowUsageObserver } from "./agent/usage-collection";
import { toUsageReadFailed, UsageLimitGate, type UsageLimitKey } from "./agent/usage-limit-gate";
import { WarmGenerations } from "./agent/warm-generations";
import type { WebhookRoutineWriter } from "./agent/webhook-routine-tool";
import type { AgentApiKeys } from "./agent-api-keys";
import type { AgentProvider } from "./agent-client";
import type { AgentTables } from "./agent-data/agent-tables";
import type { AgentStore } from "./agent-store";
import { type AgentTaskBranchFailed, AgentTasks } from "./agent-tasks/agent-tasks";
import { type AgentThreadRecord, AgentThreadStore } from "./agent-threads/agent-thread-store";
import { AgentWaitStore } from "./agent-waits/agent-wait-store";
import { AgentWaits } from "./agent-waits/agent-waits";
import { automationRunCommand } from "./automation-command";
import { toChannelOperationError } from "./channel-effects";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import type { BundledProviderExecutables } from "./cli";
import type { ConversationMarkerExclusions } from "./conversation-read-store";
import type { ProviderSession } from "./database/provider-sessions";
import { reportOriginalFailure } from "./effect-boundary";
import type { HostMemory } from "./host-memory";
import type { MailboxStore } from "./mailbox-store";
import { toMcpOperationError } from "./mcp-effects";
import type { McpSignInOpener } from "./mcp-oauth-provider";
import { McpServerStore } from "./mcp-server-store";
import { MessagingThreads, toMessagingThreadFailed } from "./messaging/messaging-threads";
import type { PasswordVault } from "./password-vault";
import { decodeRecordResponse, getString } from "./protocol";
import { NO_PROVIDER_CREDENTIALS, type ProviderClientContext } from "./provider-drivers";
import { providerHistoryPersistence } from "./provider-history-persistence";
import { recordAgentRestartActivity } from "./restart-activity";
import type { RoutineFlowTools } from "./routine-flows/routine-flow-tools";
import { RoutineRecords } from "./routine-records";
import type { RoutineHoldWindow } from "./routine-store";
import { type RoutineDueSource, RoutineTimer } from "./routine-timer";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import type { VaultItems } from "./vault-items";
import type { WorkflowRunEnd } from "./workflows/workflows";
import {
  listWorkspaceDirectory,
  type ResolvedSharedFile,
  resolveSharedFile,
  resolveWorkspaceFile,
} from "./workspace-paths";

const logger = createOpenBotLogger("agent-service");

/**
 * Only the application knows which managed CLIs it downloaded, so a caller that says nothing gets
 * none of them. Codex is left out on purpose: it is the one provider that can also ship inside the
 * application, and an unset entry keeps that copy in the search.
 */
const DEFAULT_BUNDLED_EXECUTABLES: BundledProviderExecutables = { claude: null, grok: null };

export type { TestMcpServerOptions } from "./agent/mcp-gateway";
export type { RoutineMutationOptions } from "./agent/routine-scheduler";
export type { ResolvedSharedFile } from "./workspace-paths";

interface AgentServiceEvents {
  failure: [failure: FailureSignal];
  event: [event: AgentEvent];
  /** Finished tool steps for the local host's product analytics. Never forwarded to a client. */
  toolUsage: [usage: ToolUsageSignal];
  /** A workflow run ended, for the local host's product analytics. Never forwarded to a client. */
  workflowRun: [end: WorkflowRunEnd];
}

export interface AgentServiceOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  browser: AgentBrowserHost;
  requestTimeoutMs?: number;
  /**
   * How long a provider takes to start a context compaction before OpenBot stops it. A started
   * compaction runs ten times as long. Tests make it short.
   */
  contextCompactionTimeoutMs?: number;
  /** The pause with no turn before a conversation's memory review runs early. Tests make it short. */
  memoryReviewIdleMs?: number;
  preferredProvider?: AgentProvider;
  /** The model chosen beside `preferredProvider`, or `null` for that provider's own default. */
  preferredModel?: AgentModelId | null;
  clientFactory?: AgentClientFactory | null;
  bundledExecutables?: BundledProviderExecutables;
  prepareAgentWorkspace?: (agent: AgentSummary) => Effect.Effect<void, AgentLifecycleFailed>;
  hostedSites?: AgentHostedSites | null;
  /** Draws pages for `html_preview`. Without it the tool tells the agent to show the page unchecked. */
  visualPreview?: ChatVisualPreviewHost | null;
  /** Captures the desktop for `capture_screen`; null where this process has no desktop. */
  screenCapture?: ScreenCaptureHost | null;
  /**
   * What an agent's MCP server test waits for first, as the Test button does: the managed tool
   * runtimes a stdio command may need. Without it the test runs with what this machine holds.
   */
  prepareMcpTest?: (config: McpServerConfig) => Effect.Effect<void, unknown>;
  /** The saved server that a Marketplace app installs, for an agent that suggests the app. */
  marketplaceAppServer?: (appId: string) => MarketplaceAppServer | null;
  sidebarLayout?: AgentSidebar | null;
  /**
   * What a spawned CLI is given beyond its own binary: the stored keys, and the user's own model
   * endpoints. The main process owns both, because they carry secrets that must not reach the
   * renderer or the database.
   */
  credentials?: ProviderClientContext;
  offProviders?: readonly AgentProvider[];
  /** The provider accounts after the first. Omitted, each provider holds its own sign-in only. */
  providerAccounts?: ProviderAccountStore;
  saveProviderUse?: (provider: AgentProvider, on: boolean) => Effect.Effect<void, AgentLifecycleFailed>;
  localSkillTools?: (() => LocalSkillTools) | undefined;
  /** Built after the service, so read when a tool call needs it. */
  routineFlowTools?: () => RoutineFlowTools;
  /** Built after the service, so read when a tool call needs it. */
  webhookRoutines?: () => WebhookRoutineWriter;
  /**
   * Whose approvals are answered without asking. The main process owns the preference, because it
   * is a property of this computer and never crosses the Team API. Omitted, every approval asks.
   */
  approvalAutomation?: ApprovalAutomationPolicy | undefined;
  /**
   * The app default for a message sent while its agent works. The main process owns the preference.
   * Omitted, such a message waits in the queue, as every one did before the setting existed.
   */
  busyMessageMode?: () => BusyMessageMode;
  /**
   * How many memories one agent can hold. The main process owns the preference. Omitted, the
   * default cap, which was the only cap before the setting existed.
   */
  agentMemoryLimit?: () => number;
  /**
   * The completed turns between two background memory reviews; `0` is off. The main process owns
   * the preference. Omitted, every 20 turns.
   */
  memoryReviewInterval?: () => number;
  /**
   * The server timezone, for a routine an agent creates without a zone from the tool call or the
   * sender. The main process owns the preference. Omitted, the host system zone.
   */
  timezone?: () => string;
  /**
   * Other owners of scheduled work on the same routine timer, such as workflow triggers. They are
   * read on each arm, because the main process builds them after this service.
   */
  extraRoutineSources?: () => Iterable<RoutineDueSource>;
  /**
   * The access level of the person who asked a channel member to add or remove an agent, for that
   * agent, as the Team API gives it for their own save. Omitted, `manage`.
   */
  channelPersonAgentLevel?: (personId: string, agentId: string) => AgentAccessLevel;
  /** Whether that person uses a remote client, which has only the released routine schedules. Omitted, no. */
  channelRemotePerson?: (personId: string) => boolean;
  deleteWithRevokedApproval?: (
    agentId: string,
    remove: () => Effect.Effect<void, AgentRemovalFailed>,
  ) => Effect.Effect<void, AgentRemovalFailed>;
  /**
   * The shared database agents keep their tables in. Injected because the host child's packaged
   * path is the main process's knowledge, not this class's.
   */
  tables?: AgentTables | null;
  /**
   * Whether a new agent starts on the development default model rather than the built-in one.
   * The main process passes the app variant; only a dev build turns it on.
   */
  developmentDefaults?: boolean;
  /**
   * The Computer Use driver's MCP entry while its daemon runs, or `null`.
   *
   * A function rather than a value because the daemon starts and stops under the user, and the
   * answer is read at each spawn. It is the main process's knowledge: the driver is a child of the
   * main process, not of this class.
   */
  computerUseMcpServer?: () => McpServerConfig | null;
  /**
   * The built-in GitHub connection of this computer, or `null`. Read at each spawn and each hand-off,
   * for the same reason as `computerUseMcpServer`: the user connects and disconnects while OpenBot runs.
   */
  githubConnector?: GitHubConnectorSource | null;
  /** The 1Password vault the user shared with OpenBot, or `null`. The browser fills logins from it. */
  passwordVault?: PasswordVault | null;
  /** The cards and contact info of the Vault, or `null`. The browser fills cards from it. */
  vaultItems?: VaultItems | null;
  /** Where the API keys that users enter through `request_api_key` are saved, or `null`. */
  agentApiKeys?: AgentApiKeys | null;
  /**
   * The memory of a server, or `null` on a desktop computer. With it, no new turn starts
   * while memory is low, and only a fixed number of turns run at the same time.
   */
  hostMemory?: HostMemory | null;
}

/** How long a user send's `clientMessageId` answers a retry. A retry follows a lost reply, not a day. */
const USER_SEND_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The `send_message` recipient limit, so one message can reach every section-mate the prompt names. */
const MAX_SECTION_TEAMMATES = 32;
/** How long an archive waits for the provider to end the turn that it stopped. After it, the archive is refused. */
const TASK_STOP_WAIT_MS = 15_000;

/** The user's update, and the browser profile choice that the profile operations set after their checks. */
export type AgentUpdate = UpdateAgentInput & {
  ownBrowserSession?: boolean;
  browserProfileId?: string | null;
  /** Only the local `agentFolders` handler sets it. The IPC and Team API parsers drop it. */
  additionalFolders?: string[];
  /** Only the local `agentFolders` handler sets it, like `additionalFolders`. */
  excludedFolders?: string[];
};

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
  /** User sends still before their mailbox write, by idempotency key: a retry joins the first call. */
  readonly #pendingUserSends = new Map<string, Deferred.Deferred<QueuedMessageReceipt, AgentLifecycleFailed>>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #reader: ConversationReader;
  readonly #memories: AgentMemories;
  readonly #instructionChanges = new InstructionsChanges();
  readonly #memoryReview: MemoryReview;
  readonly #waits: AgentWaits;
  readonly #tasks: AgentTasks;
  readonly #tables: AgentTables | null;
  readonly #routines: RoutineScheduler;
  readonly #routineTimer: RoutineTimer;
  readonly #channelRoutines: ChannelRoutineScheduler;
  /** Agent and channel routines of every trigger kind, with their webhook routes. */
  readonly routineRecords: RoutineRecords;
  readonly #mcp: McpGateway;
  readonly #providers: ProviderRuntime;
  readonly #providerUseChanges = Semaphore.makeUnsafe(1);
  readonly #endpoints: CustomEndpoints;
  readonly #prepareAgentWorkspace: (agent: AgentSummary) => Effect.Effect<void, AgentLifecycleFailed>;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #images: ImageGenRuntime;
  readonly #threads: ThreadLifecycle;
  readonly #memoryHold: MemoryHold;
  readonly #usageLimits: UsageLimitGate;
  readonly #drain: DrainScheduler;
  readonly #sessionSettings: SessionSettings;
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
  readonly #localSkillTools: (() => LocalSkillTools) | undefined;
  readonly #routineFlowTools: (() => RoutineFlowTools) | undefined;
  readonly #developmentDefaults: boolean;
  readonly #busyMessageMode: () => BusyMessageMode;
  /** The last turn of each agent's chat that the user stopped. One per agent, so it needs no clean-up. */
  readonly #stoppedTurns = new Map<string, string>();

  /** The agents that asked for a new chat with `start_new_chat`. A restart forgets the request. */
  readonly #requestedNewChats = new Set<string>();
  /** A turn that ends with open plan steps runs again, at most 3 times for one request. */
  readonly #planContinuation = new PlanContinuation({ limit: 3 });
  #initialized = false;
  #stopping = false;

  constructor(options: AgentServiceOptions) {
    super();
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
      credentials = NO_PROVIDER_CREDENTIALS,
      localSkillTools,
      routineFlowTools,
      developmentDefaults = false,
      computerUseMcpServer = () => null,
      githubConnector = null,
      hostMemory = null,
      busyMessageMode = () => DEFAULT_BUSY_MESSAGE_MODE,
    } = options;
    this.#developmentDefaults = developmentDefaults;
    this.#busyMessageMode = busyMessageMode;
    this.#localSkillTools = localSkillTools;
    this.#routineFlowTools = routineFlowTools;
    this.#store = store;
    // First of the sub-objects, because `#emitError` reads it to redact and every one of them is
    // given that callback.
    this.#mcp = new McpGateway({
      servers: new McpServerStore(store.database),
      credentials,
      computerUseMcpServer,
      githubConnector,
      agents: () => store.list(),
      logger,
      hooks: {
        emitError: (code, error) => this.#emitError(code, error),
        // Read late: the threads are built further down this constructor.
        refreshAllAgentRuntimes: () => this.#threads.refreshAllAgentRuntimes(),
      },
    });
    this.#sidebarLayout = sidebarLayout;
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
    this.#tasks = new AgentTasks({
      store: new AgentThreadStore(store.database),
      mailbox,
      conversation: this.#conversation,
      hooks: {
        emit: (event) => this.#emit(event),
        agent: (agentId) => store.list().find((agent) => agent.id === agentId),
        // Read late: the drain is built further down this constructor.
        hold: (agentId, taskId) => this.#drain.taskHold(agentId, taskId),
        queued: (agentId) => {
          this.#mailboxSync.emitQueue(agentId);
          this.#drain.scheduleDrain(agentId);
        },
      },
    });
    this.#tables = options.tables ?? null;
    this.#memories = new AgentMemories({
      store,
      conversation: this.#conversation,
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      ...(options.agentMemoryLimit ? { limit: options.agentMemoryLimit } : {}),
    });
    this.#memoryReview = new MemoryReview({
      memories: this.#memories,
      profileClients: this.#profileClients,
      listAgents: () => this.listAgents(),
      models: (agent) =>
        this.#providers.ensureProvider(agent.provider).pipe(Effect.map(() => this.#endpoints.available())),
      createProfileClient: (agent) => this.#providers.createProfileClient(agent.provider, agent.providerAccountId),
      usageObserver: (agent, model) =>
        memoryReviewUsageObserver(this.#store.database.usage, agent.id, agent.provider, model.id),
      chat: (agentId, sideThreadId) => {
        const loaded = sideThreadId
          ? this.#conversation.loadedExecutionSnapshot(sideThreadId)
          : this.#conversation.loadedSnapshot(agentId);
        // The next turn can start before the review reads: it reads that turn after it ends.
        if (loaded)
          return loaded.activeTurnId
            ? loaded.messages.filter((message) => message.turnId !== loaded.activeTurnId)
            : loaded.messages;
        const threadId = sideThreadId ?? this.#store.list().find((agent) => agent.id === agentId)?.threadId;
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
      redact: (text) => this.#mcp.redact(text),
      stopping: () => this.#stopping,
      ...(options.memoryReviewIdleMs === undefined ? {} : { idleMs: options.memoryReviewIdleMs }),
      ...(options.memoryReviewInterval ? { interval: options.memoryReviewInterval } : {}),
    });
    // One timer for every routine owner. The sources are read lazily because `channels` and its
    // scheduler are built further down, and because an owner's earliest routine changes constantly.
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
        interrupt: (agentId, turnId) => this.interrupt(agentId, turnId).pipe(toRoutineOperationFailed),
        awaitDrain: (agentId) => this.#drain.taskFor(agentId)?.pipe(toRoutineOperationFailed),
        syncMailboxMessages: (snapshot) => this.#mailboxSync.syncMailboxMessages(snapshot),
        listAgents: () => this.listAgents(),
        // A hidden agent keeps its routines, but they do not run until the user restores it.
        excludedAgents: () =>
          new Set([...this.#duplication.pendingAgents(), ...this.#removal.deleting(), ...this.#hiddenAgentIds()]),
        isRunning: () => this.#initialized && !this.#stopping,
        usageLimited: (agentId) => !this.#usageLimits.mayDrain(agentId),
      },
    });
    this.#hostedSites = new HostedSiteCoordinator({
      store,
      conversation: this.#conversation,
      hostedSites,
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      isStopping: () => this.#stopping,
    });
    this.#providers = new ProviderRuntime({
      offProviders: options.offProviders ?? [],
      ...(options.providerAccounts ? { accounts: options.providerAccounts } : {}),
      saveProviderUse: (provider, on) =>
        (options.saveProviderUse?.(provider, on) ?? Effect.void).pipe(toProviderOperationFailed),
      conversation: this.#conversation,
      hooks: {
        bindClient: (client) => {
          client.on("notification", (notification) => {
            if (notification.method === "openbot/sessionSettings/updated") {
              const threadId = getString(notification.params, "threadId");
              const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
              if (agentId) this.#emit({ type: "agent-session-settings-changed", agentId });
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
            // Work of a deleted task must not run or settle in the agent's own chat.
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
            // A failed reconcile must not skip the channels and drains below (#2214).
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
            yield* this.#boot.backfillProviderHistory().pipe(Effect.forkIn(this.#scope));
          }).pipe(
            // Limits are not kept over a restart, so an agent on a backup model goes back first.
            // The drains also run when a step above fails, so no settled lane stays idle.
            Effect.ensuring(
              Effect.sync(() => {
                for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);
              }),
            ),
            toProviderOperationFailed,
          ),
        onProviderLost: (client) => {
          this.#boot.orphanDeliveriesOf(client.provider, (agentId) => this.#providers.runsOnOwnProcess(agentId));
          this.#compaction.clientEnded(client);
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
            // A teammate that asked this agent may hold the other answers until this work ends.
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
        isAgentBusy: (agentId) => this.#runsTurn(agentId),
        isProviderAssigned: (provider) => this.#store.list().some((agent) => providerForAgent(agent) === provider),
        captureConfigRevision: () => this.#endpoints.committedRevision(),
        onProviderActivated: (provider, configRevision) =>
          Effect.gen({ self: this }, function* () {
            if (isCustomProviderHarness(provider)) this.#endpoints.clearReleased(provider, configRevision);
            yield* this.#endpoints.runExclusive(() =>
              Effect.gen({ self: this }, function* () {
                if (isCustomProviderHarness(provider)) yield* this.#endpoints.moveAgentsToHarness(provider);
                yield* this.#endpoints.moveAgentsOffUnlistedModels(provider);
              }),
            );
          }),
        onProviderResumed: (provider) => {
          for (const agent of this.#store.list()) {
            if (providerForAgent(agent) === provider) this.#drain.scheduleDrain(agent.id);
          }
        },
      },
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      requestTimeoutMs,
      preferredProvider,
      preferredModel,
      clientFactory,
      bundledExecutables,
      // The exclusion travels with the credentials, so the client that holds a session on a removed
      // endpoint can refuse the prompt itself, after the waits every caller above it makes.
      credentials: {
        ...credentials,
        // The server variables reach Claude and the ACP providers with the agent environment. The
        // thread lifecycle below gets the agent environment without them, so the fingerprint of a
        // Codex session stays the same; Codex reads them from the spawn environment of its app-server.
        ...(credentials.serverEnvironment
          ? {
              agentEnvironment: (inherited) => ({
                ...credentials.serverEnvironment,
                ...credentials.agentEnvironment?.(inherited),
              }),
            }
          : {}),
        history: (provider) => {
          const history = credentials.history
            ? credentials.history(provider)
            : providerHistoryPersistence(this.#store.database, provider);
          const append = history?.append;
          // A routine run's own session is not saved: its items reach the chat live, and nothing
          // reads its history after the run.
          return append
            ? {
                ...history,
                append: (threadId, fragment) =>
                  this.#conversation.isRoutineSession(threadId) ? Effect.void : append(threadId, fragment),
              }
            : history;
        },
        // Of the clients that read this, only OpenCode runs custom endpoints.
        servesModel: (modelId) => this.#endpoints.serves(modelId, "opencode"),
        // Every MCP set that leaves for a provider is remembered, so its secrets stay redactable
        // after the user edits them. This is the second of the two ways one leaves; the other is
        // `enabledMcpServers`, which the Codex thread configuration reads.
        mcpServers: () => this.#mcp.record(credentials.mcpServers()),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
        mcpEndpoint: (config, agentId) => this.#mcp.endpoint(config, agentId).pipe(toMcpOperationError),
      },
      mcpHandoff: this.#mcp.handoffLog(),
      redactMcp: (text) => this.#mcp.redact(text),
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
        // The model list reaches the renderer by pull, refreshed on a status event, and an exclusion
        // changes what that pull answers while no provider state moves.
        modelsChanged: () => this.#emit({ type: "status", status: this.getStatus() }),
        stopProfileClients: () =>
          this.#profileClients
            .stopEndpointClients()
            .pipe(
              Effect.andThen(this.#warmGenerations.stopIdle("opencode")),
              Effect.andThen(this.#warmGenerations.stopIdle("pi")),
            ),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        providerAvailable: (provider) => this.#providerAvailable(provider),
        preference: () => this.#preference(),
      },
    });
    this.#compaction = new ContextCompaction({
      timeoutMs: options.contextCompactionTimeoutMs,
      changed: () => this.#emitRuntimeSnapshot(),
      store,
      providers: this.#providers,
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
      rotateSession: (agentId, client, threadId) => this.#threads.rotateProviderSession(agentId, client, threadId),
      rotatesSession: (agentId, threadId) => this.#threads.rotatesSession(agentId, threadId),
      isStopping: () => this.#stopping,
      compacted: (threadId) => {
        this.channels.contextCompacted(threadId);
        this.messaging.contextCompacted(threadId);
      },
    });
    this.#attention = new AttentionRegistry({
      conversation: this.#conversation,
      browser: this.#browser,
      hostedSites: this.#hostedSites,
      routines: this.#routines,
      ...(options.approvalAutomation === undefined ? {} : { approvalAutomation: options.approvalAutomation }),
      workspaceSandboxed: (agentId) => {
        const agent = store.list().find((candidate) => candidate.id === agentId);
        return agent !== undefined && workspaceAccessEnforced(agent);
      },
      messagingThread: (threadId) => this.messaging.store.linkForThread(threadId) !== null,
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
      ...(options.passwordVault === undefined ? {} : { passwordVault: options.passwordVault }),
      ...(options.vaultItems === undefined ? {} : { vaultItems: options.vaultItems }),
      agentName: (agentId) => store.list().find((candidate) => candidate.id === agentId)?.name,
      // The router is made later; a note comes only from a tool call, after both exist.
      noteVaultChange: (agentId, threadId, turnId, text) => this.#tools.postVaultNote(agentId, threadId, turnId, text),
      apiKeys: options.agentApiKeys ?? null,
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
    // The Team API sends the held list as its own event; the frozen tab projection drops the flag.
    let userControlTabIds = "";
    // `browser-page-state` sends the history state the same way.
    let browserPageStates = "";
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
        // Read late: `channels` is built after this.
        queueHold: (agentId) => this.channels.queueHold(agentId),
      },
    });
    this.#reader = new ConversationReader({
      store,
      conversation: this.#conversation,
      mailboxSync: this.#mailboxSync,
      hooks: {
        emit: (event) => this.#emit(event),
        listAgents: () => this.listAgents(),
      },
    });
    this.#attachments = new AttachmentGateway({
      conversation: this.#conversation,
      mailbox,
      sharedRoot: store.sharedRoot,
      hooks: {
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      },
    });
    this.#browserUploads = new BrowserUploads({
      browser,
      attachments: this.#attachments,
      isStopping: () => this.#stopping,
      hasTakeover: (agentId) => this.#attention.hasBrowserTakeoverForAgent(agentId),
    });
    this.#threads = new ThreadLifecycle({
      store,
      mailbox,
      conversation: this.#conversation,
      memories: this.#memories,
      compaction: this.#compaction,
      mcpServers: () => this.#mcp.enabled(),
      mcpToolRuntimes: () => this.#mcp.toolRuntimes(),
      mcpEndpoint: (config, agentId) => this.#mcp.endpoint(config, agentId).pipe(toMcpOperationError),
      mcpProxyFingerprint: (configs) => this.#mcp.proxyFingerprint(configs).pipe(toMcpOperationError),
      ...(credentials.agentEnvironment ? { agentEnvironment: credentials.agentEnvironment } : {}),
      passwordVaultConnected: () => options.passwordVault?.connected() ?? false,
      vaultItems: () => ({
        available: options.vaultItems?.ready() ?? false,
        cards: options.vaultItems?.hasCards() ?? false,
        contacts: options.vaultItems?.hasContacts() ?? false,
      }),
      // Only a server has a memory reading.
      serverHost: hostMemory !== null,
      sectionTeammates: (agentId) => this.sectionTeammates(agentId),
      channelThread: (threadId) => this.channels.store.channelForThread(threadId) !== null,
      branchThread: (threadId) => this.#tasks.isBranchThread(threadId),
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
    this.#boot = new BootRecovery({
      store,
      mailbox,
      providers: this.#providers,
      conversation: this.#conversation,
      mailboxSync: this.#mailboxSync,
      threads: this.#threads,
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        // A deleted routine takes its runs with it, so a run without a record counts as quiet:
        // otherwise the import would bring back the answers that its quiet turns settled.
        quietRoutineDelivery: (deliveryId) => {
          const run = this.#routines.runForDelivery(deliveryId);
          return run === null || quietRoutineRun(run);
        },
        executionThreads: () => [...this.channels.store.executionThreads(), ...this.messaging.store.executionThreads()],
        taskThreads: () => this.#tasks.executionThreads(),
        deliveryThreadId: (deliveryId) => this.#deliveryThreadId(deliveryId),
        deliverySettled: (deliveryId, terminal) => this.messaging.deliverySettled(deliveryId, terminal),
      },
    });
    this.channels = new ChannelService(store.database, mailbox, {
      agents: () => this.listAgents(),
      hidden: (agentId) => this.#store.isHidden(agentId),
      generate: (lead, prompt) =>
        Effect.gen({ self: this }, function* () {
          yield* this.#providers.ensureProvider(lead.provider);
          const model = this.#endpoints
            .available()
            .find((item) => item.provider === lead.provider && item.id === lead.model);
          if (!model)
            return yield* new ProfileGenerationFailed({
              cause: new Error(sourceText("error.backend.channelLeadModelUnavailable")),
            });
          const client = this.#providers.createProfileClient(lead.provider, lead.providerAccountId);
          return yield* this.#profileClients
            .run(client, (cancelled) =>
              generateTextWithoutTools(
                client,
                { ...model, defaultReasoningEffort: lead.reasoningEffort },
                prompt,
                cancelled,
              ),
            )
            .pipe(
              // A routing turn can be the first one a spent plan refuses: in its completion, or as the
              // error of the `turn/start` request. It holds the lead's model the way a refused member turn
              // does, and the channel keeps the task queued for the reset.
              Effect.tapError((failure) =>
                failure instanceof GenerationUsageLimitError
                  ? this.#usageLimits.reached(lead.id, failure.resetsAt, lead.model)
                  : failure.cause instanceof Error && isPlanLimitDiagnostic(failure.cause.message)
                    ? this.#usageLimits.reached(lead.id, null, lead.model)
                    : Effect.void,
              ),
            );
        }).pipe(toChannelOperationError),
      schedule: (agentId) => this.#drain.scheduleDrain(agentId),
      awaitDrain: (agentId) => this.#drain.taskFor(agentId)?.pipe(toChannelOperationError),
      contextCharacters: (agentId, threadId) => {
        const agent = this.#store.list().find((item) => item.id === agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        return session ? this.#compaction.contextInputCharacters(session.externalSessionId) : 120_000;
      },
      reportsCompactions: (agentId) => this.#reportsCompactions(agentId),
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toChannelOperationError),
      loadedSnapshot: (threadId) => this.#conversation.loadedExecutionSnapshot(threadId),
      // A held agent gets no channel assignment: one that waited for the reset would hold its
      // resources. A channel turn runs beside the agent's tasks, unless its provider runs one turn
      // of the agent at a time.
      busy: (agentId) =>
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)) ||
        (this.#tasks.oneTurnAtATime(agentId) &&
          this.#conversation.workingTaskSnapshots(agentId).some((snapshot) => snapshot.activeTurnId)) ||
        !this.#usageLimits.mayDrain(agentId),
      usageLimited: (agentId) => !this.#usageLimits.mayDrain(agentId),
      skipAtLimit: (task) => this.#channelRoutines.skipAtLimit(task.channelId, task.requestMessageId),
      usageLimitBackup: (agentId) => this.#usageLimitBackup(agentId) !== undefined,
      steer: (agentId, threadId, turnId, messageId, text) =>
        Effect.gen({ self: this }, function* () {
          const agent = this.#store.list().find((item) => item.id === agentId);
          const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
          const client = agent ? this.#providers.clientForAgent(agent) : null;
          if (!session || !client) return "rejected" as const;
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
            );
        }),
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId).pipe(toChannelOperationError),

      // Every channel state change ends in `publish`, so this is the complete trigger surface for
      // reconciling a channel routine run. It does not depend on `turn-completed`, which never
      // reaches the agent event forwarder for a channel thread.
      changed: (channelId, revision) => {
        this.#channelRoutines.reconcile(channelId);
        this.#routineTimer.arm();
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
      // A held agent starts nothing, so its queue has no event of its own while the reservation
      // moves. Without this its panel keeps naming the channel task that has already ended.
      queueHoldChanged: () => {
        for (const agent of this.#store.list())
          if (this.#mailbox.queuedDeliveryIds(agent.id).length) this.#mailboxSync.emitQueue(agent.id);
      },
      error: (error) => this.#emitError("channel_coordination_failed", error),
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
      busy: (agentId) =>
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)),
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId).pipe(toMessagingThreadFailed),
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toMessagingThreadFailed),
      ownChat: (threadId) => this.#store.ownsThread(threadId),
      contextSession: (agentId, threadId) => {
        const agent = this.#store.list().find((item) => item.id === agentId);
        if (!agent || !this.#reportsCompactions(agentId)) return null;
        return this.#store.database.activeProviderSession(threadId, agent.provider)?.externalSessionId ?? null;
      },
    });
    this.#memoryHold = new MemoryHold({
      memory: hostMemory,
      hooks: {
        scheduleAll: () => {
          for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);
        },
        retryWaiting: () => this.#drain.retrySlotWaiters(),
        releaseIdleThreads: () => this.#providers.releaseIdleThreads(),
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
        // The refused turn's drain must not wait for the queues, so the owned scope settles them. An
        // agent set to switch without asking keeps its queue for the backup model; an idle one moves now,
        // and the refused one at the end of its turn.
        held: (agentIds) =>
          Effect.sync(() => {
            for (const agentId of agentIds) this.#drain.scheduleDrain(agentId);
          }).pipe(
            Effect.andThen(this.#settleHeldQueues(agentIds.filter((agentId) => !this.#usageLimitBackup(agentId)))),
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause))),
            Effect.forkIn(this.#scope, { startImmediately: true }),
            Effect.asVoid,
          ),
        // A channel task that went back to its queue is assigned again only by a pump. An agent that
        // left this model for a backup goes back to it.
        released: (limit) =>
          this.channels.wake().pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_release_failed", failure.cause))),
            Effect.andThen(
              Effect.forEach(
                this.#store
                  .list()
                  .filter((agent) => agent.usageLimitReturn && sameUsageLimit(agent.usageLimitReturn, limit)),
                (agent) => Effect.sync(() => this.#drain.scheduleDrain(agent.id)),
                { discard: true },
              ),
            ),
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
        isStopping: () => this.#stopping,
        servesModel: (model, provider) => this.#endpoints.serves(model, provider),
        requeueChannelDelivery: (deliveryId, continueWork) => this.#requeueChannelDelivery(deliveryId, continueWork),
        mayFailOver: (agentId) => this.#usageLimitBackup(agentId) !== undefined,
        turnEnded: (turnId) => this.#turn.hasEnded(turnId),
        turnRestarting: (turnId) => this.#turn.forgetEnded(turnId),
        startRequestedNewChat: (agentId) => this.#startRequestedNewChat(agentId),
        dropRequestedNewChat: (agentId) => {
          if (this.#requestedNewChats.delete(agentId))
            logger.info(`Agent ${agentId} dropped its new chat request: a turn in its chat started first.`);
        },
        followUsageLimit: (agentId) => {
          if (this.#pendingRuntimeDue(agentId)) {
            Effect.runFork(
              this.#followPendingRuntime(agentId).pipe(
                // A change that is gone, applied or dropped, lets the next drain make a due usage-limit move.
                Effect.andThen((moved) =>
                  Effect.sync(() => this.#drain.scheduleDrain(agentId, moved || !this.#pendingRuntimeDue(agentId))),
                ),
                Effect.forkIn(this.#scope, { startImmediately: true }),
              ),
            );
            return true;
          }
          if (!this.#usageLimitMove(agentId)) return false;
          Effect.runFork(
            this.#followUsageLimit(agentId).pipe(
              // The `held` hook kept the queue for this move, so a move that failed settles it.
              Effect.tap((moved) =>
                moved || this.#usageLimits.mayDrain(agentId)
                  ? Effect.void
                  : this.#settleHeldQueues([agentId]).pipe(
                      Effect.catch((failure) =>
                        Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause, agentId)),
                      ),
                    ),
              ),
              // A channel task waits in its channel, and only a pump assigns it to the new model.
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
          // A steer must not reach the agent's own chat for a message of a deleted task.
          if (this.#tasks.deliveryTaskGone(deliveryId)) throw new Error(sourceText("error.backend.threadNotFound"));
          return this.#tasks.threadForDelivery(deliveryId);
        },
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
        emitError: (code, error, agentId, context) => this.#emitError(code, error, agentId, context),
        emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        steerAgentMessage: (recipientAgentId, deliveryId) => this.#steerAgentMessage(recipientAgentId, deliveryId),
        dropRefusedSession: (agentId, externalThreadId) =>
          this.#threads.dropRefusedProviderSession(agentId, externalThreadId),
        listAgents: () => this.listAgents(),
        redactMcp: (text) => this.#mcp.redact(text),
        emitToolUsage: (usage) => this.emit("toolUsage", usage),
        turnModel: (agentId, turnId) => this.#drain.modelForTurn(agentId, turnId),
        mayFailOver: (agentId) => this.#usageLimitBackup(agentId) !== undefined,
        requeueChannelDelivery: (deliveryId, continueWork) => this.#requeueChannelDelivery(deliveryId, continueWork),
        quietRoutineDelivery: (deliveryId) => this.#routines.quietRunForDelivery(deliveryId),
        takeRoutinePreview: (deliveryId) => this.#routines.takePreviewBeforeRun(deliveryId),
        closeRoutineSession: (externalThreadId) => this.#threads.closeRoutineThread(externalThreadId),
        conversationTurnEnded: (agentId, sideThreadId, counts, memoryCommitted) =>
          this.#memoryReview.turnEnded(agentId, sideThreadId, counts, memoryCommitted),
        turnStopped: (agentId, taskId, turnId) =>
          this.#stoppedTurn(agentId, taskId) === turnId || (taskId === null && this.#requestedNewChats.has(agentId)),
        hasOpenWait: (agentId, deliveryIds) =>
          this.#waits.list(agentId).waits.some((wait) => deliveryIds.includes(wait.requestMessageId)),
        routineAnswered: (agentId, deliveryId, answer) => {
          const agent = this.#store.list().find((item) => item.id === agentId);
          const run = this.#routines.runForDelivery(deliveryId);
          if (!agent || !run) return Effect.void;
          return this.#threads
            .addRoutineDigest(agent, run.routineName, answer)
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
        taskOpen: (taskId) => this.#tasks.threadId(taskId) !== null,
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
            const threadIds = yield* lifecycleStep("list agent tasks", () => this.#tasks.threadIdsForAgent(agentId));
            for (const threadId of threadIds) yield* this.#forgetExecutionThread(threadId);
            yield* lifecycleStep("delete agent tasks", () => this.#tasks.deleteForAgent(agentId));
          }).pipe(Effect.mapError((failure) => new AgentRemovalFailed({ cause: failure.cause }))),
        cancelMemoryReview: (agentId) => this.#memoryReview.cancel(agentId),
        stopAgentProcess: (agentId) =>
          this.#providers
            .stopAgentProcess(agentId)
            .pipe(Effect.mapError((failure) => new AgentRemovalFailed({ cause: failure.cause }))),
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
      drain: this.#drain,
      tables: this.#tables,
      sidebarLayout: this.#sidebarLayout,
      ...(this.#localSkillTools === undefined ? {} : { localSkillTools: this.#localSkillTools }),
      ...(this.#routineFlowTools === undefined ? {} : { routineFlowTools: this.#routineFlowTools }),
      ...(options.approvalAutomation === undefined ? {} : { approvalAutomation: options.approvalAutomation }),
      ...(options.visualPreview === undefined ? {} : { visualPreview: options.visualPreview }),
      ...(options.screenCapture === undefined ? {} : { screenCapture: options.screenCapture }),
      mcpServers: mcpServersFromGateway(this.#mcp, options.prepareMcpTest),
      ...(options.marketplaceAppServer === undefined ? {} : { marketplaceAppServer: options.marketplaceAppServer }),
      apiKeys: options.agentApiKeys ?? null,
      hooks: {
        listAgents: () => this.listAgents(),
        listModels: () => this.listModels(),
        providerAccounts: (provider) => this.getStatus().providers?.find((row) => row.id === provider)?.accounts,
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
          ).pipe(toToolOperationFailed),
        updateAgent: (input, initiatingAgentId) =>
          this.updateAgent(input, initiatingAgentId).pipe(toToolOperationFailed),
        setAvatar: (agentId, image) => this.setAvatar(agentId, image).pipe(toToolOperationFailed),
        enabledMcpServers: () => this.enabledMcpServers(),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        redactMcp: (text) => this.#mcp.redact(text),
        runsTurn: (agentId) => this.#runsTurn(agentId),
        interrupt: (agentId, turnId, mayStop) =>
          this.#interruptTurn(agentId, turnId, undefined, mayStop).pipe(toToolOperationFailed),
        turnActivity: (agentId, turnId) => ({
          startedAt: turnId ? this.#turn.turnStartedAt(turnId) : null,
          lastEventAt: this.#turn.lastEventAt(agentId),
        }),
        requestNoUpdate: (agentId, threadId, turnId) => this.#turn.requestNoUpdate(agentId, threadId, turnId),
        reportRoutineFailure: (agentId, turnId, reason) => this.#turn.reportRoutineFailure(agentId, turnId, reason),
        requestNewChat: (agentId) => {
          this.#requestedNewChats.add(agentId);
        },
        steerAgentMessage: (recipientAgentId, deliveryId) => this.#steerAgentMessage(recipientAgentId, deliveryId),
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

  /** The provider-reported token counts of one turn by provider and model, for host analytics. */
  getTurnUsage(agentId: string, turnId: string, since: string) {
    return this.#store.database.usage.readTurn(agentId, turnId, since);
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

  /** The readings of the provider accounts after the first. The provider's own sign-ins are not read. */
  getProviderAccountUsage() {
    return this.#providers.accountUsage();
  }

  listAgents(): AgentSummary[] {
    return this.#duplication.visibleAgents(this.#store.list());
  }

  /** The folder that every local agent can change, beside its own workspace. */
  get sharedRoot(): string {
    return this.#store.sharedRoot;
  }

  /**
   * After the account defaults changed from `previous`: each agent that follows a changed one loads
   * its sessions again before its next turn, so its instructions say what it may do now, as after a
   * change of its own setting. The listeners of `agents-changed`, such as the automation server, read
   * the new defaults.
   */
  agentDefaultsChanged(previous: AgentDefaults): void {
    const defaults = this.#store.agentDefaults();
    for (const agent of this.#store.list()) {
      if (standingProfileChanged(agent, agent, defaults, previous)) this.#conversation.unloadAgentThreads(agent.id);
    }
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
  }

  /**
   * The other agents in the agent's sidebar section, in sidebar order, for its instructions. Null when
   * the agent has no section of the user's, or is in the Integrations section: the orchestrators there
   * serve unrelated integrations and choose teammates by fit.
   */
  sectionTeammates(agentId: string): SectionTeammates | null {
    const layout = this.#sidebarLayout?.getSnapshot();
    const section = layout?.sections.find((entry) => entry.id === layout.agentAssignments[agentId]);
    if (!layout || !section || section.name === sourceText("status.messaging.integrationsSection")) return null;
    const rank = (id: string) => {
      const index = layout.agentOrder.indexOf(id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const members = this.listAgents()
      // A hidden agent takes no new messages, so it is not offered as a teammate.
      .filter(
        (agent) =>
          agent.id !== agentId && agent.hiddenAt === undefined && layout.agentAssignments[agent.id] === section.id,
      )
      .sort((a, b) => rank(a.id) - rank(b.id))
      .slice(0, MAX_SECTION_TEAMMATES)
      .map((agent) => ({ id: agent.id, name: agent.name, title: agent.title }));
    return members.length > 0 ? { name: section.name, members } : null;
  }

  /**
   * Every id the sidebar layout may place: agents and channels alike, because the user files and
   * orders both in the same sections. An id missing from this set is pruned as gone the next time
   * the layout is reconciled, which would silently drop where the user put a channel.
   *
   * Channels come first. The layout store appends the ids that `agentOrder` does not hold yet in this
   * order, and the sidebar shows those channels above those agents. In another order, the first drop
   * after a chat was filed with "Move to" lands in a different place than the sidebar showed (#3229).
   */
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
    });
  }

  agentIdForRequest(requestId: string | number): string | undefined {
    return this.#attention.agentIdForRequest(requestId);
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

  /**
   * Why this instance must not restart right now, or empty when nothing holds it. Read-only:
   * every source below is also what the drain loop and the shutdown path consult, so the answer
   * agrees with what stopping would interrupt. Scheduled future routine runs do not count; they
   * resume from durable rows after a restart.
   */
  /** The next scheduled routine run of any agent or channel, or null when none is scheduled. */
  nextRoutineDueAt(): string | null {
    return this.#routineTimer.nextDueAt();
  }

  hasActiveWork(): string[] {
    const reasons: string[] = [];
    for (const [, snapshot] of this.#conversation.activeSnapshots()) {
      if (snapshot.activeTurnId && !this.#conversation.isExecutionThread(snapshot.threadId)) {
        reasons.push("agent-turn");
        break;
      }
    }
    if (this.listAgents().some((agent) => this.#mailbox.hasUnfinishedDelivery(agent.id))) {
      reasons.push("queued-delivery");
    }
    // A scheduled drain with nothing behind it is a no-op microtask, not work: only an
    // in-flight drain carrying an unfinished delivery or a live turn holds the restart.
    for (const agent of this.listAgents()) {
      if (
        this.#drain.taskFor(agent.id) &&
        (this.#mailbox.hasUnfinishedDelivery(agent.id) || this.#conversation.anyWorkingSnapshot(agent.id)?.activeTurnId)
      ) {
        reasons.push("drain-task");
        break;
      }
    }
    if (this.#routines.hasActiveRuns() || this.#channelRoutines.hasActiveRuns()) reasons.push("routine-run");
    if (this.channels.hasActiveWork()) reasons.push("channel-work");
    if (this.#providers.activeProcessCount() > 0) reasons.push("provider-process");
    return reasons;
  }

  /**
   * The user starts to save the agent's instruction file: a turn that runs now does not show the
   * save as the agent's change. Call the result when the save ends.
   */
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

  /** How many memories one agent can hold now. */
  memoryLimit(): number {
    return this.#memories.limit();
  }

  /** The developer instructions state the limit, so a new limit reloads every agent's threads. */
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

  /** Plans the routine timer again, after an outside source changed its next due time. */
  armRoutines(): void {
    this.#routineTimer.arm();
  }

  /** Holds routine firing while the system sleeps. See RoutineTimer.suspend. */
  suspendRoutines(): void {
    this.#routineTimer.suspend();
  }

  resumeRoutines(): void {
    this.#routineTimer.resume();
  }

  /** Holds routine firing while a restart of the app waits for the agents. See RoutineTimer.hold. */
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

  /** Hands a routine run's work on to the next agent of its flow; answers the delivery id. */
  enqueueRoutineHandoff(input: {
    run: Pick<RoutineRun, "id" | "routineId" | "routineName" | "scheduledFor">;
    agentId: string;
    text: string;
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

  /** A run that a local script starts through the automation server. Only for agents that allow it. */
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

  /** The command the user copies to run a routine from a local script. */
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

  /** `withSkipped` adds the skipped-run records, which only the local history shows. */
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

  /**
   * The MCP servers this machine holds.
   *
   * Configurations only: OpenBot holds no connection of its own to report. A connection is made
   * when the user asks for a test, and when an agent starts - and the second is the provider's own.
   */
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

  /**
   * Marks every agent's provider session for refresh, spent before its next turn.
   *
   * The mark is what a managed tool runtime becoming ready spends: a session that dropped its
   * `npx` servers before Bun finished downloading is replaced once they can start. Mid-turn
   * sessions keep the mark until the turn ends, and the public threads and their histories stay.
   */
  refreshAllAgentRuntimes(): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#threads.refreshAllAgentRuntimes();
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
  ): Effect.Effect<McpTestResult, AgentLifecycleFailed> {
    return this.#mcp
      .signIn(input, open)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "signInMcpServer", cause: failure.cause })),
      );
  }

  cancelMcpSignIn(input: CancelMcpSignInInput): void {
    this.#mcp.cancelSignIn(input.url);
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

  enabledMcpServers(): McpServerConfig[] {
    return this.#mcp.enabled();
  }

  /**
   * The Computer Use capability, as the main process alone can know it.
   *
   * Here rather than on the runtime directly, so the main process does not reach past this class
   * into the providers it owns.
   */
  setComputerUseCapability(state: CapabilityState): void {
    this.#providers.setComputerUseCapability(state);
  }

  /**
   * The driver appeared or went away, so every loaded provider session now lists the wrong tools.
   *
   * Same treatment as a saved or removed server: the agents are marked for a fresh provider session
   * and the public thread is untouched.
   */
  notifyComputerUseChanged(): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#mcp.changed().pipe(
      Effect.asVoid,
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "refresh computer use", cause: failure.cause }),
      ),
    );
  }

  /**
   * When the oldest running agent turn started, or null while none runs. The Computer Use rim is up
   * only for an action made since then.
   */
  earliestRunningTurnStartedAt(): number | null {
    return this.#turn.earliestRunningTurnStartedAt();
  }

  /**
   * GitHub was connected, disconnected or expired. The same treatment as the Computer Use entry,
   * and the processes that read the `gh` and `git` variables only at spawn start again.
   */
  readonly notifyGitHubConnectorChanged = Effect.fn("AgentService.notifyGitHubConnectorChanged")(function* (
    this: AgentService,
  ) {
    yield* this.#mcp
      .changed()
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "refresh GitHub tools", cause: failure.cause }),
        ),
      );
    yield* this.#providers.reloadAgentEnvironment();
  }).bind(this);

  /**
   * A setting that lives outside the agent store changed, such as an agent's auto-approve grant.
   * Clients of this host read those settings again when the agent list changes. A grant given now
   * also answers the requests that already wait for it.
   */
  notifyAgentsChanged(): void {
    this.#attention.answerGrantedRequests();
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
  }

  /** The installed skills of one agent changed, so every open skills list reads them again. */
  notifySkillsChanged(agentId: string): void {
    this.#emit({ type: "skills-changed", agentId });
  }

  /** A routine result destination or delivery of one agent changed, so every routine editor reads it again. */
  notifyRoutineResultsChanged(agentId: string): void {
    this.#emit({ type: "routines-changed", agentId });
  }

  /** The routine canvas of one agent changed, so every view showing it reads it again. */
  notifyRoutineFlowsChanged(agentId: string): void {
    this.#emit({ type: "routine-flows-changed", agentId });
  }

  /** A workflow changed, so every view showing it reads it again. */
  notifyWorkflowsChanged(workflowId: string): void {
    this.#emit({ type: "workflows-changed", workflowId });
  }

  /** The Vault of this computer changed. A joined admin's Server settings read it again (`vault-v1`). */
  notifyVaultChanged(): void {
    this.#emit({ type: "vault-changed" });
  }

  /**
   * The named browser profiles, or the profile of an agent, changed. The settings of this window and
   * of each joined client read them again (`browser-profiles-events-v1`).
   */
  notifyBrowserProfilesChanged(): void {
    this.#emit({ type: "browser-profiles-changed" });
  }

  notifyWorkflowRunEnded(end: WorkflowRunEnd): void {
    this.emit("workflowRun", end);
  }

  listModels(): AgentModelOption[] {
    return this.#endpoints.available();
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
      const models = this.#endpoints.available();
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
        generateProfile(client, model, input, sections, cancelled),
      );
    },
    Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "generate profile", cause: failure.cause })),
  ).bind(this);

  /**
   * Answers a question about an agent's chat with the agent's own model. Nothing is kept: the
   * generation has no tools, no session and no thread, and the answer goes back to the caller only.
   */
  readonly askSideQuestion = Effect.fn("AgentService.askSideQuestion")(
    function* (this: AgentService, input: AskSideQuestionInput) {
      const failed = (message: string) => new ProfileGenerationFailed({ cause: new Error(message) });
      const agent = this.listAgents().find((candidate) => candidate.id === input.agentId);
      if (!agent) return yield* failed(sourceText("error.agent.gone"));
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.agent.sideQuestionBusy"));
      yield* this.#providers.ensureProvider(agent.provider);
      const model = this.#endpoints
        .available()
        .find((candidate) => candidate.provider === agent.provider && candidate.id === agent.model);
      if (!model) return yield* failed(sourceText("error.provider.noModel"));
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.agent.sideQuestionBusy"));
      const messages =
        this.#conversation.loadedSnapshot(agent.id)?.messages ??
        this.#store.database.readConversationPage(
          agent.id,
          agent.threadId,
          { type: "latest" },
          SIDE_QUESTION_CHAT_MESSAGES,
        ).messages;
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
          // The generation's own messages name a profile.
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

  /**
   * Answers one model step of a workflow. Like a side question, the generation has no tools, no
   * session and no thread. A missing provider or model falls back to the user's starting choice.
   */
  readonly generateWorkflowText = Effect.fn("AgentService.generateWorkflowText")(
    function* (
      this: AgentService,
      input: {
        provider: AgentProvider | null;
        model: string | null;
        effort: AgentReasoningEffort | null;
        prompt: string;
      },
    ) {
      const failed = (message: string) => new ProfileGenerationFailed({ cause: new Error(message) });
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      const provider = input.provider ?? this.#startingChoice()?.provider ?? this.#providers.preferredProvider();
      yield* this.#providers.ensureProvider(provider);
      const models = this.#endpoints.available();
      const model =
        (input.model === null
          ? undefined
          : models.find((candidate) => candidate.provider === provider && candidate.id === input.model)) ??
        startingModel(provider, models, this.#preference());
      if (!model) return yield* failed(sourceText("error.provider.noModel"));
      if (this.#stopping) return yield* failed(sourceText("error.backend.shuttingDown"));
      if (this.#profileClients.busy()) return yield* failed(sourceText("error.workflow.modelBusy"));
      return yield* this.#warmGenerations
        .generate(
          provider,
          { ...model, defaultReasoningEffort: input.effort ?? model.defaultReasoningEffort },
          input.prompt,
          workflowUsageObserver(this.#store.database.usage, provider, model.id),
        )
        .pipe(
          Effect.tapError((failure) =>
            Effect.sync(() => logger.warn("Could not answer a workflow step.", { provider, error: failure.cause })),
          ),
          // The generation's own messages name a profile.
          Effect.mapError((failure) =>
            failed(
              failure instanceof GenerationUsageLimitError
                ? sourceText("error.provider.usageLimitReached")
                : sourceText("error.workflow.modelFailed"),
            ),
          ),
        );
    },
    Effect.mapError(
      (failure) => new AgentLifecycleFailed({ operation: "generate workflow text", cause: failure.cause }),
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

  /**
   * The provider that `createAgent` or `createAgentProfile` puts a new agent on: the one of the model
   * or provider that `input` names, else the starting choice. `null` when nothing lists a model, and
   * the record keeps the built-in default.
   */
  newAgentProvider(input: Pick<CreateAgentInput, "provider" | "model"> = {}): AgentProvider | null {
    return (
      (creationModel(input, this.#endpoints.available(), this.#providers.status().providers) ?? this.#startingChoice())
        ?.provider ?? null
    );
  }

  /**
   * Claude and the app-server providers report each compaction. A `handoff` provider is compacted by
   * OpenBot, which gives the new session the complete prompt, and the ACP client reports a compaction
   * that the agent does by itself. Another ACP agent or Pi can compact with no signal, so a prompt
   * that names earlier context instead of repeating it could lose what the summary dropped.
   */
  #reportsCompactions(agentId: string): boolean {
    const agent = this.#store.list().find((item) => item.id === agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    return mode === "native" || mode === "events" || mode === "handoff";
  }

  /** The provider and model setup or Settings recorded. */
  #preference(): ProviderPreference {
    return { provider: this.#providers.preferredProvider(), model: this.#providers.preferredModel() };
  }

  /** `sender` is the person who writes the first message, as `sendMessage` takes it. */

  readonly createAgent = Effect.fn("AgentService.createAgent")(function* (
    this: AgentService,
    input: CreateAgentInput,
    configure?: (agent: AgentSummary) => Effect.Effect<AgentSummary, AgentLifecycleFailed>,
    profileOperationId?: string,
    sender?: ConversationMessageSender,
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
        yield* this.sendMessage({ agentId: agent.id, text: initialMessage, attachmentDraftIds: [] }, sender);
        return this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent;
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

  #assignNewAgentModel(agent: AgentSummary, input: Omit<CreateAgentInput, "initialMessage">, needsModel: boolean) {
    return this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const requested = yield* lifecycleStep("select requested model", () =>
            creationModel(input, this.#endpoints.available(), this.#providers.status().providers),
          );
          if (requested) {
            yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requested.provider));
            // The new-agent form names the development default's model but no effort, so the effort
            // comes from that default, as it does for an agent that names no model.
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
            });
          }
          const starting = this.#startingChoice();
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

  /** Where a new agent that names no model starts: the saved choice, else its provider default (Luna 6 for ChatGPT). */
  #startingChoice(): ModelChoice | null {
    return startingChoice(this.#endpoints.available(), this.#preference(), {
      developmentDefaults: this.#developmentDefaults,
      providerAvailable: (provider) => this.#providerAvailable(provider),
    });
  }

  /**
   * Moves a new record onto `starting`. A new record starts on the built-in default provider, so this
   * is the one place a preferred provider lands on a new agent -- and with it the model setup chose,
   * which is how a custom endpoint becomes the default: it is a model of the CLI that runs it, never a
   * provider. A record already on the chosen model keeps its effort, which is the low one a new agent
   * leads with rather than the one the CLI reports.
   */
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
    input: Omit<CreateAgentInput, "initialMessage"> & { title?: string },
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
        agent = yield* this.#assignNewAgentModel(agent, input, false);
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

  /** The agents a user hid, oldest hide first. */
  listHiddenAgents(): HiddenAgentsSnapshot {
    return {
      agents: this.listAgents()
        .flatMap((agent) => (agent.hiddenAt === undefined ? [] : [{ agentId: agent.id, hiddenAt: agent.hiddenAt }]))
        .sort(
          (left, right) => left.hiddenAt.localeCompare(right.hiddenAt) || left.agentId.localeCompare(right.agentId),
        ),
    };
  }

  #hiddenAgentIds(): string[] {
    return this.#store
      .list()
      .filter((agent) => agent.hiddenAt !== undefined)
      .map((agent) => agent.id);
  }

  /**
   * Hides or restores an agent. A request that does not change the state answers the same list. A
   * hidden agent keeps all of its data. A turn that runs finishes, and its queued messages wait. On
   * restore, the routine occurrences that came due while it was hidden are skipped, and its queue
   * drains again.
   */
  readonly setAgentHidden = Effect.fn("AgentService.setAgentHidden")(function* (
    this: AgentService,
    input: SetAgentHiddenInput,
  ) {
    const changed = yield* lifecycleStep("set agent hidden", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId)) {
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
      }
      if (this.#store.isHidden(input.agentId) === input.hidden) return false;
      const now = new Date();
      // While the agent is still hidden, so the timer cannot fire an occurrence that this skips.
      if (!input.hidden) this.#routines.skipMissedFor(input.agentId, now);
      this.#store.setHidden(input.agentId, input.hidden ? now.toISOString() : null);
      return true;
    });
    const snapshot = this.listHiddenAgents();
    if (!changed) return snapshot;
    this.#routines.arm();
    if (input.hidden) {
      // The channel work that waits in its queue goes back to the channel, so it holds nothing.
      yield* this.channels
        .releaseAgent(input.agentId)
        .pipe(
          Effect.catch((failure) => Effect.sync(() => this.#emitError("channel_coordination_failed", failure.cause))),
        );
    } else {
      // The queue event also wakes the channels whose task waits for this agent.
      this.#mailboxSync.emitQueue(input.agentId);
      this.#drain.scheduleDrain(input.agentId);
    }
    this.#emit({ type: "hidden-agents-changed", agents: snapshot.agents });
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return snapshot;
  }).bind(this);

  /** Refuses new work for a hidden agent. A turn that already runs is not affected. */
  #requireNotHidden(agentId: string): void {
    if (this.#store.isHidden(agentId)) throw new Error(sourceText("error.backend.recipientHidden"));
  }

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

  /**
   * `initiatingAgentId` is set when an agent, not the user, asks for the change. `queueWhileBusy`
   * is false for a Team API client: its released protocol has no `pendingRuntime`, so a provider
   * change during work is refused for it as before.
   */
  updateAgent(
    input: AgentUpdate,
    initiatingAgentId?: string,
    queueWhileBusy = true,
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed> {
    return this.#endpoints
      .runExclusive(() => this.#applyAgentUpdate(input, initiatingAgentId, null, queueWhileBusy))
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "updateAgent", cause: failure.cause })));
  }

  /**
   * `move` is "return" for the move back to the model a usage limit or a provider error made the
   * agent leave, "provider-error" for the move away from a model that failed a turn, and "next-turn"
   * for a queued `pendingRuntime` that applies before the next turn. `queueWhileBusy` is set for a
   * change that a user or an agent asks for: while work runs, a handover is stored as
   * `pendingRuntime` instead of refused.
   */
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
    // A provider change waits until the agent has no work. It is checked again after the reads below.
    // The text of the refusal, or null when the agent is idle.
    const idleRefusal = (previous: AgentSummary) => {
      // A spent plan holds the queue until it resets, and a switch to another provider is the way out
      // of that hold. So while the hold lasts, only started work blocks the switch; the queue then
      // runs on the new provider. The move back after the limit takes the queue with it too, and so
      // does the move away from a model that failed: the failed turn's messages wait in the queue.
      // A queued change applies before the next queued message starts, so it takes the queue too.
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
    const { previous, requestedModel, requestedProvider, previousAccount, requestedAccount } = yield* lifecycleStep(
      "validate agent update",
      () => {
        this.#conversation.requireKnownAgent(input.agentId);
        const previous = this.#store.list().find((agent) => agent.id === input.agentId);
        const requestedModel = input.model
          ? this.#endpoints
              .available()
              .find((model) => model.id === input.model && (!input.provider || model.provider === input.provider))
          : undefined;
        if (input.model && !requestedModel) {
          // A change of model alone stays on the agent's provider, so that provider is the one to explain.
          const provider = input.provider ?? (previous ? providerForAgent(previous) : undefined);
          throw new AgentSettingsRefused(
            modelUnavailableError(
              input.model,
              provider,
              this.#endpoints.available(),
              this.#providers.status().providers ?? [],
            ).message,
          );
        }
        const requestedProvider = input.provider ?? requestedModel?.provider ?? previous?.provider;
        if (input.provider && requestedModel && requestedModel.provider !== input.provider) {
          throw new AgentSettingsRefused(sourceText("error.agent.modelProviderMismatch"));
        }
        if (requestedProvider && previous && requestedProvider !== providerForAgent(previous)) {
          if (!input.model || !input.provider) {
            throw new Error("Changing provider requires an atomic provider and model selection.");
          }
          // A change that a user or an agent asks for while work runs is queued below. Automatic moves wait.
          if (!queueWhileBusy) requireIdle(previous);
        }
        // An account belongs to one provider, so a provider change without one returns the agent to
        // the new provider's own sign-in.
        const previousAccount = previous ? agentProviderAccount(previous) : null;
        const requestedAccount =
          input.providerAccountId !== undefined
            ? agentProviderAccount({ providerAccountId: input.providerAccountId ?? undefined })
            : previous && requestedProvider !== providerForAgent(previous)
              ? null
              : previousAccount;
        // Only a requested account is checked: an agent whose account record is lost (a damaged or
        // newer store) can still be renamed or moved to another account.
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
        // The sessions of one account are not in the folder of another, so an account change is
        // handed over like a provider change. A requested change while work runs is queued below.
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
    // Only an update of the runtime alone waits for the next turn. An update with other fields is
    // refused while work runs, as before, and so is a move to a backup model: `pendingRuntime` does
    // not keep the model to go back to.
    const queueable =
      queueWhileBusy &&
      previous !== undefined &&
      !input.leaveUsageLimit &&
      Object.keys(input).every((key) => RUNTIME_UPDATE_KEYS.has(key));
    const queue = (pendingRuntime: AgentPendingRuntime) =>
      this.#store.updateAgent({ agentId: input.agentId, pendingRuntime }, initiatingAgentId).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            this.#emit({ type: "agents-changed", agents: this.listAgents() });
            this.#drain.scheduleDrain(input.agentId);
          }),
        ),
      );
    // An effort that the queued model does not support becomes the model's default.
    const queuedEffort = (effort: AgentReasoningEffort, model = requestedModel) =>
      model && !model.supportedReasoningEfforts.includes(effort) ? model.defaultReasoningEffort : effort;
    if (queueable && previous && requestedProvider && runtimeFields && handoverNeeded && idleRefusal(previous)) {
      yield* this.#providers.ensureProvider(requestedProvider);
      if (input.provider || input.model)
        yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requestedProvider));
      return yield* queue({
        provider: requestedProvider,
        model: requestedModel?.id ?? previous.model,
        reasoningEffort: queuedEffort(
          input.reasoningEffort ?? previous.pendingRuntime?.reasoningEffort ?? previous.reasoningEffort,
        ),
        ...(requestedAccount ? { providerAccountId: requestedAccount } : {}),
      });
    }
    // An effort change while a queued change waits edits the queued change, also when a hold keeps
    // the change from applying on an idle agent: the pickers show the queued runtime. So does a model
    // change of the same provider when the queued change keeps the provider (an account or a custom
    // agent). A model of another provider names the provider, and is queued or applied above or below.
    const queued = previous?.pendingRuntime;
    if (
      queueable &&
      queued &&
      !handoverNeeded &&
      input.provider === undefined &&
      input.providerAccountId === undefined &&
      (requestedModel ? requestedModel.provider === queued.provider : input.reasoningEffort !== undefined)
    ) {
      const queuedModel =
        requestedModel ??
        this.#endpoints.available().find((model) => model.provider === queued.provider && model.id === queued.model);
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
      // Before the sessions are retired below, while the previous provider still holds them. The
      // steps are saved only once the switch is stored: a switch that fails keeps the session.
      // A task is a conversation of the agent, so it moves to the new provider with the agent's chat.
      const sessions = yield* lifecycleStep("read provider sessions", () =>
        handedOverThreads(previous).flatMap((threadId) => this.#store.database.listProviderSessions(threadId)),
      );
      for (const session of sessions.filter((one) => one.state === "active")) {
        const steps = yield* this.#threads.readWorkSteps(session);
        if (steps !== null) captures.push([session, steps]);
      }
      // The reads and the provider start take time, and a message sent in it can start a turn.
      yield* lifecycleStep("validate agent update", () => requireIdle(previous));
    }
    if (requestedProvider && (input.provider || input.model))
      yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requestedProvider));
    // Leaving a model at its usage limit or after a provider error keeps the model to go back to:
    // the first one left, when the agent moves on from one backup to the next.
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
    const returnTo =
      leaving && previous && previousChoice
        ? (previous.usageLimitReturn ?? {
            ...previousChoice,
            reasoningEffort: previous.reasoningEffort,
            ...(failingOver ? { cause: "provider-error" as const } : {}),
          })
        : undefined;
    const usageLimitReturn =
      returning || (returnTo && nextChoice && sameAgentModelChoice(returnTo, nextChoice)) ? null : returnTo;
    const agent = yield* this.#store.updateAgent(
      {
        ...input,
        ...(requestedModel && !input.provider ? { provider: requestedModel.provider } : {}),
        ...(previous && (accountChanged || input.providerAccountId !== undefined)
          ? { providerAccountId: requestedAccount }
          : {}),
        ...(usageLimitReturn !== undefined ? { usageLimitReturn } : {}),
        // A Team API client cannot see the queued change, so only a handover from it ends the change.
        ...(runtimeFields && (queueWhileBusy || handoverNeeded) ? { pendingRuntime: null } : {}),
      },
      initiatingAgentId,
    );
    // A tab keeps the session it opened in, so the agent's next tab opens in the session it chose now.
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
      );
    const profileChanged = standingProfileChanged(previous, agent, this.#store.agentDefaults());
    const activeSession = this.#store.activeProviderSession(agent.id);
    const providerChanged = handoverNeeded;
    if (previous && providerChanged) {
      // Retire first, with no wait after the update: a turn that starts while a file is written
      // binds a session of the new provider, and a later retirement would close that one too.
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
    // Re-resume before the next turn so the provider receives the updated standing instructions.
    // Codex keeps the ones a loaded session started with, so `ThreadLifecycle.ensureThread` replaces
    // that session instead - see `toolFingerprint`. The
    // agent chat is not the only session that holds them: a channel turn runs on a session of its
    // own, and it is written from the same profile.
    if (profileChanged) this.#conversation.unloadAgentThreads(agent.id);
    // A Workspace only agent moved to Full access gets no grant event, and its cards wait for that grant.
    if (previous && workspaceAccessEnforced(previous) && !workspaceAccessEnforced(agent))
      this.#attention.answerGrantedRequests();
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    // The task limit follows the agent's own setting and its provider. A higher one can start a task now.
    if (providerChanged || (previous && agentTaskLimit(previous) !== agentTaskLimit(agent))) {
      this.#tasks.changed(agent.id);
      this.#drain.scheduleDrain(agent.id);
    }
    // A plan limit belongs to a provider and a model, so a model change can end a hold or start one.
    // Leaving a hold, nothing else would start the queue before the limit it left resets. Entering
    // one, the queue is settled as at any other start of a hold.
    const isHeld = !this.#usageLimits.mayDrain(agent.id);
    if (providerChanged || wasHeld !== isHeld) this.#emitRuntimeSnapshot();
    if (wasHeld && !isHeld) {
      this.#drain.scheduleDrain(agent.id);
      // A channel task that the hold gave back waits in its channel, not in this queue.
      yield* this.channels
        .wake()
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#emitError("usage_limit_release_failed", failure.cause, agent.id)),
          ),
        );
    } else if (!wasHeld && isHeld) {
      // Not awaited, as at any other start of a hold.
      yield* this.#settleHeldQueues([agent.id]).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause, agent.id)),
        ),
        Effect.forkIn(this.#scope),
      );
    } else if (providerChanged && !isHeld) {
      // A hold that started during the switch let queued work through the second `requireIdle`, and
      // its release drains only the agents still on the spent model.
      this.#drain.scheduleDrain(agent.id);
    } else if (isHeld && input.backupModels !== undefined) {
      // New backup models can let the held queue move now, and the chat no longer asks.
      this.#drain.scheduleDrain(agent.id);
    }
    return agent;
  }, Effect.uninterruptible);

  /**
   * The model a usage limit or a provider error moves this agent to now, or null. An agent goes back
   * to the model it left once no limit or provider error holds that model. An agent held by a limit,
   * or whose model failed a turn with a provider error, set to switch without asking and with queued
   * work or channel work that waits for it, moves to its first backup model that is ready. Only an
   * agent with no started work moves; the end of its turn tries again.
   */
  #usageLimitMove(agentId: string): { input: UpdateAgentInput; move: ModelMove | null } | null {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent || (!agent.usageLimitReturn && !agent.backupModels?.automatic)) return null;
    if (this.#runsTurn(agentId) || this.#mailbox.hasStartedDelivery(agentId)) return null;
    // The agent keeps its reasoning effort where the other model has it. It goes back with the effort it left.
    const move = (choice: AgentModelChoice, reasoningEffort = agent.reasoningEffort) => {
      const model = this.#endpoints
        .available()
        .find((option) => option.provider === choice.provider && option.id === choice.model);
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
    };
    if (agent.usageLimitReturn && this.#usageLimitReady(agent.usageLimitReturn))
      return { input: move(agent.usageLimitReturn, agent.usageLimitReturn.reasoningEffort), move: "return" };
    const limited = !this.#usageLimits.mayDrain(agentId);
    const failed = !limited && this.#usageLimits.isFailed(usageLimitOf(agentModelChoice(agent)));
    if (!limited && !failed) return null;
    const taskWork = () =>
      this.#mailbox.queuedTaskIds(agentId).some((taskId) => this.#mailbox.nextQueued(agentId, taskId));
    // A channel task that the limit refused went back to its channel, so the queue can be empty.
    if (!this.#mailbox.nextQueued(agentId) && !taskWork() && !this.channels.ownsWaitingWork(agentId)) return null;
    const next = this.#usageLimitBackup(agentId);
    return next ? { input: { ...move(next), leaveUsageLimit: true }, move: failed ? "provider-error" : null } : null;
  }

  /** The first ready backup model of an agent set to switch without asking, or undefined. */
  #usageLimitBackup(agentId: string): AgentModelChoice | undefined {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent?.backupModels?.automatic) return undefined;
    const current = agentModelChoice(agent);
    return agent.backupModels.order.find(
      (choice) => !sameAgentModelChoice(choice, current) && this.#usageLimitReady(choice),
    );
  }

  /** Whether the model is ready, and no usage limit or provider error holds it. */
  #usageLimitReady(choice: AgentModelChoice): boolean {
    const limit = usageLimitOf(choice);
    return this.#modelChoiceReady(choice) && !this.#usageLimits.isLimited(limit) && !this.#usageLimits.isFailed(limit);
  }

  /**
   * Whether the provider is on and signed in, the account is connected, and the model list has the
   * model. The same check as `backupModelOption` in the settings page and the chat card.
   */
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
      this.#endpoints.available().some((model) => model.provider === choice.provider && model.id === choice.model)
    );
  }

  /**
   * True while a provider handover would break a running turn, task, or started delivery. It sees a
   * turn that the database still records too, as the idle check of `#applyAgentUpdate` does, so a
   * queued change waits for that turn and is not dropped as a failure.
   */
  #runtimeHandoverBusy(agentId: string): boolean {
    const threadId = this.#store.list().find((candidate) => candidate.id === agentId)?.threadId;
    return (
      this.#runsTurn(agentId) ||
      this.#mailbox.hasStartedDelivery(agentId) ||
      this.#conversation.workingTaskSnapshots(agentId).length > 0 ||
      (threadId ? this.#store.database.readActiveTurnId(agentId, threadId) !== null : false)
    );
  }

  /** A queued provider change is ready to apply: the agent is idle. */
  #pendingRuntimeDue(agentId: string): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    return Boolean(agent?.pendingRuntime) && !this.#runtimeHandoverBusy(agentId);
  }

  /** Applies `pendingRuntime` once the agent is idle. True when the agent moved. */
  readonly #followPendingRuntime = Effect.fn("AgentService.followPendingRuntime")(function* (
    this: AgentService,
    agentId: string,
  ) {
    return yield* this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const agent = this.#store.list().find((candidate) => candidate.id === agentId);
          const pending = agent?.pendingRuntime;
          if (!pending || this.#runtimeHandoverBusy(agentId)) return false;
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
            // A change that fails on an idle agent, such as a provider that is now off, would fail again
            // before each turn. The agent stays on its provider, and the header stops showing the change.
            if (this.#runtimeHandoverBusy(agentId)) return false;
            const cleared = yield* Effect.exit(this.#store.updateAgent({ agentId, pendingRuntime: null }));
            if (Exit.isSuccess(cleared)) this.#emit({ type: "agents-changed", agents: this.listAgents() });
            return false;
          }),
        ),
      );
  });

  /** Makes the move of `#usageLimitMove`, if one is due. True when the agent moved. */
  readonly #followUsageLimit = Effect.fn("AgentService.followUsageLimit")(function* (
    this: AgentService,
    agentId: string,
  ) {
    return yield* this.#endpoints
      .runExclusive(() =>
        Effect.gen({ self: this }, function* () {
          const move = this.#usageLimitMove(agentId);
          if (!move) return false;
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

  /** Appends a system line to the agent's own chat, outside any turn. */
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

  /** Appends a system line to one side thread of the agent, outside any turn. */
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

  /**
   * A note in the agent's chat that it left its model for a usage limit or a provider error, or went back to it. Each
   * channel whose work waits for the agent gets the same note.
   */
  #appendModelSwitchMarker(agent: AgentSummary, reason: ModelSwitchReason): void {
    const model =
      this.#endpoints.available().find((option) => option.provider === agent.provider && option.id === agent.model)
        ?.name ?? agent.model;
    const text = sourceText(MODEL_SWITCH_TEXT[reason], { model });
    try {
      this.channels.noteModelSwitch(agent.id, text, MODEL_SWITCH_ITEM_TYPES[reason]);
    } catch (error) {
      this.#emitError("model_switch_marker_failed", error, agent.id);
    }
    try {
      this.#appendSystemMessage(
        agent.id,
        {
          id: `model-switch-${randomUUID()}`,
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
      // The switch is stored; only its note is lost.
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

  /**
   * Starts a new chat with the agent and keeps the agent. A marker goes into the agent's own thread,
   * and its provider sessions end, so the next turn starts a new session that does not see the
   * messages before the marker. The messages stay visible, and the profile, memories, workspace, and
   * browser do not change.
   */
  readonly clearAgentContext = Effect.fn("AgentService.clearAgentContext")(function* (
    this: AgentService,
    agentId: string,
  ) {
    // A new chat ends the automatic plan continuation of the agent's own chat.
    yield* this.#drain.endPlanContinuation(agentId, null);
    const threadId = yield* lifecycleStep("clear agent context", () => {
      const agent = this.#conversation.requireKnownAgent(agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(agentId)?.activeTurnId ??
        (agent.threadId ? this.#store.database.readActiveTurnId(agentId, agent.threadId) : null);
      if (
        activeTurn ||
        this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agentId) ||
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

  /**
   * Compacts the context of the agent's own chat now, below the automatic threshold too. Only for a
   * provider that OpenBot can ask to compact, and only when no turn or queued message needs the session.
   */
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
        this.#mailbox.hasUnfinishedDeliveryOutsideTasks(agentId) ||
        this.#threads.mainContextBusy(agent)
      )
        throw new Error(sourceText("error.agent.waitBeforeCompactContext"));
      const session = agent.threadId
        ? this.#store.database.activeProviderSession(agent.threadId, agent.provider)
        : null;
      if (!session || !this.#compaction.reserve(agentId, session.externalSessionId, true))
        throw new Error(sourceText("error.agent.compactContextUnavailable"));
      return session.externalSessionId;
    });
    yield* this.#compaction.request(agentId, externalThreadId);
  }, Effect.uninterruptible).bind(this);

  /** As `compactAgentContext`, for the session of one open side thread of the agent. */
  readonly compactTaskContext = Effect.fn("AgentService.compactTaskContext")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ) {
    const externalThreadId = yield* lifecycleStep("compact task context", () => {
      const agent = this.#conversation.requireKnownAgent(input.agentId);
      const task = this.#tasks.requireOpen(input.agentId, input.taskId);
      const session = this.#store.database.activeProviderSession(task.threadId, agent.provider);
      // A compaction that still runs, or a start that the provider refused, holds the session too.
      if (
        this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId ||
        this.#store.database.readActiveTurnId(agent.id, task.threadId) ||
        this.#mailbox.taskBusy(agent.id, task.taskId) ||
        (session && this.#compaction.heldThreads(agent.id).includes(session.externalSessionId))
      )
        throw new Error(sourceText("error.agent.waitBeforeCompactContext"));
      if (!session || !this.#compaction.reserve(agent.id, session.externalSessionId, true))
        throw new Error(sourceText("error.agent.compactContextUnavailable"));
      return session.externalSessionId;
    });
    yield* this.#compaction.request(input.agentId, externalThreadId);
  }, Effect.uninterruptible).bind(this);

  /**
   * The new chat that the agent asked for with `start_new_chat`. The drain calls it when the agent's
   * own chat has nothing to start. A turn of a task or a compaction can still run; the request then
   * waits for the next drain, unless a turn in the agent's own chat starts first. The user can turn
   * the setting off while the request waits.
   */
  #startRequestedNewChat(agentId: string): Effect.Effect<void> {
    if (!this.#requestedNewChats.has(agentId)) return Effect.void;
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent || !agentNewChatAllowed(agent, this.#store.agentDefaults())) {
      this.#requestedNewChats.delete(agentId);
      return Effect.void;
    }
    return this.clearAgentContext(agentId).pipe(
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
  }

  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    return this.#store.resolveAvatar(agentId);
  }

  resolveSharedFile(
    inputPath: string,
    options?: { allowDirectory?: boolean },
  ): Effect.Effect<ResolvedSharedFile, AgentLifecycleFailed> {
    return resolveSharedFile(this.#store.sharedRoot, inputPath, options).pipe(
      Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "resolveSharedFile", cause: failure.cause })),
    );
  }

  /** A file a remote member asks for. It must be inside the agent's workspace. */
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

  /** The local user can open files outside a workspace when access is unrestricted. */
  readonly resolveLocalWorkspaceFile = Effect.fn("AgentService.resolveLocalWorkspaceFile")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* resolveWorkspaceFile(agent, inputPath, {
      allowOutside: !workspaceAccessEnforced(agent),
      fileHistory: this.#turn.fileHistory.paths(agent.id, agent.threadId),
    }).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "resolve local workspace file", cause: failure.cause }),
      ),
    );
  }).bind(this);

  /** A folder a remote member asks for. It must be inside the agent's workspace. */
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

  /** The local user can list folders outside a workspace when access is unrestricted. */
  readonly listLocalWorkspaceDirectory = Effect.fn("AgentService.listLocalWorkspaceDirectory")(function* (
    this: AgentService,
    agentId: string,
    inputPath: string,
  ) {
    const agent = yield* lifecycleStep("find workspace agent", () => this.#agentForFile(agentId));
    return yield* listWorkspaceDirectory(agent, inputPath, { allowOutside: !workspaceAccessEnforced(agent) }).pipe(
      Effect.mapError(
        (failure) => new AgentLifecycleFailed({ operation: "list local workspace directory", cause: failure.cause }),
      ),
    );
  }).bind(this);

  #agentForFile(agentId: string): AgentSummary {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
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

  deleteChannel(channelId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.channels
      .deleteChannel(channelId)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteChannel", cause: failure.cause })),
      );
  }

  /** `heldRoutines`: routines due while a restart waited run once. */

  readonly initialize = Effect.fn("AgentService.initialize")(function* (
    this: AgentService,
    options: { heldRoutines?: RoutineHoldWindow | undefined } = {},
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
      this.#mcp.migrateCatalogBridgesToHttp();
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
      this.#routines.skipMissed(new Date(), options.heldRoutines);
      this.#channelRoutines.skipMissed(new Date(), options.heldRoutines);
      this.#initialized = true;
      this.#memoryHold.start();
    });
    yield* this.#providers
      .start()
      .pipe(Effect.mapError((error) => new AgentLifecycleFailed({ operation: "start providers", cause: error.cause })));
    yield* lifecycleStep("publish queues", () => {
      for (const agent of this.#store.list()) this.#mailboxSync.emitQueue(agent.id);
    });
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
    // Turning on can activate models, which takes this same lock. Only off holds it.
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

  /** See `ProviderRuntime.restartProviderWhenIdle`. */
  restartProvider(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .restartProviderWhenIdle(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "restartProvider", cause: failure.cause })),
      );
  }

  cancelProviderRestart(provider: AgentProvider): AgentStatus {
    return this.#providers.cancelProviderRestart(provider);
  }

  connectProvider(
    provider: AgentProvider,
    openExternal: (url: string) => Promise<void>,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .connectProvider(provider, openExternal)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "connectProvider", cause: failure.cause })),
      );
  }

  /** See `ProviderRuntime.connectProviderAccount`. */
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

  /** See `ProviderRuntime.signInProviderAccountOnHost`. */
  signInProviderAccountOnHost(
    provider: AgentProvider,
    accountId: string | null,
    openPage: (url: string) => Promise<void>,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers
      .signInProviderAccountOnHost(provider, accountId, openPage)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "signInProviderAccountOnHost", cause: failure.cause }),
        ),
      );
  }

  /** See `ProviderRuntime.cancelProviderAccountSignIn`. */
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

  /** The usage reset credits of each connected account of a provider. An account that has no count is left out. */
  providerUsageResets(provider: AgentProvider): Effect.Effect<ProviderUsageResets[]> {
    return this.#providers.usageResets(provider);
  }

  /** Spends one usage reset credit of an account. A reset ends the usage limit that holds its agents. */
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
    // `nothingToReset` says that no limit of the account is spent, so a hold on it is out of date too.
    if (outcome === "reset" || outcome === "nothingToReset")
      yield* this.#usageLimits.accountReset(provider, accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? null : accountId);
    return outcome;
  }).bind(this);

  /**
   * Moves the account's agents to the provider's own sign-in, then removes the account and its
   * credentials. Refused while one of those agents has work, as a provider change is.
   */
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
          for (const agent of agents) yield* this.#applyAgentUpdate({ agentId: agent.id, providerAccountId: null });
          // A queued change to the account moves to the provider's own sign-in too, so it does not fail
          // before the next turn. The running turn does not use the account, so it can continue.
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
                pendingRuntime: { ...agent.pendingRuntime, providerAccountId: undefined },
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

  /** Signs the provider's own sign-in out. Its agents keep it and wait until it connects again. */
  signOutProvider(provider: AgentProvider): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .signOutProvider(provider)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "signOutProvider", cause: failure.cause })),
      );
  }

  /** See `ProviderRuntime.signInProviderOnHost`. */
  signInProviderOnHost(
    provider: AgentProvider,
    openPage: (url: string) => Promise<void>,
  ): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#providers
      .signInProviderOnHost(provider, openPage)
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

  startProviderCodeLogin(provider: AgentProvider): Effect.Effect<ProviderCodeLoginStart, AgentLifecycleFailed> {
    return this.#providers
      .startProviderCodeLogin(provider)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "startProviderCodeLogin", cause: failure.cause }),
        ),
      );
  }

  /** Saves an OpenAI API key as Codex's login and restarts Codex on it, as a changed key does. */
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

  /**
   * A stored key serves the provider's own sign-in, and Claude's key also its own account, so a new or
   * removed key ends the limits that hold those agents: they were the old credential's. A limit of the
   * new one holds them again at its first refused turn. Claude's own sign-in uses the key only when it
   * has no claude.ai login, so the limits of that plan stay. A saved Claude key gets its account; a
   * removed one takes its account away, and its agents go back to the provider's own sign-in.
   */
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
          usedKey || this.#providers.ownSignInUsesKey(provider)
            ? this.#usageLimits.accountReset(provider, null)
            : Effect.void,
        ),
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: failure.cause }),
        ),
        Effect.flatMap((status) => (provider === "claude" ? this.#claudeKeyChanged() : Effect.succeed(status))),
      );
  }

  /**
   * `changeProviderCredential` for a removed key. Claude's key account goes first, with the idle check
   * of any removed account, so that a refusal keeps the key: an agent left on the account without its
   * key could not run a turn. The key change refuses while the provider is busy, so that is checked
   * before the account goes too.
   */
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
    // After the removal, so that the released work starts on the provider's own sign-in.
    yield* this.#usageLimits.accountReset("claude", CLAUDE_API_KEY_ACCOUNT_ID);
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

  /** Restarts OpenCode or Pi so a saved or removed endpoint reaches it. Reports why, if it did not. */
  reloadCustomProviderConfig(
    harness: CustomProviderHarness,
  ): Effect.Effect<CustomProviderRestart, AgentLifecycleFailed> {
    return this.#providers.reloadCustomProviderConfig(harness);
  }

  /**
   * Starts the harness that an endpoint moved to, when agents wait for it. They move when it
   * activates, and until then they stay on a harness that no longer lists the endpoint. The start is
   * not awaited: a save does not wait for model discovery. A start that fails is reported, and the
   * agents then move to a model that their harness lists.
   */
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

  /** Replaces the custom agents' router so a saved or removed agent reaches it. Reports why, if it did not. */
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

  /** See `ProviderRuntime.customAgentUsage`. */
  customAgentUsage() {
    return this.#providers.customAgentUsage();
  }

  /** See `CustomEndpoints.saveCustomAgent`. */
  saveCustomAgent<T>(persist: () => Effect.Effect<T, AgentLifecycleFailed>): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .saveCustomAgent(() => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "saveCustomAgent", cause: failure.cause })),
      );
  }

  /** See `CustomEndpoints.removeCustomAgent`: the agents on it move to another provider first. */
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

  /** See `CustomEndpoints.save`: the exclusion of the id being saved and the caller's file write. */
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

  /** See `CustomEndpoints.update`: the agents on removed models, the exclusion, and the file write. */
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

  /** See `CustomEndpoints.remove`: the exclusion, the agents that were on it, and the file write. */
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

  /**
   * True while the CLI runs a turn for this agent. A channel turn runs on a thread of its own, so the
   * agent's own conversation holds no turn id while the CLI works. `workingSnapshot` reads the
   * execution threads as well.
   *
   * A compaction is a provider turn as well, and it holds no active turn id: its `turn/started`
   * belongs to the compaction, not to the agent, so `claimTurn` takes it away. Only its own guard
   * reports the turn the CLI is running.
   */
  #isProviderBusy(provider: AgentProvider): boolean {
    return (
      this.#profileClients.usesProvider(provider) ||
      this.#drain.hasStartingDeliveries(provider) ||
      this.#store.list().some((agent) => providerForAgent(agent) === provider && this.#runsTurn(agent.id))
    );
  }

  #runsTurn(agentId: string): boolean {
    return this.#conversation.anyWorkingSnapshot(agentId) != null || !this.#compaction.mayDrain(agentId);
  }

  /** Whether this provider reports a CLI that is installed, current, and signed in. */
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
    this.#routineTimer.dispose();
    yield* this.#memoryHold.dispose();
    this.#hostedSites.dispose();
    this.#compaction.dispose();
    this.#deltas.dispose();
    this.#conversation.dispose();
    this.#threads.dispose();
    this.#memories.clearPending();
    this.#tables?.dispose();
    this.#attention.clearPrompts();
    this.#attention.clearBrowserTakeovers();
    this.#attention.clearApprovals();
    const clients = [...(yield* this.#providers.dispose()), ...this.#profileClients.release()];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      if (!snapshot.activeTurnId) continue;
      const agent = this.#store.list().find((item) => item.id === agentId);
      const session = agent && snapshot.threadId ? this.#runningSession(agent, snapshot.threadId) : undefined;
      if (session) this.#images.interrupt(agentId, session, snapshot.activeTurnId);
    }
    yield* this.#turn.dispose();
    yield* this.#usageLimits.dispose();
    this.#drain.dispose();
    this.#planContinuation.dispose();
    this.#browser.clearControls();
    yield* Effect.forEach(clients, (client) => client.stop().pipe(Effect.catch(() => Effect.void)), {
      concurrency: "unbounded",
      discard: true,
    });
    yield* this.#warmGenerations.dispose();
    yield* Fiber.join(channelStop);
    // After the clients: a provider that still runs would see its MCP servers fail.
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
  ): Effect.Effect<ConversationReadState, AgentLifecycleFailed> {
    return this.#reader
      .markUnread(agentId, memberId, fromMessageId)
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

  /** Keeps the Opus/WebM recording of a spoken message as a draft, for the message to replay. */
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

  listWaits(agentId: string): AgentWaitsSnapshot {
    return this.#waits.list(agentId);
  }

  /** The user cancels an open wait. */
  cancelWait(agentId: string, waitId: string): void {
    this.#waits.cancel(agentId, waitId);
  }

  listTasks(agentId: string): AgentTasksSnapshot {
    return this.#tasks.snapshot(agentId);
  }

  /** The conversation of one task, for its panel. */
  readTask(agentId: string, taskId: string): ConversationSnapshot {
    return structuredClone(this.#tasks.read(agentId, taskId));
  }

  /** Starts a task of the agent with its first message. The task runs beside the agent's own chat. */
  readonly startTask = Effect.fn("AgentService.startTask")(function* (
    this: AgentService,
    input: StartAgentTaskInput,
    sender?: ConversationMessageSender,
    timezone?: string,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed> {
    const task = yield* lifecycleStep("start task", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId))
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
      this.#requireNotHidden(input.agentId);
      // A start with files and no text takes its title from the first file.
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
    ).pipe(
      // A task without its first message is no use: it goes, and the user can send again.
      Effect.tapError(() =>
        Effect.sync(() => {
          this.#tasks.discard(task);
          this.#tasks.changed(task.agentId);
        }),
      ),
    );
    return this.#tasks.publicTask(task);
  }).bind(this);

  /** Moves a message that waits in the agent's own queue into a new task, so it starts beside the chat. */
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
    // The message leaves the agent's own chat, where it showed as queued.
    const agent = this.#store.list().find((candidate) => candidate.id === input.agentId);
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

  /**
   * Makes a branch of a conversation of the agent: a new side thread with a copy of the conversation
   * through the turn of the chosen message. No turn starts. The person who branched has read the copy.
   */
  readonly branchTask = Effect.fn("AgentService.branchTask")(function* (
    this: AgentService,
    input: BranchAgentTaskInput,
    readerId: string,
  ): Effect.fn.Return<AgentTask, AgentLifecycleFailed | AgentTaskBranchFailed> {
    yield* lifecycleStep("find agent", () => {
      if (!this.listAgents().some((agent) => agent.id === input.agentId))
        throw new Error(sourceText("error.agent.unknown", { id: input.agentId }));
      this.#requireNotHidden(input.agentId);
    });
    const task = yield* this.#tasks.branch(input);
    const through = task.branch?.throughMessageId;
    if (through)
      yield* lifecycleStep("mark branch read", () => this.#reader.markThreadRead(readerId, task.threadId, through));
    this.#tasks.changed(task.agentId);
    return this.#tasks.publicTask(task);
  }).bind(this);

  /** A teammate's answer that waits in a closing thread goes to the agent's own chat, so it is not cancelled. */
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

  /** Stops the task's running turn and cancels its queued messages, except teammates' answers. The task stays open. */
  readonly stopTask = Effect.fn("AgentService.stopTask")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ): Effect.fn.Return<void, AgentLifecycleFailed> {
    const task = yield* lifecycleStep("find task", () => this.#tasks.require(input.agentId, input.taskId));
    yield* this.#drain.endPlanContinuation(task.agentId, task.taskId);
    // A teammate's answer stays in the open thread, so it runs with the other answers to the same request.
    for (const message of this.#mailbox.queuedTaskMessages(task.agentId, task.taskId, { teammateAnswers: false }))
      yield* this.cancelQueuedMessage(task.agentId, message.deliveryId);
    const turnId = this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId;
    if (turnId) {
      this.#tasks.markStopped(task.taskId, turnId);
      yield* this.#interruptTurn(task.agentId, turnId, task.threadId);
    }
    this.#tasks.changed(task.agentId);
  }).bind(this);

  /** Stops the task and closes it. A closed task takes no message until it opens again. */
  readonly closeTask = Effect.fn("AgentService.closeTask")(function* (
    this: AgentService,
    input: AgentTaskInput,
  ): Effect.fn.Return<void, AgentLifecycleFailed> {
    // The provider ends a stopped turn a moment later, so the close waits for that end, for a time.
    const running = yield* lifecycleStep("find task", () => {
      const found = this.#tasks.require(input.agentId, input.taskId);
      return this.#conversation.loadedExecutionSnapshot(found.threadId)?.activeTurnId
        ? this.#tasks.turnEnd(found.taskId)
        : null;
    });
    // Answers move out before the Stop, so none starts in the thread, and again after the wait.
    yield* this.#returnTaskAnswers(input);
    yield* this.stopTask(input);
    if (running) yield* running.pipe(Effect.timeoutOption(TASK_STOP_WAIT_MS));
    yield* this.#returnTaskAnswers(input);
    const task = yield* lifecycleStep("find task", () => {
      const found = this.#tasks.require(input.agentId, input.taskId);
      // A turn that starts or ends after the Stop still counts toward the limits of its open task.
      if (this.#mailbox.taskBusy(found.agentId, found.taskId))
        throw new Error(sourceText("error.backend.threadStillRunning"));
      return found;
    });
    this.#tasks.close(task);
    yield* this.#memoryReview.threadClosed(task.agentId, task.threadId);
    // A task lane that waited for a free task can start now.
    this.#drain.scheduleDrain(task.agentId);
  }).bind(this);

  reopenTask(input: AgentTaskInput): void {
    this.#tasks.reopen(this.#tasks.require(input.agentId, input.taskId));
    this.#drain.scheduleDrain(input.agentId);
  }

  renameTask(input: AgentTaskInput, title: string): void {
    this.#tasks.rename(this.#tasks.require(input.agentId, input.taskId), title);
  }

  /** The member's read mark of each open side thread of the agent, at most `AGENT_THREAD_READS_LIMIT`. */
  listTaskReads(agentId: string, memberId: string, options?: ConversationMarkerExclusions): AgentTaskReadState[] {
    return this.#tasks
      .snapshot(agentId)
      .tasks.filter((task) => task.state !== "closed")
      .slice(0, AGENT_THREAD_READS_LIMIT)
      .map((task) => ({ taskId: task.id, ...this.#reader.readThread(memberId, task.threadId, options) }));
  }

  /** Moves the member's read mark of one side thread to a message of that thread. */
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

  /**
   * Deletes the task's thread with its conversation and mailbox messages. It cancels the queued messages
   * first; a running turn must be stopped first, so a delete never ends work that the person did not
   * stop. The thread is archived before the first await, so no send or drain starts new work in it while
   * the provider sessions close. A delete that fails after that leaves the thread archived, and it can
   * open again.
   */
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
    // A deleted thread is not reviewed: the person discarded it.
    yield* this.#memoryReview.forgetThread(task.agentId, task.threadId);
    yield* this.#returnTaskAnswers(task);
    for (const message of this.#mailbox.queuedTaskMessages(task.agentId, task.taskId))
      yield* this.cancelQueuedMessage(task.agentId, message.deliveryId);
    yield* lifecycleStep("check task", () => {
      if (!this.#mailbox.taskBusy(task.agentId, task.taskId)) return;
      // A turn that started before the archive runs on, so the thread stays as the person left it.
      if (wasOpen) this.#tasks.reopen(task);
      throw new Error(sourceText("error.backend.threadStillRunning"));
    });
    // The person's messages and their files go with the thread. A message between the agent and another
    // agent stays in the other agent's history: a request from the thread and a teammate's answer to it.
    yield* this.#mailbox
      .deleteTaskMessages(task.agentId, task.taskId)
      .pipe(Effect.mapError(({ cause }) => new AgentLifecycleFailed({ operation: "delete task messages", cause })));
    // The provider sessions close only now: a thread that a failed step keeps resumes its own session
    // when it opens again. A turn that started meanwhile keeps the thread, also with its session.
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
    this.#drain.scheduleDrain(task.agentId);
  }).bind(this);

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

  /**
   * Gives a channel task that a spent plan holds back to its channel, so its assignment does not
   * reserve the host until the reset. A task of a channel routine set to skip is dropped instead.
   */
  #requeueChannelDelivery(deliveryId: string, continueWork = false): Effect.Effect<boolean> {
    return this.channels.requeueForLimit(deliveryId, continueWork);
  }

  /**
   * What a spent plan does to the queues it now holds. A channel task goes back to its channel, and
   * a wake lets each channel drop the queued tasks of routines set to skip. A routine set to skip
   * leaves the agent's queue too, because its result is no use when late; cancelling the delivery
   * settles the run.
   */
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
      for (const delivery of this.listQueue(agentId).deliveries) {
        if (delivery.status !== "queued" || delivery.sender.kind !== "routine") continue;
        if (skipped.has(delivery.sender.routineId))
          yield* this.#queue.cancel(agentId, delivery.id).pipe(Effect.mapError(failed));
      }
    }
  });

  /** A saved edit is the editor's text, so `sender` becomes the sender of the message. */
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
    // A steer gives a queued message to the running turn. The queue of a hidden agent waits.
    if (this.#store.isHidden(input.agentId))
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "steerQueuedMessage",
          cause: new Error(sourceText("error.backend.recipientHidden")),
        }),
      );
    return this.#queue
      .steer(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "steerQueuedMessage", cause: failure.cause }),
        ),
      );
  }

  /**
   * `sender` is the person the host saw send it. It is not part of `SendMessageInput`: the caller of
   * that input, a renderer or a Team API body, never names who it is. `timezone` is the zone of a
   * Team API member's client, when it sent one.
   *
   * A `clientMessageId` the same sender used for this agent within a day returns the first receipt. The
   * key is a hash, so it fits the identifier bound whatever the ids are, and has no `:`-separated
   * turn id for the mailbox to read.
   */
  readonly sendMessage = Effect.fn("AgentService.sendMessage")(function* (
    this: AgentService,
    input: SendMessageInput,
    sender?: ConversationMessageSender,
    timezone?: string,
  ): Effect.fn.Return<QueuedMessageReceipt, AgentLifecycleFailed> {
    if (!input.clientMessageId) return yield* this.#sendUserMessage(input, sender, timezone);
    const idempotencyKey = `user-send:${createHash("sha256")
      .update(JSON.stringify([sender?.id ?? null, input.agentId, input.clientMessageId]))
      .digest("hex")}`;
    // Every user message adds a key, and the map is persisted whole, so keys older than the window go.
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
  ) {
    const validateRecipient = yield* lifecycleStep("prepare message delivery", () =>
      this.#mailbox.prepareDelivery([input.agentId]),
    );
    if (this.#duplication.isPending(input.agentId))
      return yield* new AgentLifecycleFailed({
        operation: "send message",
        cause: new Error(sourceText("error.agent.unknown", { id: input.agentId })),
      });
    yield* lifecycleStep("send message", () => this.#requireNotHidden(input.agentId));
    const agent = yield* this.#store
      .getOrCreate(input.agentId)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "load message agent", cause: failure.cause }),
        ),
      );
    yield* this.#providers
      .ensureProvider(providerForAgent(agent))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "ensure message provider", cause: failure.cause }),
        ),
      );
    yield* lifecycleStep("validate message recipient", () => {
      validateRecipient();
      // The provider start can wait, and the user can hide the agent in that time.
      this.#requireNotHidden(input.agentId);
    });
    // A message to a task runs in the task's own thread and lane, beside the agent's own chat.
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
        // A reply names a message of the agent's own chat, which a task does not show.
        replyToMessageId: task ? null : (input.replyToMessageId ?? null),
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
    // The task can close while the message is stored, and a closed task shows no queue to cancel it.
    if (task && this.#tasks.threadId(task.taskId) === null) {
      yield* this.cancelQueuedMessage(agent.id, delivery.delivery.id);
      return yield* new AgentLifecycleFailed({
        operation: "send message",
        cause: new Error(sourceText("error.backend.threadArchived")),
      });
    }
    if (timezone !== undefined) this.#routines.noteDeliveryTimezone(delivery.delivery.id, timezone);
    const snapshot = this.#conversation.ensureSnapshot(agent.id, task?.threadId ?? agent.threadId);
    // A task message shows in the task's row until its turn starts, not in the agent's own chat.
    if (!task) this.#mailboxSync.syncMailboxMessages(snapshot);
    if (!task)
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
          // The message is already queued: a failed preview write must not leave it without a drain,
          // and a retry with the same id returns the stored receipt without one.
          Effect.catch((failure) =>
            Effect.sync(() => this.#emitError("message_preview_failed", failure.cause, agent.id)),
          ),
        );
    yield* this.#steerWhenBusy(agent, task, snapshot, delivery.delivery.id, true);
    if (!task) {
      this.#emit({ type: "agents-changed", agents: this.listAgents() });
      this.#conversation.emitConversation(snapshot);
    }
    this.#mailboxSync.emitQueue(agent.id);
    this.#usageLimits.retry(agent.id);
    this.#drain.scheduleDrain(agent.id);
    return receipt;
  }, Effect.uninterruptible).bind(this);

  /** The turn that the user stopped last in a lane: the agent's own chat, or one task. */
  #stoppedTurn(agentId: string, taskId: string | null): string | null {
    return taskId === null ? (this.#stoppedTurns.get(agentId) ?? null) : this.#tasks.stoppedTurn(taskId);
  }

  /**
   * Takes a message that arrives while the agent works into the running turn, when the agent's
   * busy-message mode is "steer". The message is from the user or from another agent. A provider
   * that cannot steer, or a routine run, keeps the message queued; `explain` says why on its row.
   */
  readonly #steerWhenBusy = Effect.fn("AgentService.steerWhenBusy")(function* (
    this: AgentService,
    agent: AgentSummary,
    task: Pick<AgentThreadRecord, "taskId" | "threadId"> | null,
    snapshot: ConversationSnapshot,
    deliveryId: string,
    explain: boolean,
  ) {
    // A turn the user stopped is ending, and a message steered into it would end with it.
    const stoppedTurnId = this.#stoppedTurn(agent.id, task?.taskId ?? null);
    const steerTurnId =
      snapshot.activeTurnId &&
      snapshot.activeTurnId !== stoppedTurnId &&
      (agent.busyMessageMode ?? this.#busyMessageMode()) === "steer"
        ? snapshot.activeTurnId
        : null;
    if (!steerTurnId) return;
    if (agentProviderDescriptor(providerForAgent(agent)).steer !== "native") {
      if (explain) yield* this.#markSteerFallback(agent.id, deliveryId, "provider-unsupported");
    }
    // A routine run's own session ends with the run, so a chat message waits for the next turn.
    else if (!task && this.#conversation.routineSession(agent.id) !== undefined) {
      if (explain) yield* this.#markSteerFallback(agent.id, deliveryId, "steer-failed");
    }
    // Not awaited: the message is already queued, and the sender is answered without the wait for
    // the provider.
    else
      yield* this.#steerSentMessage(agent, snapshot.threadId ?? agent.threadId, deliveryId, steerTurnId, explain).pipe(
        Effect.forkIn(this.#scope),
      );
  });

  /**
   * A message from another agent follows the recipient's busy-message mode, as a message from the
   * user does. Only a message for the recipient's own chat can go into its running turn. The person
   * did not send it, so a message that cannot steer waits with no reason on its row.
   */
  #steerAgentMessage(recipientAgentId: string, deliveryId: string): Effect.Effect<void> {
    const agent = this.#store.list().find((item) => item.id === recipientAgentId);
    // A recipient with no loaded chat runs no turn, so its page is not read for this.
    const snapshot = this.#conversation.snapshotToUpdate(recipientAgentId);
    if (!agent || !snapshot || this.#store.isHidden(agent.id) || !this.#mailbox.steersChatTurn(deliveryId))
      return Effect.void;
    return this.#steerWhenBusy(agent, null, snapshot, deliveryId, false);
  }

  /**
   * Takes a message sent while the agent works into the running turn. The message is
   * queued before this runs, so a refusal leaves it there and starts when the turn ends; `explain`
   * says why on its row. Only a provider that reads a message at its next step is asked; the ACP
   * ones can hold a second prompt until the turn ends, which is a queue the user cannot see.
   */
  readonly #steerSentMessage = Effect.fn("AgentService.steerSentMessage")(function* (
    this: AgentService,
    agent: AgentSummary,
    threadId: string | null,
    deliveryId: string,
    turnId: string,
    explain: boolean,
  ) {
    yield* this.#queue.steer({ agentId: agent.id, deliveryId, expectedTurnId: turnId }).pipe(
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          logger.warn("A message sent to steer the running turn waits in the queue.", {
            agentId: agent.id,
            error: failure.cause,
          });
          // When the turn ended in between, the message starts as the next turn or waits behind it
          // like any other, which is no fallback worth naming.
          if (!explain || this.#conversation.ensureSnapshot(agent.id, threadId).activeTurnId !== turnId) return;
          yield* this.#markSteerFallback(agent.id, deliveryId, "steer-failed");
          this.#mailboxSync.emitQueue(agent.id);
        }),
      ),
    );
  });

  /** The reason is a label on the queue row, so a failed write leaves the message queued without it. */
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
    if (!snapshot.messages.some((message) => message.id === input.messageId)) {
      return yield* new AgentLifecycleFailed({
        operation: "set message reaction",
        cause: new Error(sourceText("error.agent.messageUnavailable")),
      });
    }
    yield* this.#mailbox
      .setReaction(agent.id, input.messageId, { kind: "user" }, input.emoji)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "set message reaction", cause: failure.cause }),
        ),
      );
    this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#conversation.emitConversation(snapshot);
  }, Effect.uninterruptible).bind(this);

  /** The channel, task or messaging thread of a delivery, or null for the agent's own chat. */
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
      // A Stop also ends the automatic plan continuation of its lane. A channel turn has none.
      const endContinuation =
        executionThreadId && taskId === null ? Effect.void : this.#drain.endPlanContinuation(agentId, taskId);
      return endContinuation.pipe(Effect.andThen(this.#interruptTurn(agentId, turnId, executionThreadId)));
    }).pipe(Effect.asVoid);
  }

  /**
   * `mayStop` is for `interrupt_agent`, whose checks run before the await below. In that time the
   * turn can end, and the next one, which another sender can own, starts: ACP and Claude stop
   * whatever turn runs, not `turnId`. Or the user can steer a message into the turn. So the turn
   * must still run, and `mayStop` is asked again, just before the stop is sent. `false` means no
   * stop was sent.
   */

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
    // No provider runs a turn whose end failed part way or whose provider exited, so it has nothing to
    // stop. The Stop then settles what OpenBot still holds for the turn, and the queue frees (#2214).
    // A turn that the drain started can wait for its `turn/started` with a snapshot already on it:
    // that turn is live, and only the provider can stop it. A turn whose normal end runs settles itself.
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
    // A Stop for a turn that already ended must not reach the next turn: ACP and Claude stop the
    // running turn, whatever `turnId` says. A channel thread is not in these snapshots.
    if (!executionThreadId && !snapshot) return false;
    const targetThreadId = executionThreadId ?? snapshot?.threadId;
    const session = this.#runningSession(agent, targetThreadId);
    if (!session) return false;
    this.#images.interrupt(agentId, session, turnId);
    yield* client
      .request("turn/interrupt", { threadId: session, turnId }, decodeRecordResponse)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "interrupt turn", cause: failure.cause })),
      );
    return true;
  }, Effect.uninterruptible);

  /**
   * The provider session that runs the turn of this thread: a routine run's own session while one
   * runs in the agent's chat, else the thread's active session. No thread means the agent's chat.
   */
  #runningSession(agent: AgentSummary, threadId: string | null | undefined): string | undefined {
    const publicThreadId = threadId ?? agent.threadId;
    if (!publicThreadId) return undefined;
    return (
      (publicThreadId === agent.threadId ? this.#conversation.routineSession(agent.id) : undefined) ??
      this.#store.database.activeProviderSession(publicThreadId, agent.provider)?.externalSessionId
    );
  }

  readonly interruptAll = Effect.fn("AgentService.interruptAll")(function* (this: AgentService) {
    if (!this.#providers.isReady()) return;
    const requests: Effect.Effect<unknown>[] = [];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      const turnId = snapshot.activeTurnId;
      if (!snapshot.threadId || !turnId) continue;
      const agent = this.#store.list().find((candidate) => candidate.id === agentId);
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

  /** `responder` is absent for the person at this computer; the Team API gives the member who answers. */
  respondToPrompt(input: RespondToPromptInput, responder?: PromptResponder): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToPrompt(input, responder)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "respondToPrompt", cause: failure.cause })),
      );
  }

  /** `responder` is absent for the person at this computer; the Team API gives the member who answers. */
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

  respondToBrowserSecret(input: LocalBrowserSecretResponse): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToBrowserSecret(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToBrowserSecret", cause: failure.cause }),
        ),
      );
  }

  respondToBrowserTakeover(input: RespondToBrowserTakeoverInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToBrowserTakeover(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToBrowserTakeover", cause: failure.cause }),
        ),
      );
  }

  #emitError(code: string, error: unknown, agentId?: string, context?: FailureContext): void {
    this.emit("failure", {
      ...context,
      code,
      ...(agentId !== undefined ? { agentId } : {}),
      causeCode: context?.causeCode ?? classifyFailure(error),
    });
    this.#emit({
      type: "error",
      ...(agentId !== undefined ? { agentId } : {}),
      code,
      // Redacted, because every error from a provider CLI arrives here on its way to the renderer
      // and the log, and a CLI quotes what it was given: a failure against a custom endpoint can
      // carry that endpoint's API key or a header value.
      message: this.#mcp.redact(error instanceof Error ? error.message : String(error)),
      ...(context?.provider ? { provider: context.provider } : {}),
      ...(context?.model ? { model: context.model } : {}),
    });
  }

  #emitRuntimeSnapshot(): void {
    this.#emit({ type: "runtime-snapshot", snapshot: this.getRuntimeSnapshot() });
  }

  #emit(event: AgentEvent): void {
    recordAgentRestartActivity(event);
    if (this.channels?.event(event) || this.messaging?.event(event, this.#scope) || this.#tasks?.event(event)) return;
    this.emit("event", event);
  }

  /** Removes live provider state for an execution thread before its durable rows are deleted. */

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
  }, Effect.uninterruptible);
}

export class AgentLifecycleFailed extends Schema.TaggedError<AgentLifecycleFailed>()("AgentLifecycleFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Why `#usageLimitMove` changes an agent's model, when it is not the switch for a usage limit. */
type ModelMove = "return" | "provider-error" | "next-turn";

/** The fields of an update that a queued `pendingRuntime` holds. */
const RUNTIME_UPDATE_KEYS: ReadonlySet<string> = new Set([
  "agentId",
  "provider",
  "model",
  "reasoningEffort",
  "providerAccountId",
  "leaveUsageLimit",
]);

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

function usageLimitOf(choice: AgentModelChoice): UsageLimitKey {
  return { provider: choice.provider, accountId: agentProviderAccount(choice), model: choice.model };
}

function sameUsageLimit(choice: AgentModelChoice, limit: UsageLimitKey): boolean {
  const own = usageLimitOf(choice);
  return own.provider === limit.provider && own.accountId === limit.accountId && own.model === limit.model;
}

function lifecycleStep<A>(operation: string, run: () => A): Effect.Effect<A, AgentLifecycleFailed> {
  return Effect.try({ try: run, catch: (cause) => new AgentLifecycleFailed({ operation, cause }) });
}

/** These tasks already run; stopping the service joins them without starting new work. */
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
