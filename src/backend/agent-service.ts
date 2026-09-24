import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AccountUsage,
  AgentAnalyticsInput,
  AgentEvent,
  AgentMemory,
  AgentModelId,
  AgentModelOption,
  AgentProfileDraft,
  AgentRuntimeSnapshot,
  AgentStatus,
  AgentSummary,
  AttachmentDataInput,
  AvatarImageInput,
  CapabilityState,
  ChannelMemory,
  ChannelRoutine,
  ChannelRoutineRun,
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
  McpTestResult,
  ProviderCodeLoginStart,
  QueuedMessageReceipt,
  QueueSnapshot,
  RemoveMcpServerInput,
  ReorderQueueInput,
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
  SetMcpServerEnabledInput,
  SetMessageReactionInput,
  SharedTable,
  SidebarLayoutSnapshot,
  SidebarSection,
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
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { AgentMemories } from "./agent/agent-memories";
import { AgentRemoval } from "./agent/agent-removal";
import type { ApprovalAutomationPolicy } from "./agent/approval-automation";
import { AttachmentGateway } from "./agent/attachment-gateway";
import { AttentionRegistry } from "./agent/attention-registry";
import { BootRecovery } from "./agent/boot-recovery";
import { BrowserUploads } from "./agent/browser-uploads";
import { ContextCompaction } from "./agent/context-compaction";
import { ConversationReader } from "./agent/conversation-reader";
import { ConversationRuntime } from "./agent/conversation-runtime";
import { CustomEndpoints } from "./agent/custom-endpoints";
import { agentNamesById, displayMessageReferences } from "./agent/delivery-content";
import { DeltaBuffer } from "./agent/delta-buffer";
import { DrainScheduler } from "./agent/drain-scheduler";
import { DuplicationGate } from "./agent/duplication-gate";
import { type AgentHostedSites, HostedSiteCoordinator } from "./agent/hosted-site-coordinator";
import { ImageGenRuntime } from "./agent/image-gen-runtime";
import { MailboxSync } from "./agent/mailbox-sync";
import { McpGateway, type TestMcpServerOptions } from "./agent/mcp-gateway";
import { creationModel, type ProviderPreference, startingChoice, startingModel } from "./agent/model-choice";
import { OpenBotToolRouter } from "./agent/openbot-tool-router";
import { ProfileClients } from "./agent/profile-clients";
import { generateProfile, generateTextWithoutTools } from "./agent/profile-generation";
import { ProfileSave } from "./agent/profile-save";
import { type AgentClientFactory, ProviderRuntime } from "./agent/provider-runtime";
import { QueueControls } from "./agent/queue-controls";
import { type RoutineMutationOptions, RoutineScheduler } from "./agent/routine-scheduler";
import { buildRuntimeSnapshot } from "./agent/runtime-snapshot";
import type { AgentSidebar } from "./agent/sidebar-tools";
import type { LocalSkillTools } from "./agent/skill-tools";
import { isRequestTimeout, providerForAgent, providerLabel } from "./agent/thread-items";
import { ThreadLifecycle } from "./agent/thread-lifecycle";
import { type AgentBrowserHost, TurnLifecycle } from "./agent/turn-lifecycle";
import type { AgentProvider } from "./agent-client";
import type { AgentTables } from "./agent-data/agent-tables";
import type { AgentStore } from "./agent-store";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import type { BundledProviderExecutables } from "./cli";
import type { ConversationMarkerExclusions } from "./conversation-read-store";
import type { MailboxStore } from "./mailbox-store";
import { McpServerStore } from "./mcp-server-store";
import { decodeRecordResponse } from "./protocol";
import { NO_PROVIDER_CREDENTIALS, type ProviderClientContext } from "./provider-drivers";
import { recordAgentRestartActivity } from "./restart-activity";
import { RoutineTimer } from "./routine-timer";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import { type ResolvedSharedFile, resolveSharedFile, resolveWorkspaceFile } from "./workspace-paths";

const logger = createOpenBotLogger("agent-service");

/**
 * Only the application knows which managed CLIs it downloaded, so a caller that says nothing gets
 * none of them. Codex is left out on purpose: it is the one provider that can also ship inside the
 * application, and an unset entry keeps that copy in the search.
 */
const DEFAULT_BUNDLED_EXECUTABLES: BundledProviderExecutables = { claude: null, grok: null };

export type { TestMcpServerOptions } from "./agent/mcp-gateway";
// Both types were declared in this module before the split and are part of the frozen public
// surface, so they keep being reachable from here rather than only from the controller that owns
// them now. `Pick<AgentService, ...>` in team-api-server.ts does not cover exported types.
export type { AgentClientFactory } from "./agent/provider-runtime";
export type { RoutineMutationOptions } from "./agent/routine-scheduler";
export type { ResolvedSharedFile } from "./workspace-paths";

