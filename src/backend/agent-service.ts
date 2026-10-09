import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentAnalyticsInput,
  AgentEvent,
  AgentMemory,
  AgentModelId,
  AgentModelOption,
  AgentRuntimeSnapshot,
  AgentSessionSettings,
  AgentStatus,
  AgentSummary,
  AttachmentDataInput,
  AvatarImageInput,
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
  CustomProviderRestart,
  DeleteAgentMemoryInput,
  DeleteChannelMemoryInput,
  DeleteChannelRoutineInput,
  DeleteRoutineInput,
  DeleteSharedTableInput,
  DraftAttachment,
  DuplicateAgentResult,
  GenerateAgentProfileInput,
  HostAnalyticsInput,
  ListChannelRoutineRunsInput,
  ListRoutineRunsInput,
  McpServerConfig,
  McpSignInState,
  McpTestResult,
  ProviderCodeLoginStart,
  QueuedMessageReceipt,
  QueueSnapshot,
  RemoveMcpServerInput,
  ReorderQueueInput,
  ResetAgentSessionSettingInput,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  Routine,
  RoutineRun,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
  SaveMcpServerInput,
  SendMessageInput,
  SetAgentSessionSettingInput,
  SetMcpServerEnabledInput,
  SetMessageReactionInput,
  SharedTable,
  SidebarLayoutSnapshot,
  SidebarSection,
  SignOutMcpServerInput,
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
  agentAutomationAllowed,
  type BusyMessageMode,
  CONTEXT_RESET_ITEM_TYPE,
  DEFAULT_BUSY_MESSAGE_MODE,
  isContextResetMarker,
  type QueueSteerFallback,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { classifyFailure } from "@openbot/telemetry";
import { Deferred, Effect, Exit, Fiber, Result, Schema, Scope, Semaphore } from "effect";
import { AgentMemories } from "./agent/agent-memories";
import { AgentRemoval, type AgentRemovalFailed } from "./agent/agent-removal";
import type { ApprovalAutomationPolicy } from "./agent/approval-automation";
import { AttachmentGateway } from "./agent/attachment-gateway";
import { AttentionRegistry, type LocalAttentionResponse } from "./agent/attention-registry";
import { BootRecovery } from "./agent/boot-recovery";
import { BrowserUploads } from "./agent/browser-uploads";
import type { ChatVisualPreviewHost } from "./agent/chat-visual-preview";
import { ContextCompaction } from "./agent/context-compaction";
import { ConversationReader } from "./agent/conversation-reader";
import { ConversationRuntime } from "./agent/conversation-runtime";
import { CustomEndpoints, toEndpointChangeFailed } from "./agent/custom-endpoints";
import { agentNamesById, displayMessageReferences } from "./agent/delivery-content";
import { DeltaBuffer } from "./agent/delta-buffer";
import { DrainScheduler } from "./agent/drain-scheduler";
import { DuplicationGate, toAgentDuplicationFailed } from "./agent/duplication-gate";
import type { FailureContext, FailureSignal } from "./agent/failure-signal";
import { readCapturedSteps } from "./agent/handoff-tool-steps";
import { type AgentHostedSites, HostedSiteCoordinator } from "./agent/hosted-site-coordinator";
import { ImageGenRuntime } from "./agent/image-gen-runtime";
import { MailboxSync } from "./agent/mailbox-sync";
import { type GitHubConnectorSource, McpGateway, type TestMcpServerOptions } from "./agent/mcp-gateway";
import { MemoryHold } from "./agent/memory-hold";
import {
  creationModel,
  type ModelChoice,
  modelUnavailableError,
  type ProviderPreference,
  startingChoice,
  startingModel,
} from "./agent/model-choice";
import { OpenBotToolRouter } from "./agent/openbot-tool-router";
import { ProfileClients } from "./agent/profile-clients";
import {
  GenerationUsageLimitError,
  generateProfile,
  generateTextWithoutTools,
  ProfileGenerationFailed,
} from "./agent/profile-generation";
import { ProfileSave, toProfileSaveFailed } from "./agent/profile-save";
import { isPlanLimitDiagnostic } from "./agent/provider-diagnostics";
import { type AgentClientFactory, ProviderRuntime, toProviderOperationFailed } from "./agent/provider-runtime";
import { QueueControls } from "./agent/queue-controls";
import { type RoutineMutationOptions, RoutineScheduler, toRoutineOperationFailed } from "./agent/routine-scheduler";
import { buildRuntimeSnapshot } from "./agent/runtime-snapshot";
import { SessionSettings } from "./agent/session-settings";
import type { AgentSidebar } from "./agent/sidebar-tools";
import type { LocalSkillTools } from "./agent/skill-tools";
import { isRequestTimeout, providerForAgent, providerLabel, type ToolUsageSignal } from "./agent/thread-items";
import { ThreadLifecycle, ThreadOperationFailed } from "./agent/thread-lifecycle";
import { toToolOperationFailed } from "./agent/tool-operation";
import { type AgentBrowserHost, TurnLifecycle } from "./agent/turn-lifecycle";
import { toUsageReadFailed, UsageLimitGate } from "./agent/usage-limit-gate";
import type { AgentProvider } from "./agent-client";
import type { AgentTables } from "./agent-data/agent-tables";
import type { AgentStore } from "./agent-store";
import { automationRunCommand } from "./automation-command";
import { toChannelOperationError } from "./channel-effects";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import type { BundledProviderExecutables } from "./cli";
import type { ConversationMarkerExclusions } from "./conversation-read-store";
import type { ProviderSession } from "./database/provider-sessions";
import type { HostMemory } from "./host-memory";
import type { MailboxStore } from "./mailbox-store";
import { toMcpOperationError } from "./mcp-effects";
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
import { RoutineTimer } from "./routine-timer";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import { TimeoutError, withTimeout } from "./with-timeout";
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
}

export interface AgentServiceOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  browser: AgentBrowserHost;
  requestTimeoutMs?: number;
  preferredProvider?: AgentProvider;
  /** The model chosen beside `preferredProvider`, or `null` for that provider's own default. */
  preferredModel?: AgentModelId | null;
  clientFactory?: AgentClientFactory | null;
  bundledExecutables?: BundledProviderExecutables;
  prepareAgentWorkspace?: (agent: AgentSummary) => Effect.Effect<void, AgentLifecycleFailed>;
  hostedSites?: AgentHostedSites | null;
  /** Draws pages for `html_preview`. Without it the tool tells the agent to show the page unchecked. */
  visualPreview?: ChatVisualPreviewHost | null;
  sidebarLayout?: AgentSidebar | null;
  /**
   * What a spawned CLI is given beyond its own binary: the stored keys, and the user's own model
   * endpoints. The main process owns both, because they carry secrets that must not reach the
   * renderer or the database.
   */
  credentials?: ProviderClientContext;
  offProviders?: readonly AgentProvider[];
  saveProviderUse?: (provider: AgentProvider, on: boolean) => Effect.Effect<void, AgentLifecycleFailed>;
  localSkillTools?: () => LocalSkillTools;
  /** Built after the service, so read when a tool call needs it. */
  routineFlowTools?: () => RoutineFlowTools;
  /**
   * Whose approvals are answered without asking. The main process owns the preference, because it
   * is a property of this computer and never crosses the Team API. Omitted, every approval asks.
   */
  approvalAutomation?: ApprovalAutomationPolicy;
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
  /**
   * The memory of a hosted server, or `null` on each other computer. With it, no new turn starts
   * while memory is low, and only a fixed number of turns run at the same time.
   */
  hostMemory?: HostMemory | null;
}

/** How long a user send's `clientMessageId` answers a retry. A retry follows a lost reply, not a day. */
const USER_SEND_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