interface AgentServiceEvents {
  event: [event: AgentEvent];
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
  prepareAgentWorkspace?: (agent: AgentSummary) => Promise<void>;
  hostedSites?: AgentHostedSites | null;
  sidebarLayout?: AgentSidebar | null;
  /**
   * What a spawned CLI is given beyond its own binary: the stored keys, and the user's own model
   * endpoints. The main process owns both, because they carry secrets that must not reach the
   * renderer or the database.
   */
  credentials?: ProviderClientContext;
  localSkillTools?: () => LocalSkillTools;
  /**
   * Whose approvals are answered without asking. The main process owns the preference, because it
   * is a property of this computer and never crosses the Team API. Omitted, every approval asks.
   */
  approvalAutomation?: ApprovalAutomationPolicy;
  deleteWithRevokedApproval?: (agentId: string, remove: () => Promise<void>) => Promise<void>;
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
}

export class AgentService extends EventEmitter<AgentServiceEvents> {
  readonly channels: ChannelService;
  readonly #profileSave: ProfileSave;
  readonly #profileClients = new ProfileClients();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #reader: ConversationReader;
  readonly #memories: AgentMemories;
  readonly #tables: AgentTables | null;
  readonly #routines: RoutineScheduler;
  readonly #routineTimer: RoutineTimer;
  readonly #channelRoutines: ChannelRoutineScheduler;
  readonly #mcp: McpGateway;
  readonly #providers: ProviderRuntime;
  readonly #endpoints: CustomEndpoints;
  readonly #prepareAgentWorkspace: (agent: AgentSummary) => Promise<void>;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #images: ImageGenRuntime;
  readonly #threads: ThreadLifecycle;
  readonly #drain: DrainScheduler;
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
  readonly #developmentDefaults: boolean;
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
      prepareAgentWorkspace = async () => undefined,
      hostedSites = null,
      sidebarLayout = null,
      credentials = NO_PROVIDER_CREDENTIALS,
      localSkillTools,
      developmentDefaults = false,
      computerUseMcpServer = () => null,
    } = options;
    this.#developmentDefaults = developmentDefaults;
    this.#localSkillTools = localSkillTools;
    this.#store = store;
    // First of the sub-objects, because `#emitError` reads it to redact and every one of them is
    // given that callback.
    this.#mcp = new McpGateway({
      servers: new McpServerStore(store.database),
      credentials,
      computerUseMcpServer,
      logger,
      hooks: {
        emitError: (code, error) => this.#emitError(code, error),
        // Read late: the threads are built further down this constructor.
        refreshAllAgentRuntimes: () => this.#threads.refreshAllAgentRuntimes(),
      },
    });
    this.#sidebarLayout = sidebarLayout;
    this.#profileSave = new ProfileSave(store, {
      create: (input, configure) =>
        this.createAgent({ ...input.draft, initialMessage: input.initialMessage ?? "" }, configure, input.operationId),
      changed: (agent) => {
        this.#conversation.unloadAgentThreads(agent.id);
        this.#emit({ type: "agents-changed", agents: this.listAgents() });
        this.#drain.scheduleDrain(agent.id);
      },
      delete: async (agent) => {
        await this.#removal.deleteData(agent);
        this.#emit({ type: "agents-changed", agents: this.listAgents() });
      },
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
        interrupt: (agentId, turnId) => this.interrupt(agentId, turnId),
        awaitDrain: (agentId) => this.#drain.taskFor(agentId),
        syncMailboxMessages: (snapshot) => this.#mailboxSync.syncMailboxMessages(snapshot),
        listAgents: () => this.listAgents(),
        excludedAgents: () => new Set([...this.#duplication.pendingAgents(), ...this.#removal.deleting()]),
        isRunning: () => this.#initialized && !this.#stopping,
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
      conversation: this.#conversation,
      hooks: {
        bindClient: (client) => {
          client.on("notification", (notification) => this.#turn.handleNotification(notification, client));
          client.on("request", (request) => void this.#tools.handle(client, request));
        },
        onProvidersReady: async () => {
          await this.#boot.reconcileUnresolvedDeliveries();
          await this.channels.recover();
          // `recover` settles interrupted assignments, so a run's tasks only reach their real state
          // after it runs. Reconcile again here, not only in `initialize`.
          this.#channelRoutines.reconcileAll();
          void this.#boot.backfillProviderHistory();
          for (const agent of this.#store.list()) this.#drain.scheduleDrain(agent.id);
        },
        onProviderLost: (client) => {
          this.#compaction.dispose();
          this.#attention.clearPrompts(client);
          this.#attention.clearBrowserTakeovers();
          this.#attention.clearApprovals(client);
          this.#browser.clearControls();
        },
        onClientStopped: (client) => {
          this.#attention.clearPrompts(client);
          this.#attention.clearApprovals(client);
        },
        isStopping: () => this.#stopping,
        isProviderBusy: (provider) =>
          this.#drain.hasStartingDeliveries(provider) ||
          this.#store.list().some(
            (agent) =>
              providerForAgent(agent) === provider &&
              // A channel turn runs on a thread of its own, so the agent's own conversation holds no
              // turn id while the CLI works. `workingSnapshot` reads the execution threads as well.
              //
              // A compaction is a provider turn as well, and it holds no active turn id: its
              // `turn/started` belongs to the compaction, not to the agent, so `claimTurn` takes
              // it away. Only its own guard reports the turn the CLI is running.
              (this.#conversation.workingSnapshot(agent.id) != null || !this.#compaction.mayDrain(agent.id)),
          ),
        captureConfigRevision: () => this.#endpoints.committedRevision(),
        onProviderActivated: (provider, configRevision) => {
          if (provider === "opencode") this.#endpoints.clearReleased(configRevision);
          void this.#endpoints.runExclusive(() => this.#endpoints.moveAgentsOffUnlistedModels(provider));
        },
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
        servesModel: (modelId) => this.#endpoints.serves(modelId),
        // Every MCP set that leaves for a provider is remembered, so its secrets stay redactable
        // after the user edits them. This is the second of the two ways one leaves; the other is
        // `enabledMcpServers`, which the Codex thread configuration reads.
        mcpServers: () => this.#mcp.record(credentials.mcpServers()),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
        mcpAuthorization: (config) => this.#mcp.authorization(config),
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
        applyAgentUpdate: (input) => this.#applyAgentUpdate(input),
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
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
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
        deleteAgentData: (agent) => this.#removal.deleteData(agent),
        hasAttentionFor: (agentId) => this.#attention.hasAttentionFor(agentId),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
      },
    });
    this.#browser.onChanged((tabs, activeTabId) => {
      this.#attention.cancelTakeoversForMissingTabs(tabs);
      this.#browserUploads.retainTabs(tabs);
      this.#emit({ type: "browser-changed", tabs, activeTabId });
    });
    this.#browser.onDocumentChanged((tabId, documentIds) => this.#browserUploads.retainDocuments(tabId, documentIds));
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
      mcpAuthorization: (config) => this.#mcp.authorization(config),
      hooks: {
        logRecovery: (agentId, provider, outcome) =>
          logger.warn("Recovered an unavailable provider session.", { agentId, provider, outcome }),
        logReleaseFailure: (provider, error) =>
          logger.warn("Could not close a replaced provider session.", { provider, error }),
        reportMcpDrops: (provider, drops) => this.#mcp.reportDrops(provider, drops),
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
        executionThreads: () => this.channels.store.executionThreads(),
        deliveryThreadId: (deliveryId) => {
          const assignment = this.channels.store.assignmentForDelivery(deliveryId);
          return assignment ? this.channels.store.context(assignment.channelId, assignment.agentId).threadId : null;
        },
      },
    });
    this.channels = new ChannelService(store.database, mailbox, {
      agents: () => this.listAgents(),
      generate: async (lead, prompt) => {
        await this.#providers.ensureProvider(lead.provider);
        const model = this.#endpoints
          .available()
          .find((item) => item.provider === lead.provider && item.id === lead.model);
        if (!model) throw new Error("The channel lead model is unavailable.");
        const client = this.#providers.createProfileClient(lead.provider);
        return this.#profileClients.run(client, (cancelled) =>
          generateTextWithoutTools(
            client,
            { ...model, defaultReasoningEffort: lead.reasoningEffort },
            prompt,
            cancelled,
          ),
        );
      },
      schedule: (agentId) => this.#drain.scheduleDrain(agentId),
      awaitDrain: (agentId) => this.#drain.taskFor(agentId),
      contextCharacters: (agentId, threadId) => {
        const agent = this.#store.list().find((item) => item.id === agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        return session ? this.#compaction.contextInputCharacters(session.externalSessionId) : 120_000;
      },
      forgetThread: async (threadId) => {
        const sessions = this.#store.database.listProviderSessions(threadId);
        for (const session of sessions) await this.#threads.deleteProviderSessionFiles(session.externalSessionId);
        for (const session of sessions) {
          this.#conversation.unbindThread(session.externalSessionId);
          this.#conversation.unloadThread(session.externalSessionId);
          this.#compaction.forgetThread(session.externalSessionId);
        }
        this.#conversation.forgetExecutionThread(threadId);
      },
      normalBusy: () =>
        this.#mailbox
          .unresolvedDeliveries()
          .some((item) => !this.channels.store.assignmentForDelivery(item.delivery.id)) ||
        [...this.#conversation.activeSnapshots()].some(
          ([, snapshot]) => snapshot.activeTurnId && !this.#conversation.isExecutionThread(snapshot.threadId),
        ),
      busy: (agentId) =>
        Boolean(this.#conversation.workingSnapshot(agentId)?.activeTurnId || this.#mailbox.nextQueued(agentId)),
      steer: async (agentId, threadId, turnId, messageId, text) => {
        const agent = this.#store.list().find((item) => item.id === agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        const client = agent ? this.#providers.clientForAgent(agent) : null;
        if (!session || !client) return "rejected";
        try {
          await client.request(
            "turn/steer",
            {
              threadId: session.externalSessionId,
              expectedTurnId: turnId,
              clientUserMessageId: messageId,
              input: [{ type: "text", text }],
            },
            decodeRecordResponse,
          );
          return "accepted";
        } catch (error) {
          return isRequestTimeout(error, "turn/steer") ? "uncertain" : "rejected";
        }
      },
      interrupt: (agentId, turnId, threadId) => this.interrupt(agentId, turnId, threadId),
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
      },
    });
    this.#drain = new DrainScheduler({
      channels: this.channels,
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
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        redactMcp: (text) => this.#mcp.redact(text),
        isStopping: () => this.#stopping,
        servesModel: (model) => this.#endpoints.serves(model),
      },
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
      hooks: {
        emit: (event) => this.#emit(event),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        emitRuntimeSnapshot: () => this.#emitRuntimeSnapshot(),
        scheduleDrain: (agentId) => this.#drain.scheduleDrain(agentId),
        listAgents: () => this.listAgents(),
      },
    });
    this.#removal = new AgentRemoval({
      store,
      mailbox,
      conversation: this.#conversation,
      browser,
      channels: this.channels,
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
      hooks: {
        listAgents: () => this.listAgents(),
        createAgent: (input, configure) => this.createAgent(input, configure),
        updateAgent: (input) => this.updateAgent(input),
        setAvatar: (agentId, image) => this.setAvatar(agentId, image),
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      },
    });
  }

  getStatus(): AgentStatus {
    return this.#providers.status();
  }

  getAnalytics(input: AgentAnalyticsInput) {
    if (!this.listAgents().some((agent) => agent.id === input.agentId)) throw new Error("Agent not found.");
    return this.#store.database.usage.read(input);
  }

  getHostAnalytics(input: HostAnalyticsInput) {
    if (input.agentId && !this.listAgents().some((agent) => agent.id === input.agentId))
      throw new Error("Agent not found.");
    return this.#store.database.usage.readHost(input);
  }

  async getUsage(agentId?: string): Promise<AccountUsage> {
    if (!agentId) return this.#providers.usage();
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    return this.#providers.usage({ provider: agent.provider, model: agent.model });
  }

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
    });
  }

  /**
   * Why this instance must not restart right now, or empty when nothing holds it. Read-only:
   * every source below is also what the drain loop and the shutdown path consult, so the answer
   * agrees with what stopping would interrupt. Scheduled future routine runs do not count; they
   * resume from durable rows after a restart.
   */
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

  listTables(): Promise<SharedTable[]> {
    return this.#tables?.listShared() ?? Promise.resolve([]);
  }

  async deleteTable(input: DeleteSharedTableInput): Promise<void> {
    if (!this.#tables) throw new Error("Shared data is unavailable.");
    await this.#tables.removeAsUser(input.name);
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

  deleteRoutine(input: DeleteRoutineInput, options: RoutineMutationOptions = {}): Promise<void> {
    return this.#routines.delete(input, options);
  }

  testRoutine(input: TestRoutineInput): Promise<RoutineRun> {
    return this.#routines.test(input);
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

  testChannelRoutine(input: TestChannelRoutineInput): Promise<ChannelRoutineRun> {
    return this.#channelRoutines.test(input);
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

  saveMcpServer(input: SaveMcpServerInput): McpServerConfig[] {
    return this.#mcp.save(input);
  }

  removeMcpServer(input: RemoveMcpServerInput): McpServerConfig[] {
    return this.#mcp.remove(input);
  }

  setMcpServerEnabled(input: SetMcpServerEnabledInput): McpServerConfig[] {
    return this.#mcp.setEnabled(input);
  }

  /**
   * Marks every agent's provider session for refresh, spent before its next turn.
   *
   * The mark is what a managed tool runtime becoming ready spends: a session that dropped its
   * `npx` servers before Bun finished downloading is replaced once they can start. Mid-turn
   * sessions keep the mark until the turn ends, and the public threads and their histories stay.
   */
  refreshAllAgentRuntimes(): void {
    this.#threads.refreshAllAgentRuntimes();
  }

  testMcpServer(input: TestMcpServerInput, options: TestMcpServerOptions = {}): Promise<McpTestResult> {
    return this.#mcp.test(input, options);
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
  notifyComputerUseChanged(): void {
    this.#mcp.changed();
  }

  listModels(): AgentModelOption[] {
    return this.#endpoints.available();
  }

  async generateProfile(input: GenerateAgentProfileInput, sections: SidebarSection[]): Promise<AgentProfileDraft> {
    const agent = input.agentId ? this.listAgents().find((candidate) => candidate.id === input.agentId) : null;
    if (input.agentId && !agent) throw new Error("This agent no longer exists.");
    if (this.#stopping) throw new Error("OpenBot is shutting down.");
    if (this.#profileClients.busy()) throw new Error("Profile generation is busy. Try again shortly.");
    const provider = agent?.provider ?? this.#providers.preferredProvider();
    await this.ensureProvider(provider);
    const models = this.#endpoints.available();
    const model = agent
      ? models.find((candidate) => candidate.id === agent.model && candidate.provider === provider)
      : startingModel(provider, models, this.#preference());
    if (!model) throw new Error("The selected provider has no available model.");
    if (this.#stopping) throw new Error("OpenBot is shutting down.");
    if (this.#profileClients.busy()) throw new Error("Profile generation is busy. Try again shortly.");
    const client = this.#providers.createProfileClient(provider);
    return this.#profileClients.run(client, (cancelled) => generateProfile(client, model, input, sections, cancelled));
  }

  saveProfile(
    input: SaveAgentProfileInput,
    sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "withProfileAssignment">,
  ): Promise<SaveAgentProfileResult> {
    return this.#profileSave.save(input, sidebar);
  }

  preferredProvider(): AgentProvider {
    return this.#providers.preferredProvider();
  }

  /** The provider and model setup or Settings recorded. */
  #preference(): ProviderPreference {
    return { provider: this.#providers.preferredProvider(), model: this.#providers.preferredModel() };
  }

  async createAgent(
    input: CreateAgentInput,
    configure?: (agent: AgentSummary) => Promise<AgentSummary>,
    profileOperationId?: string,
  ): Promise<AgentSummary> {
    const initialMessage = input.initialMessage.trim();
    if (!initialMessage) throw new Error("Initial message is required.");
    if (input.initialMessage.length > INPUT_LIMITS.messageText) throw new Error("Initial message is too long.");
    let agent = await this.#store.createAgent(input, profileOperationId);
    try {
      await this.#prepareAgentWorkspace(agent);
      // A named pair lands before the initial message is queued: a provider change afterwards is
      // rejected while the delivery or turn is active, so a follow-up update could never apply it.
      const requested = creationModel(input, this.#endpoints.available());
      if (requested) {
        agent = await this.#store.updateAgent({
          agentId: agent.id,
          provider: requested.provider,
          model: requested.model.id,
          reasoningEffort:
            input.reasoningEffort && requested.model.supportedReasoningEfforts.includes(input.reasoningEffort)
              ? input.reasoningEffort
              : requested.model.defaultReasoningEffort,
        });
      } else {
        const starting = startingChoice(this.#endpoints.available(), this.#preference(), {
          enabled: this.#developmentDefaults,
          providerAvailable: (provider) => this.#providerAvailable(provider),
        });
        // The provider a start lands on, even when it lists no model: the throw below names the
        // provider the developer expected, and a preferred provider that equals the record's own is
        // still the no-op it always was.
        const startingProvider = starting?.provider ?? this.#providers.preferredProvider();
        // A new record starts on the built-in default provider, so this is the one place a preferred
        // provider lands on a new agent -- and with it the model setup chose, which is how a custom
        // endpoint becomes the default: it is a model of the CLI that runs it, never a provider.
        if (startingProvider !== agent.provider) {
          if (!starting) throw new Error(`${providerLabel(startingProvider)} has no available model.`);
          agent = await this.#store.updateAgent({
            agentId: agent.id,
            provider: starting.provider,
            model: starting.model.id,
            reasoningEffort: starting.model.defaultReasoningEffort,
          });
        }
      }
      if (configure) agent = await configure(agent);
      await this.sendMessage({ agentId: agent.id, text: initialMessage, attachmentDraftIds: [] });
      return this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent;
    } catch (error) {
      let rollbackError: unknown;
      try {
        await this.#removal.deleteData(agent);
      } catch (caught) {
        rollbackError = caught;
      }
      this.#emit({ type: "agents-changed", agents: this.listAgents() });
      if (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Agent setup failed and the incomplete agent could not be removed.",
        );
      }
      throw error;
    }
  }

  async createAgentProfile(
    input: Omit<CreateAgentInput, "initialMessage"> & { title?: string },
  ): Promise<AgentSummary> {
    let agent = await this.#store.createAgent(input);
    try {
      await this.#prepareAgentWorkspace(agent);
      if (input.title) agent = await this.#store.updateAgent({ agentId: agent.id, title: input.title });
      this.#emit({ type: "agents-changed", agents: this.listAgents() });
      return agent;
    } catch (error) {
      await this.#removal.deleteData(agent);
      throw error;
    }
  }

  committedAgentDuplication(operationId: string, sourceAgentId: string): DuplicateAgentResult | null {
    return this.#store.committedAgentDuplication(operationId, sourceAgentId);
  }

  duplicateAgent(sourceAgentId: string, operationId: string = randomUUID()): Promise<AgentSummary> {
    return this.#duplication.duplicate(sourceAgentId, operationId);
  }

  commitAgentDuplication(agentId: string, layout: SidebarLayoutSnapshot): Promise<DuplicateAgentResult> {
    return this.#duplication.commit(agentId, layout);
  }

  setMarketplaceSource(agentId: string, source: NonNullable<AgentSummary["marketplaceSource"]>): AgentSummary {
    const agent = this.#store.setMarketplaceSource(agentId, source);
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return agent;
  }

  updateAgent(input: UpdateAgentInput): Promise<AgentSummary> {
    return this.#endpoints.runExclusive(() => this.#applyAgentUpdate(input));
  }

  async #applyAgentUpdate(input: UpdateAgentInput): Promise<AgentSummary> {
    this.#conversation.requireKnownAgent(input.agentId);
    const previous = this.#store.list().find((agent) => agent.id === input.agentId);
    const requestedModel = input.model
      ? this.#endpoints
          .available()
          .find((model) => model.id === input.model && (!input.provider || model.provider === input.provider))
      : undefined;
    if (input.model && !requestedModel) throw new Error("The selected agent model is unavailable.");
    const requestedProvider = input.provider ?? requestedModel?.provider ?? previous?.provider;
    if (input.provider && requestedModel && requestedModel.provider !== input.provider) {
      throw new Error("The selected model does not belong to that provider.");
    }
    if (requestedProvider && previous && requestedProvider !== providerForAgent(previous)) {
      if (!input.model || !input.provider) {
        throw new Error("Changing provider requires an atomic provider and model selection.");
      }
      const hasPendingWork = this.#mailbox.hasUnfinishedDelivery(input.agentId);
      const activeTurn =
        this.#conversation.workingSnapshot(input.agentId)?.activeTurnId ??
        (previous.threadId
          ? this.#store.database.readConversation(input.agentId, previous.threadId).activeTurnId
          : null);
      if (hasPendingWork || activeTurn) {
        throw new Error("Wait for the active turn and queue to finish before changing provider.");
      }
      await this.ensureProvider(requestedProvider);
    }
    const profileChanged =
      input.name !== undefined ||
      input.title !== undefined ||
      input.description !== undefined ||
      input.model !== undefined ||
      input.reasoningEffort !== undefined;
    const agent = await this.#store.updateAgent({
      ...input,
      ...(requestedModel && !input.provider ? { provider: requestedModel.provider } : {}),
    });
    const activeSession = this.#store.activeProviderSession(agent.id);
    if (previous?.threadId && requestedProvider && requestedProvider !== providerForAgent(previous)) {
      this.#store.database.deactivateProviderSessions(previous.threadId);
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
    return agent;
  }

  async setAvatar(agentId: string, image: AvatarImageInput | null): Promise<AgentSummary> {
    const agent = await this.#store.setAvatar(agentId, image);
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    return agent;
  }

  refreshAgentRuntime(agentId: string): void {
    this.#threads.refreshAgentRuntime(agentId);
  }

  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    return this.#store.resolveAvatar(agentId);
  }

  resolveSharedFile(inputPath: string): Promise<ResolvedSharedFile> {
    return resolveSharedFile(this.#store.sharedRoot, inputPath);
  }

  async resolveWorkspaceFile(agentId: string, inputPath: string): Promise<ResolvedSharedFile> {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return resolveWorkspaceFile(agent, inputPath);
  }

  deleteAgent(agentId: string): Promise<void> {
    return this.#removal.delete(agentId);
  }

  deleteChannel(channelId: string): Promise<void> {
    return this.channels.deleteChannel(channelId);
  }

  async initialize(): Promise<void> {
    this.#stopping = false;
    await this.#store.initialize();
    await this.#mailbox.initialize();
    this.#mcp.migrateCatalogBridgesToHttp();
    this.channels.restoreDeliveryLinks();
    await this.#threads.reconcileProviderSessionFiles();
    this.#boot.recoverPersistedTurns();
    this.#hostedSites.restore();
    this.#routines.skipMissed(new Date());
    this.#channelRoutines.skipMissed(new Date());
    this.#initialized = true;
    await this.#providers.start();
    for (const agent of this.#store.list()) this.#mailboxSync.emitQueue(agent.id);
    await this.#routines.resumePendingRuns();
    await this.#channelRoutines.resumePendingRuns();
    this.#channelRoutines.reconcileAll();
    this.#routineTimer.arm();
  }

  setPreferredProvider(provider: AgentProvider, model: AgentModelId | null = null): Promise<void> {
    return this.#providers.setPreferredProvider(provider, this.#initialized, model);
  }

  ensureProvider(provider: AgentProvider): Promise<void> {
    return this.#providers.ensureProvider(provider);
  }

  refreshProviders(): Promise<AgentStatus> {
    return this.#providers.refreshProviders();
  }

  refreshProvider(provider: AgentProvider): Promise<AgentStatus> {
    return this.#providers.refreshProvider(provider);
  }

  connectProvider(provider: AgentProvider, openExternal: (url: string) => Promise<void>): Promise<AgentStatus> {
    return this.#providers.connectProvider(provider, openExternal);
  }

  startProviderCodeLogin(provider: AgentProvider): Promise<ProviderCodeLoginStart> {
    return this.#providers.startProviderCodeLogin(provider);
  }

  cancelProviderCodeLogin(provider: AgentProvider): Promise<AgentStatus> {
    return this.#providers.cancelProviderCodeLogin(provider);
  }

  changeProviderCredential(provider: AgentProvider, change: () => Promise<void>): Promise<AgentStatus> {
    return this.#providers.changeProviderCredential(provider, change);
  }

  updateProviderCli(provider: AgentProvider, install: () => Promise<string>): Promise<AgentStatus> {
    return this.#providers.updateProviderCli(provider, install);
  }

  /** Restarts OpenCode so a saved or removed endpoint reaches it. Reports why, if it did not. */
  reloadOpenCodeConfig(): Promise<CustomProviderRestart> {
    return this.#providers.reloadOpenCodeConfig();
  }

  /** See `CustomEndpoints.save`: the exclusion of the id being saved and the caller's file write. */
  saveCustomProvider<T>(providerId: string, persist: () => Promise<T>): Promise<T> {
    return this.#endpoints.save(providerId, persist);
  }

  /** See `CustomEndpoints.remove`: the exclusion, the agents that were on it, and the file write. */
  removeCustomProvider<T>(providerId: string, persist: () => Promise<T>): Promise<T> {
    return this.#endpoints.remove(providerId, persist);
  }

  /** Whether this provider reports a CLI that is installed, current, and signed in. */
  #providerAvailable(provider: AgentProvider): boolean {
    return (
      this.getStatus().providers?.some((candidate) => candidate.id === provider && candidate.state === "available") ??
      false
    );
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const channelStop = this.channels.stop();
    this.#initialized = false;
    this.#routineTimer.dispose();
    this.#hostedSites.dispose();
    this.#compaction.dispose();
    this.#deltas.dispose();
    this.#threads.dispose();
    this.#memories.clearPending();
    this.#tables?.dispose();
    this.#attention.clearPrompts();
    this.#attention.clearBrowserTakeovers();
    this.#attention.clearApprovals();
    const clients = [...this.#providers.dispose(), ...this.#profileClients.release()];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      if (!snapshot.activeTurnId) continue;
      const agent = this.#store.list().find((item) => item.id === agentId);
      const session =
        agent && snapshot.threadId
          ? this.#store.database.activeProviderSession(snapshot.threadId, agent.provider)
          : null;
      if (session) this.#images.interrupt(agentId, session.externalSessionId, snapshot.activeTurnId);
    }
    this.#turn.dispose();
    this.#drain.dispose();
    this.#browser.clearControls();
    await Promise.all(clients.map((client) => client.stop().catch(() => undefined)));
    await channelStop;
    await Promise.allSettled(this.#drain.pendingTasks());
    await Promise.allSettled(this.#images.pendingPromises());
    this.#images.dispose();
    await Promise.allSettled(this.#attachments.pendingCommands());
    this.#attachments.dispose();
    await this.#browserUploads.dispose();
    this.#providers.markStopped();
  }

  readConversation(agentId: string): Promise<ConversationSnapshot> {
    return this.#reader.read(agentId);
  }

  readConversationFor(agentId: string, memberId: string): Promise<ConversationWithReadState> {
    return this.#reader.readFor(agentId, memberId);
  }

  readConversationPageFor(
    agentId: string,
    memberId: string,
    anchor?: ConversationPageAnchor,
    limit?: number,
    options?: ConversationMarkerExclusions,
  ): Promise<ConversationPage> {
    return this.#reader.readPageFor(agentId, memberId, anchor, limit, options);
  }

  searchConversationMessages(query: string, agentId?: string, cursor?: string, limit?: number): ConversationSearchPage {
    return this.#reader.search(query, agentId, cursor, limit);
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
  ): Promise<ConversationReadState> {
    return this.#reader.markRead(agentId, memberId, throughMessageId, options);
  }

  markConversationUnread(agentId: string, memberId: string): Promise<ConversationReadState> {
    return this.#reader.markUnread(agentId, memberId);
  }

  prepareAttachments(paths: string[]): Promise<DraftAttachment[]> {
    return this.#mailbox.prepareAttachments(paths);
  }

  prepareImportedAttachments(paths: string[], data: AttachmentDataInput[]): Promise<DraftAttachment[]> {
    return this.#mailbox.prepareImportedAttachments(paths, data);
  }

  discardDraftAttachment(id: string): Promise<void> {
    return this.#mailbox.discardDraft(id);
  }

  listQueue(agentId: string): QueueSnapshot {
    return this.#mailboxSync.queueSnapshot(agentId);
  }

  acknowledgeFailedTurn(agentId: string, turnId: string): void {
    this.#turn.acknowledgeFailedTurn(agentId, turnId);
  }

  cancelQueuedMessage(agentId: string, deliveryId: string): Promise<void> {
    return this.#queue.cancel(agentId, deliveryId);
  }

  editQueuedMessage(agentId: string, input: QueueEditRequest): Promise<QueueSnapshot> {
    return this.#queue.edit(agentId, input);
  }

  updateQueuedMessage(input: UpdateQueuedMessageInput): Promise<void> {
    return this.#queue.update(input);
  }

  reorderQueue(input: ReorderQueueInput): Promise<void> {
    return this.#queue.reorder(input);
  }

  steerQueuedMessage(input: SteerQueuedMessageInput): Promise<void> {
    return this.#queue.steer(input);
  }

  async sendMessage(input: SendMessageInput): Promise<QueuedMessageReceipt> {
    const validateRecipient = this.#mailbox.prepareDelivery([input.agentId]);
    if (this.#duplication.isPending(input.agentId)) throw new Error(`Unknown agent: ${input.agentId}`);
    const agent = await this.#store.getOrCreate(input.agentId);
    await this.ensureProvider(providerForAgent(agent));
    validateRecipient();
    const receipt = await this.#mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [agent.id],
      text: input.text,
      draftIds: input.attachmentDraftIds ?? [],
      replyToMessageId: input.replyToMessageId ?? null,
    });
    const [queued] = receipt.deliveries;
    const delivery = queued ? this.#mailbox.getDelivery(queued.id) : null;
    if (!delivery) throw new Error("Unable to create queued message.");
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    this.#mailboxSync.syncMailboxMessages(snapshot);
    await this.#store.updatePreview(
      agent.id,
      displayMessageReferences(
        delivery.delivery.text,
        delivery.delivery.attachments,
        agentNamesById(this.#store.list()),
      ) || delivery.delivery.attachments.map((item) => item.name).join(", "),
    );
    this.#emit({ type: "agents-changed", agents: this.listAgents() });
    this.#conversation.emitConversation(snapshot);
    this.#mailboxSync.emitQueue(agent.id);
    this.#drain.scheduleDrain(agent.id);
    return receipt;
  }

  async setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    const agent = await this.#store.getOrCreate(input.agentId);
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    if (!snapshot.messages.some((message) => message.id === input.messageId)) {
      await this.readConversation(agent.id);
    }
    const current = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    if (!current.messages.some((message) => message.id === input.messageId)) {
      throw new Error("The message is no longer available.");
    }
    await this.#mailbox.setReaction(agent.id, input.messageId, { kind: "user" }, input.emoji);
    this.#mailboxSync.syncMailboxMessages(current);
    this.#conversation.emitConversation(current);
  }

  async interrupt(agentId: string, turnId: string, executionThreadId?: string): Promise<void> {
    const agent = await this.#store.getOrCreate(agentId);
    const client = this.#providers.requireReadyClient(providerForAgent(agent));
    const snapshot = [...this.#conversation.activeSnapshots()].find(
      ([id, snapshot]) => id === agentId && snapshot.activeTurnId === turnId,
    )?.[1];
    const targetThreadId = executionThreadId ?? snapshot?.threadId;
    const session = targetThreadId
      ? this.#store.database.activeProviderSession(targetThreadId, agent.provider)
      : this.#store.activeProviderSession(agentId);
    if (!session) return;
    this.#images.interrupt(agentId, session.externalSessionId, turnId);
    await client.request("turn/interrupt", { threadId: session.externalSessionId, turnId }, decodeRecordResponse);
  }

  async interruptAll(): Promise<void> {
    if (!this.#providers.isReady()) return;
    const requests: Promise<unknown>[] = [];
    for (const [agentId, snapshot] of this.#conversation.activeSnapshots()) {
      if (!snapshot.threadId || !snapshot.activeTurnId) continue;
      const agent = this.#store.list().find((candidate) => candidate.id === agentId);
      const client = agent ? this.#providers.clientForAgent(agent) : null;
      const session = agent ? this.#store.database.activeProviderSession(snapshot.threadId, agent.provider) : null;
      if (!client || !session) continue;
      this.#images.interrupt(agentId, session.externalSessionId, snapshot.activeTurnId);
      requests.push(
        client
          .request(
            "turn/interrupt",
            {
              threadId: session.externalSessionId,
              turnId: snapshot.activeTurnId,
            },
            decodeRecordResponse,
          )
          .catch((error) => this.#emitError("interrupt_failed", error, agentId)),
      );
    }
    await Promise.all(requests);
  }

  async respondToPrompt(input: RespondToPromptInput): Promise<void> {
    await this.#attention.respondToPrompt(input);
  }

  async respondToApproval(input: RespondToApprovalInput): Promise<void> {
    await this.#attention.respondToApproval(input);
  }

  async respondToBrowserSecret(input: RespondToBrowserSecretInput): Promise<void> {
    await this.#attention.respondToBrowserSecret(input);
  }

  async respondToBrowserTakeover(input: RespondToBrowserTakeoverInput): Promise<void> {
    await this.#attention.respondToBrowserTakeover(input);
  }

  #emitError(code: string, error: unknown, agentId?: string): void {
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
    if (this.channels?.event(event)) return;
    this.emit("event", event);
  }
}