export class AgentService extends EventEmitter<AgentServiceEvents> {
  readonly channels: ChannelService;
  readonly messaging: MessagingThreads;
  readonly #profileSave: ProfileSave;
  readonly #profileClients = new ProfileClients();
  #scope = Scope.makeUnsafe();
  /** User sends still before their mailbox write, by idempotency key: a retry joins the first call. */
  readonly #pendingUserSends = new Map<string, Deferred.Deferred<QueuedMessageReceipt, AgentLifecycleFailed>>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #reader: ConversationReader;
  readonly #memories: AgentMemories;
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
  readonly #localSkillTools?: () => LocalSkillTools;
  readonly #routineFlowTools: (() => RoutineFlowTools) | undefined;
  readonly #developmentDefaults: boolean;
  readonly #busyMessageMode: () => BusyMessageMode;
  /** The last turn of each agent's chat that the user stopped. One per agent, so it needs no clean-up. */
  readonly #stoppedTurns = new Map<string, string>();
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
      changed: (agent) => {
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
    this.#tables = options.tables ?? null;
    this.#memories = new AgentMemories({
      store,
      conversation: this.#conversation,
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      ...(options.agentMemoryLimit ? { limit: options.agentMemoryLimit } : {}),
    });
    // One timer for both routine owners. The sources are read lazily because `channels` and its
    // scheduler are built further down, and because an owner's earliest routine changes constantly.
    this.#routineTimer = new RoutineTimer(
      () => [this.#routines, this.#channelRoutines],
      () => this.#initialized && !this.#stopping,
      (code, error) => this.#emitError(code, error),
    );
    this.#routines = new RoutineScheduler({
      timer: this.#routineTimer,
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
        excludedAgents: () => new Set([...this.#duplication.pendingAgents(), ...this.#removal.deleting()]),
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
            yield* this.#boot.reconcileUnresolvedDeliveries();
            yield* this.channels.recover();
            this.#channelRoutines.reconcileAll();
            yield* this.#boot.backfillProviderHistory().pipe(Effect.forkIn(this.#scope));
            for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);
          }).pipe(toProviderOperationFailed),
        onProviderLost: (client) => {
          this.#boot.orphanDeliveriesOf(client.provider, (agentId) => this.#providers.runsOnOwnProcess(agentId));
          this.#compaction.dispose();
          this.#attention.clearPrompts(client);
          this.#attention.clearBrowserTakeovers(client);
          this.#attention.clearApprovals(client);
          this.#browser.clearControls();
        },
        onClientStopped: (client) =>
          Effect.gen({ self: this }, function* () {
            this.#attention.clearPrompts(client);
            this.#attention.clearBrowserTakeovers(client);
            this.#attention.clearApprovals(client);
            yield* this.#turn.interruptTurnsOf(client);
          }),
        onAgentClientLost: (agentId, client) =>
          Effect.gen({ self: this }, function* () {
            this.#attention.clearPrompts(client);
            this.#attention.clearBrowserTakeovers(client);
            this.#attention.clearApprovals(client);
            this.#boot.orphanDeliveriesOfAgent(agentId);
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
        isProviderBusy: (provider) =>
          this.#profileClients.usesProvider(provider) ||
          this.#drain.hasStartingDeliveries(provider) ||
          this.#store.list().some((agent) => providerForAgent(agent) === provider && this.#runsTurn(agent.id)),
        isAgentBusy: (agentId) => this.#runsTurn(agentId),
        isProviderAssigned: (provider) => this.#store.list().some((agent) => providerForAgent(agent) === provider),
        captureConfigRevision: () => this.#endpoints.committedRevision(),
        onProviderActivated: (provider, configRevision) =>
          Effect.gen({ self: this }, function* () {
            if (provider === "opencode") this.#endpoints.clearReleased(configRevision);
            yield* this.#endpoints.runExclusive(() => this.#endpoints.moveAgentsOffUnlistedModels(provider));
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
        history: credentials.history ?? ((provider) => providerHistoryPersistence(this.#store.database, provider)),
        servesModel: (modelId) => this.#endpoints.serves(modelId),
        // Every MCP set that leaves for a provider is remembered, so its secrets stay redactable
        // after the user edits them. This is the second of the two ways one leaves; the other is
        // `enabledMcpServers`, which the Codex thread configuration reads.
        mcpServers: () => this.#mcp.record(credentials.mcpServers()),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
        mcpAuthorization: (config) => this.#mcp.authorization(config).pipe(toMcpOperationError),
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
        // The model list reaches the renderer by pull, refreshed on a status event, and an exclusion
        // changes what that pull answers while no provider state moves.
        modelsChanged: () => this.#emit({ type: "status", status: this.getStatus() }),
        stopProfileClients: () => this.#profileClients.stopOpenCode(),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        providerAvailable: (provider) => this.#providerAvailable(provider),
        preference: () => this.#preference(),
      },
    });
    this.#compaction = new ContextCompaction({
      store,
      providers: this.#providers,
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
    });
    this.#attention = new AttentionRegistry({
      conversation: this.#conversation,
      browser: this.#browser,
      hostedSites: this.#hostedSites,
      routines: this.#routines,
      approvalAutomation: options.approvalAutomation,
      workspaceSandboxed: (agentId) => {
        const agent = store.list().find((candidate) => candidate.id === agentId);
        return agent !== undefined && workspaceAccessEnforced(agent);
      },
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
      passwordVault: options.passwordVault,
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
    this.#browser.onChanged((tabs, activeTabId) => {
      this.#attention.cancelTakeoversForMissingTabs(tabs);
      Effect.runFork(this.#browserUploads.retainTabs(tabs).pipe(Effect.forkIn(this.#scope)));
      this.#emit({ type: "browser-changed", tabs, activeTabId });
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
      mcpAuthorization: (config) => this.#mcp.authorization(config).pipe(toMcpOperationError),
      ...(credentials.agentEnvironment ? { agentEnvironment: credentials.agentEnvironment } : {}),
      // The previous provider's CLI stops a minute after no agent uses it, so it is started again. The
      // first turn on the new provider waits for the start and the read, so both share one short
      // limit. No `cwd` is sent, as in the boot backfill: a replaced ACP session is not opened again.
      readProviderSteps: (provider, threadId) =>
        withTimeout(
          Effect.gen({ self: this }, function* () {
            yield* this.#providers.ensureProvider(provider);
            const client = this.#providers.clientFor(provider);
            return client ? yield* readCapturedSteps(client, threadId) : new Map<string, string>();
          }),
          10_000,
          "The earlier provider session could not be read in time.",
        ).pipe(
          Effect.mapError(
            (failure) =>
              new ThreadOperationFailed({ cause: failure instanceof TimeoutError ? failure : failure.cause }),
          ),
        ),
      passwordVaultConnected: () => options.passwordVault?.connected() ?? false,
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
        // A deleted routine takes its runs with it, so a run without a record counts as scheduled:
        // otherwise the import would bring back the answers that its quiet turns dropped.
        quietRoutineDelivery: (deliveryId) => this.#routines.runForDelivery(deliveryId)?.kind !== "manual",
        executionThreads: () => [...this.channels.store.executionThreads(), ...this.messaging.store.executionThreads()],
        deliveryThreadId: (deliveryId) => {
          const assignment = this.channels.store.assignmentForDelivery(deliveryId);
          return assignment
            ? this.channels.store.context(assignment.channelId, assignment.agentId).threadId
            : this.messaging.threadForDelivery(deliveryId);
        },
      },
    });
    this.channels = new ChannelService(store.database, mailbox, {
      agents: () => this.listAgents(),
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
          const client = this.#providers.createProfileClient(lead.provider);
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
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toChannelOperationError),
      loadedSnapshot: (threadId) => this.#conversation.loadedExecutionSnapshot(threadId),
      normalBusy: () =>
        this.#mailbox
          .unresolvedDeliveries()
          .some((item) => !this.channels.store.assignmentForDelivery(item.delivery.id)) ||
        [...this.#conversation.activeSnapshots()].some(
          ([, snapshot]) => snapshot.activeTurnId && !this.#conversation.isExecutionThread(snapshot.threadId),
        ),
      // A held agent gets no channel assignment: one that waited for the reset would reserve the host.
      busy: (agentId) =>
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)) ||
        !this.#usageLimits.mayDrain(agentId),
      usageLimited: (agentId) => !this.#usageLimits.mayDrain(agentId),
      skipAtLimit: (task) => this.#channelRoutines.skipAtLimit(task.channelId, task.requestMessageId),
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
      busy: (agentId) =>
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)),
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId).pipe(toMessagingThreadFailed),
      forgetThread: (threadId) => this.#forgetExecutionThread(threadId).pipe(toMessagingThreadFailed),
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
        readUsage: (provider, model) => this.#providers.usage({ provider, model }).pipe(toUsageReadFailed),
        // The refused turn's drain must not wait for the queues, so the owned scope settles them.
        held: (agentIds) =>
          this.#settleHeldQueues(agentIds).pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_hold_failed", failure.cause))),
            Effect.forkIn(this.#scope, { startImmediately: true }),
            Effect.asVoid,
          ),
        // A channel task that went back to its queue is assigned again only by a pump.
        released: () =>
          this.channels.wake().pipe(
            Effect.catch((failure) => Effect.sync(() => this.#emitError("usage_limit_release_failed", failure.cause))),
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
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        redactMcp: (text) => this.#mcp.redact(text),
        isStopping: () => this.#stopping,
        servesModel: (model) => this.#endpoints.serves(model),
        requeueChannelDelivery: (deliveryId) => this.#requeueChannelDelivery(deliveryId),
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
      },
    });
    this.#turn = new TurnLifecycle({
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      providers: this.#providers,
      memories: this.#memories,
      attention: this.#attention,
      browser,
      compaction: this.#compaction,
      images: this.#images,
      deltas: this.#deltas,
      usageLimits: this.#usageLimits,
      hooks: {
        emitFailure: (failure) => this.emit("failure", failure),
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId, context) => this.#emitError(code, error, agentId, context),
        emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        dropRefusedSession: (agentId, externalThreadId) =>
          this.#threads.dropRefusedProviderSession(agentId, externalThreadId),
        listAgents: () => this.listAgents(),
        redactMcp: (text) => this.#mcp.redact(text),
        emitToolUsage: (usage) => this.emit("toolUsage", usage),
        turnModel: (agentId, turnId) => this.#drain.modelForTurn(agentId, turnId),
        requeueChannelDelivery: (deliveryId) => this.#requeueChannelDelivery(deliveryId),
        quietRoutineDelivery: (deliveryId) => this.#routines.quietRunForDelivery(deliveryId),
        takeRoutinePreview: (deliveryId) => this.#routines.takePreviewBeforeRun(deliveryId),
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
      deleteWithRevokedApproval: options.deleteWithRevokedApproval ?? ((_agentId, remove) => remove()),
      logger,
      hooks: {
        emit: (event) => this.#emit(event),
        listAgents: () => this.listAgents(),
      },
    });
    this.#tools = new OpenBotToolRouter({
      store,
      mailbox,
      mailboxSync: this.#mailboxSync,
      conversation: this.#conversation,
      attention: this.#attention,
      browser,
      browserUploads: this.#browserUploads,
      attachments: this.#attachments,
      channels: this.channels,
      hostedSites: this.#hostedSites,
      routines: this.#routines,
      memories: this.#memories,
      drain: this.#drain,
      tables: this.#tables,
      sidebarLayout: this.#sidebarLayout,
      localSkillTools: this.#localSkillTools,
      routineFlowTools: this.#routineFlowTools,
      approvalAutomation: options.approvalAutomation,
      visualPreview: options.visualPreview,
      hooks: {
        listAgents: () => this.listAgents(),
        listModels: () => this.listModels(),
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
      },
    });
  }

  getStatus(): AgentStatus {
    return this.#providers.status();
  }

  getAnalytics(input: AgentAnalyticsInput) {
    if (!this.listAgents().some((agent) => agent.id === input.agentId))
      throw new Error(sourceText("error.team.agentNotFound"));
    return this.#store.database.usage.read(input);
  }

  getHostAnalytics(input: HostAnalyticsInput) {
    if (input.agentId && !this.listAgents().some((agent) => agent.id === input.agentId))
      throw new Error(sourceText("error.team.agentNotFound"));
    return this.#store.database.usage.readHost(input);
  }

  readonly getUsage = Effect.fn("AgentService.getUsage")(function* (this: AgentService, agentId?: string) {
    const agent = yield* lifecycleStep("find usage agent", () => {
      if (!agentId) return null;
      const found = this.listAgents().find((candidate) => candidate.id === agentId);
      if (!found) throw new Error(sourceText("error.team.agentNotFound"));
      return found;
    });
    return yield* this.#providers
      .usage(agent ? { provider: agent.provider, model: agent.model } : undefined)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "get usage", cause: failure.cause })));
  }).bind(this);

  listAgents(): AgentSummary[] {
    return this.#duplication.visibleAgents(this.#store.list());
  }

  /**
   * Every id the sidebar layout may place: agents and channels alike, because the user files and
   * orders both in the same sections. An id missing from this set is pruned as gone the next time
   * the layout is reconciled, which would silently drop where the user put a channel.
   */
  sidebarChatIds(): Set<string> {
    const ids = new Set(this.listAgents().map((agent) => agent.id));
    for (const channelId of this.channels.store.ids()) ids.add(channelId);
    return ids;
  }

  getRuntimeSnapshot(): AgentRuntimeSnapshot {
    return buildRuntimeSnapshot({
      agents: this.listAgents(),
      conversation: this.#conversation,
      database: this.#store.database,
      mailbox: this.#mailbox,
      turn: this.#turn,
      attention: this.#attention,
      usageLimits: this.#usageLimits,
    });
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
        (this.#mailbox.hasUnfinishedDelivery(agent.id) || this.#conversation.workingSnapshot(agent.id)?.activeTurnId)
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

  listMemories(agentId: string): AgentMemory[] {
    return this.#memories.list(agentId);
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
    input: TestRoutineInput & { payload: string },
  ) {
    yield* lifecycleStep("validate automation run", () => {
      this.#requireAutomationAllowed(input.agentId);
      if (input.payload.length > INPUT_LIMITS.automationPayload) {
        throw new Error(sourceText("error.agent.automationPayloadTooLong", { limit: INPUT_LIMITS.automationPayload }));
      }
    });
    return yield* this.#routines
      .runWithPayload(input)
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
    if (!agent || !agentAutomationAllowed(agent)) throw new Error(sourceText("error.agent.automationOff"));
  }

  listRoutineRuns(input: ListRoutineRunsInput): RoutineRun[] {
    return this.#routines.listRuns(input);
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

  listChannelRoutineRuns(input: ListChannelRoutineRunsInput): ChannelRoutineRun[] {
    return this.#channelRoutines.listRuns(input);
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

  signInMcpServer(input: TestMcpServerInput): Effect.Effect<McpTestResult, AgentLifecycleFailed> {
    return this.#mcp
      .signIn(input)
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
   * Clients of this host read those settings again when the agent list changes.
   */
  notifyAgentsChanged(): void {
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
  }

  /** The installed skills of one agent changed, so every open skills list reads them again. */
  notifySkillsChanged(agentId: string): void {
    this.#emit({ type: "skills-changed", agentId });
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
      const client = this.#providers.createProfileClient(provider);
      return yield* this.#profileClients.run(client, (cancelled) =>
        generateProfile(client, model, input, sections, cancelled),
      );
    },
    Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "generate profile", cause: failure.cause })),
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
            return yield* this.#store.updateAgent({
              agentId: agent.id,
              provider: requested.provider,
              model: requested.model.id,
              reasoningEffort:
                input.reasoningEffort && requested.model.supportedReasoningEfforts.includes(input.reasoningEffort)
                  ? input.reasoningEffort
                  : requested.model.defaultReasoningEffort,
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

  /** `initiatingAgentId` is set when an agent, not the user, asks for the change. */
  updateAgent(input: UpdateAgentInput, initiatingAgentId?: string): Effect.Effect<AgentSummary, AgentLifecycleFailed> {
    return this.#endpoints
      .runExclusive(() => this.#applyAgentUpdate(input, initiatingAgentId))
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "updateAgent", cause: failure.cause })));
  }

  readonly #applyAgentUpdate = Effect.fn("AgentService.updateAgent")(function* (
    this: AgentService,
    input: UpdateAgentInput,
    initiatingAgentId?: string,
  ) {
    // A provider change waits until the agent has no work. It is checked again after the reads below.
    const requireIdle = (previous: AgentSummary) => {
      const hasPendingWork = this.#mailbox.hasUnfinishedDelivery(input.agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(input.agentId)?.activeTurnId ??
        (previous.threadId ? this.#store.database.readActiveTurnId(input.agentId, previous.threadId) : null);
      if (hasPendingWork || activeTurn) {
        throw new Error(sourceText("error.agent.waitBeforeProviderChange"));
      }
    };
    const { previous, requestedModel, requestedProvider } = yield* lifecycleStep("validate agent update", () => {
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
        throw modelUnavailableError(
          input.model,
          provider,
          this.#endpoints.available(),
          this.#providers.status().providers ?? [],
        );
      }
      const requestedProvider = input.provider ?? requestedModel?.provider ?? previous?.provider;
      if (input.provider && requestedModel && requestedModel.provider !== input.provider) {
        throw new Error(sourceText("error.agent.modelProviderMismatch"));
      }
      if (requestedProvider && previous && requestedProvider !== providerForAgent(previous)) {
        if (!input.model || !input.provider) {
          throw new Error("Changing provider requires an atomic provider and model selection.");
        }
        requireIdle(previous);
      }
      return { previous, requestedModel, requestedProvider };
    });
    const wasHeld = !this.#usageLimits.mayDrain(input.agentId);
    const captures: Array<readonly [ProviderSession, string]> = [];
    if (requestedProvider && previous && requestedProvider !== providerForAgent(previous)) {
      yield* this.#providers.ensureProvider(requestedProvider);
      // Before the sessions are retired below, while the previous provider still holds them. The
      // steps are saved only once the switch is stored: a switch that fails keeps the session.
      const sessions = yield* lifecycleStep("read provider sessions", () =>
        previous.threadId ? this.#store.database.listProviderSessions(previous.threadId) : [],
      );
      for (const session of sessions.filter((one) => one.state === "active")) {
        const steps = yield* this.#threads.readWorkSteps(session);
        if (steps !== null) captures.push([session, steps]);
      }
      // The reads and the provider start take time, and a message sent in it can start a turn.
      yield* lifecycleStep("validate agent update", () => requireIdle(previous));
    }
    const profileChanged =
      input.name !== undefined ||
      input.title !== undefined ||
      input.description !== undefined ||
      input.model !== undefined ||
      input.reasoningEffort !== undefined ||
      input.access !== undefined ||
      input.computerUse !== undefined ||
      input.allowAutomation !== undefined;
    if (requestedProvider && (input.provider || input.model))
      yield* lifecycleStep("check provider switch", () => this.#providers.requireProviderOn(requestedProvider));
    const agent = yield* this.#store.updateAgent(
      { ...input, ...(requestedModel && !input.provider ? { provider: requestedModel.provider } : {}) },
      initiatingAgentId,
    );
    const activeSession = this.#store.activeProviderSession(agent.id);
    if (previous?.threadId && requestedProvider && requestedProvider !== providerForAgent(previous)) {
      // Retire first, with no wait after the update: a turn that starts while a file is written
      // binds a session of the new provider, and a later retirement would close that one too.
      this.#store.database.deactivateProviderSessions(previous.threadId);
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
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    // A plan limit belongs to a provider and a model, so a model change can end a hold or start one.
    // Leaving a hold, nothing else would start the queue before the limit it left resets. Entering
    // one, the queue is settled as at any other start of a hold.
    const isHeld = !this.#usageLimits.mayDrain(agent.id);
    if (wasHeld !== isHeld) this.#emitRuntimeSnapshot();
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
    }
    return agent;
  }, Effect.uninterruptible);

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
    const threadId = yield* lifecycleStep("clear agent context", () => {
      const agent = this.#conversation.requireKnownAgent(agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(agentId)?.activeTurnId ??
        (agent.threadId ? this.#store.database.readActiveTurnId(agentId, agent.threadId) : null);
      if (activeTurn || this.#mailbox.hasUnfinishedDelivery(agentId) || this.#threads.providerContextBusy(agent)) {
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
  }, Effect.uninterruptible).bind(this);

  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    return this.#store.resolveAvatar(agentId);
  }

  resolveSharedFile(inputPath: string): Effect.Effect<ResolvedSharedFile, AgentLifecycleFailed> {
    return resolveSharedFile(this.#store.sharedRoot, inputPath).pipe(
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

  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#removal
      .delete(agentId)
      .pipe(Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "deleteAgent", cause: failure.cause })));
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

  refreshProviders(): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .refreshProviders()
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

  startProviderCodeLogin(provider: AgentProvider): Effect.Effect<ProviderCodeLoginStart, AgentLifecycleFailed> {
    return this.#providers
      .startProviderCodeLogin(provider)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "startProviderCodeLogin", cause: failure.cause }),
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
    return this.#providers
      .changeProviderCredential(provider, () => change().pipe(toProviderOperationFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: failure.cause }),
        ),
      );
  }

  updateProviderCli(
    provider: AgentProvider,
    install: () => Effect.Effect<string, AgentLifecycleFailed>,
  ): Effect.Effect<AgentStatus, AgentLifecycleFailed> {
    return this.#providers
      .updateProviderCli(provider, () => install().pipe(toProviderOperationFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "updateProviderCli", cause: failure.cause }),
        ),
      );
  }

  /** Restarts OpenCode so a saved or removed endpoint reaches it. Reports why, if it did not. */
  reloadOpenCodeConfig(): Effect.Effect<CustomProviderRestart, AgentLifecycleFailed> {
    return this.#providers.reloadOpenCodeConfig();
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
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .save(providerId, () => persist().pipe(toEndpointChangeFailed))
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "saveCustomProvider", cause: failure.cause }),
        ),
      );
  }

  /** See `CustomEndpoints.update`: the agents on removed models, the exclusion, and the file write. */
  updateCustomProvider<T>(
    providerId: string,
    removedModelIds: readonly string[],
    persist: () => Effect.Effect<T, AgentLifecycleFailed>,
  ): Effect.Effect<T, AgentLifecycleFailed> {
    return this.#endpoints
      .update(providerId, removedModelIds, () => persist().pipe(toEndpointChangeFailed))
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
  #runsTurn(agentId: string): boolean {
    return this.#conversation.workingSnapshot(agentId) != null || !this.#compaction.mayDrain(agentId);
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
      const session =
        agent && snapshot.threadId
          ? this.#store.database.activeProviderSession(snapshot.threadId, agent.provider)
          : null;
      if (session) this.#images.interrupt(agentId, session.externalSessionId, snapshot.activeTurnId);
    }
    yield* this.#turn.dispose();
    yield* this.#usageLimits.dispose();
    this.#drain.dispose();
    this.#browser.clearControls();
    yield* Effect.forEach(clients, (client) => client.stop().pipe(Effect.catch(() => Effect.void)), {
      concurrency: "unbounded",
      discard: true,
    });
    yield* Fiber.join(channelStop);
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

  searchConversationMessages(query: string, agentId?: string, cursor?: string, limit?: number): ConversationSearchPage {
    return this.#reader.search(query, agentId, cursor, limit);
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
  ): Effect.Effect<ConversationReadState, AgentLifecycleFailed> {
    return this.#reader
      .markUnread(agentId, memberId)
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
  #requeueChannelDelivery(deliveryId: string): Effect.Effect<boolean> {
    return this.channels.requeueForLimit(deliveryId);
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
    yield* lifecycleStep("validate message recipient", validateRecipient);
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "user" },
        ...(sender ? { senderMember: sender } : {}),
        recipientAgentIds: [agent.id],
        text: input.text,
        draftIds: input.attachmentDraftIds ?? [],
        replyToMessageId: input.replyToMessageId ?? null,
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
    if (timezone !== undefined) this.#routines.noteDeliveryTimezone(delivery.delivery.id, timezone);
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    this.#mailboxSync.syncMailboxMessages(snapshot);
    yield* this.#store
      .updatePreview(
        agent.id,
        displayMessageReferences(
          delivery.delivery.text,
          delivery.delivery.attachments,
          agentNamesById(this.#store.list()),
        ) || delivery.delivery.attachments.map((item) => item.name).join(", "),
      )
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "update message preview", cause: failure.cause }),
        ),
      );
    // A turn the user stopped is ending, and a message steered into it would end with it.
    const steerTurnId =
      snapshot.activeTurnId &&
      snapshot.activeTurnId !== this.#stoppedTurns.get(agent.id) &&
      (agent.busyMessageMode ?? this.#busyMessageMode()) === "steer"
        ? snapshot.activeTurnId
        : null;
    const steers = steerTurnId !== null && agentProviderDescriptor(providerForAgent(agent)).steer === "native";
    if (steerTurnId && !steers) yield* this.#markSteerFallback(agent.id, delivery.delivery.id, "provider-unsupported");
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    this.#conversation.emitConversation(snapshot);
    this.#mailboxSync.emitQueue(agent.id);
    // Not awaited: the message is already queued, and the sender is answered without the wait for
    // the provider.
    if (steerTurnId && steers)
      yield* this.#steerSentMessage(agent, delivery.delivery.id, steerTurnId).pipe(Effect.forkIn(this.#scope));
    this.#drain.scheduleDrain(agent.id);
    return receipt;
  }, Effect.uninterruptible).bind(this);

  /**
   * Takes a message the user sent while the agent works into the running turn. The message is
   * queued before this runs, so a refusal leaves it there: it says why on its row and starts when
   * the turn ends. Only a provider that reads a message at its next step is asked; the ACP ones can
   * hold a second prompt until the turn ends, which is a queue the user cannot see.
   */
  readonly #steerSentMessage = Effect.fn("AgentService.steerSentMessage")(function* (
    this: AgentService,
    agent: AgentSummary,
    deliveryId: string,
    turnId: string,
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
          if (this.#conversation.ensureSnapshot(agent.id, agent.threadId).activeTurnId !== turnId) return;
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

  interrupt(agentId: string, turnId: string, executionThreadId?: string): Effect.Effect<void, AgentLifecycleFailed> {
    return Effect.suspend(() => {
      if (!executionThreadId) this.#stoppedTurns.set(agentId, turnId);
      return this.#interruptTurn(agentId, turnId, executionThreadId);
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
    const client = yield* lifecycleStep("find interrupt provider", () =>
      this.#providers.requireReadyClientForAgent(agent),
    );
    const snapshot = [...this.#conversation.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,
    )?.[1];
    if (mayStop && (!snapshot || !mayStop())) return false;
    const targetThreadId = executionThreadId ?? snapshot?.threadId;
    const session = targetThreadId
      ? this.#store.database.activeProviderSession(targetThreadId, agent.provider)
      : this.#store.activeProviderSession(agentId);
    if (!session) return false;
    this.#images.interrupt(agentId, session.externalSessionId, turnId);
    yield* client
      .request("turn/interrupt", { threadId: session.externalSessionId, turnId }, decodeRecordResponse)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "interrupt turn", cause: failure.cause })),
      );
    return true;
  }, Effect.uninterruptible);

  readonly interruptAll = Effect.fn("AgentService.interruptAll")(function* (this: AgentService) {
    if (!this.#providers.isReady()) return;
    const requests: Effect.Effect<unknown>[] = [];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      const turnId = snapshot.activeTurnId;
      if (!snapshot.threadId || !turnId) continue;
      const agent = this.#store.list().find((candidate) => candidate.id === agentId);
      const client = agent ? this.#providers.clientForAgent(agent) : null;
      const session = agent ? this.#store.database.activeProviderSession(snapshot.threadId, agent.provider) : null;
      if (!client || !session) continue;
      this.#images.interrupt(agentId, session.externalSessionId, turnId);
      requests.push(
        client
          .request(
            "turn/interrupt",
            {
              threadId: session.externalSessionId,
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

  respondToPrompt(input: RespondToPromptInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToPrompt(input)
      .pipe(
        Effect.mapError((failure) => new AgentLifecycleFailed({ operation: "respondToPrompt", cause: failure.cause })),
      );
  }

  respondToApproval(input: RespondToApprovalInput): Effect.Effect<void, AgentLifecycleFailed> {
    return this.#attention
      .respondToApproval(input)
      .pipe(
        Effect.mapError(
          (failure) => new AgentLifecycleFailed({ operation: "respondToApproval", cause: failure.cause }),
        ),
      );
  }

  respondToBrowserSecret(input: RespondToBrowserSecretInput): Effect.Effect<void, AgentLifecycleFailed> {
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
      agentId,
      code,
      // Redacted, because every error from a provider CLI arrives here on its way to the renderer
      // and the log, and a CLI quotes what it was given: a failure against a custom endpoint can
      // carry that endpoint's API key or a header value.
      message: this.#mcp.redact(error instanceof Error ? error.message : String(error)),
    });
  }

  #emitRuntimeSnapshot(): void {
    this.#emit({ type: "runtime-snapshot", snapshot: this.getRuntimeSnapshot() });
  }

  #emit(event: AgentEvent): void {
    recordAgentRestartActivity(event);
    if (this.channels?.event(event) || this.messaging?.event(event, this.#scope)) return;
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
    for (const session of sessions)
      yield* this.#threads
        .deleteProviderSessionFiles(session.externalSessionId)
        .pipe(
          Effect.mapError(
            (failure) =>
              new AgentLifecycleFailed({ operation: "delete execution session files", cause: failure.cause }),
          ),
        );
    for (const session of sessions) {
      this.#conversation.unbindThread(session.externalSessionId);
      this.#conversation.unloadThread(session.externalSessionId);
      this.#compaction.forgetThread(session.externalSessionId);
    }
    this.#conversation.forgetExecutionThread(threadId);
  }, Effect.uninterruptible);
}

export class AgentLifecycleFailed extends Schema.TaggedError<AgentLifecycleFailed>()("AgentLifecycleFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

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
