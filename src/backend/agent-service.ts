import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
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
  DraftAttachment,
  DuplicateAgentResult,
  GenerateAgentProfileInput,
  HostAnalyticsInput,
  ListChannelRoutineRunsInput,
  ListRoutineRunsInput,
  QueuedMessageReceipt,
  QueueSnapshot,
  ReorderQueueInput,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  Routine,
  RoutineRun,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
  SendMessageInput,
  SetMessageReactionInput,
  SidebarLayoutSnapshot,
  SidebarSection,
  SteerQueuedMessageInput,
  TestChannelRoutineInput,
  TestRoutineInput,
  UpdateAgentInput,
  UpdateAgentMemoryInput,
  UpdateChannelMemoryInput,
  UpdateChannelRoutineInput,
  UpdateQueuedMessageInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import { AGENT_RUNTIME_TEXT_LIMIT, defaultProviderModel, isMessageReaction } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { AgentMemories } from "./agent/agent-memories";
import { AttachmentGateway } from "./agent/attachment-gateway";
import { AttentionRegistry } from "./agent/attention-registry";
import { loadAvatarFile } from "./agent/avatar-file";
import { BootRecovery } from "./agent/boot-recovery";
import { BrowserUploads } from "./agent/browser-uploads";
import { ContextCompaction } from "./agent/context-compaction";
import { ConversationRuntime } from "./agent/conversation-runtime";
import {
  agentNamesById,
  deliveryInput,
  displayMessageReferences,
  responseAttachmentMessageId,
} from "./agent/delivery-content";
import { DeltaBuffer } from "./agent/delta-buffer";
import { DrainScheduler } from "./agent/drain-scheduler";
import { DuplicationGate } from "./agent/duplication-gate";
import { type AgentHostedSites, HostedSiteCoordinator } from "./agent/hosted-site-coordinator";
import { isHostedSiteMutationTool } from "./agent/hosted-site-events";
import { ImageGenRuntime } from "./agent/image-gen-runtime";
import { MailboxSync } from "./agent/mailbox-sync";
import { generateProfile, generateTextWithoutTools } from "./agent/profile-generation";
import { ProfileSave } from "./agent/profile-save";
import { createAgentToolSchema, updateProfileToolSchema } from "./agent/profile-tools";
import { type AgentClientFactory, ProviderRuntime } from "./agent/provider-runtime";
import { type RoutineMutationOptions, RoutineScheduler } from "./agent/routine-scheduler";
import { type OpenBotToolResponse, openBotToolResult } from "./agent/routine-tools";
import { fitRuntimeSnapshot } from "./agent/runtime-snapshot";
import { type AgentSidebar, handleSidebarTool } from "./agent/sidebar-tools";
import { isDynamicToolCall, isRequestTimeout, providerForAgent, providerLabel } from "./agent/thread-items";
import { ThreadLifecycle } from "./agent/thread-lifecycle";
import { type AgentBrowserHost, TurnLifecycle } from "./agent/turn-lifecycle";
import type { AgentClient, AgentProvider } from "./agent-client";
import { type AgentStore, DEFAULT_AGENT_PROVIDER } from "./agent-store";
import { OPENBOT_BROWSER_NAMESPACE } from "./browser-tools";
import { ChannelRoutineScheduler } from "./channel-routine-scheduler";
import { ChannelService } from "./channel-service";
import type { BundledProviderExecutables } from "./cli";
import { type ConversationMarkerExclusions, ConversationReadStore } from "./conversation-read-store";
import { mergeConversationSnapshots } from "./conversation-snapshots";
import type { MailboxStore } from "./mailbox-store";
import { type AppServerRequest, type DynamicToolCallParams, decodeRecordResponse, isRecord } from "./protocol";
import { NO_PROVIDER_CREDENTIALS, type ProviderClientContext } from "./provider-drivers";
import { RoutineTimer } from "./routine-timer";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import { isWithin, rebaseLegacyWorkspacePath, sharedPathFromInput, workspacePathFromInput } from "./workspace-paths";

const logger = createOpenBotLogger("agent-service");

/**
 * Only the application knows which managed CLIs it downloaded, so a caller that says nothing gets
 * none of them. Codex is left out on purpose: it is the one provider that can also ship inside the
 * application, and an unset entry keeps that copy in the search.
 */
const DEFAULT_BUNDLED_EXECUTABLES: BundledProviderExecutables = { claude: null, grok: null };

// Both types were declared in this module before the split and are part of the frozen public
// surface, so they keep being reachable from here rather than only from the controller that owns
// them now. `Pick<AgentService, ...>` in team-api-server.ts does not cover exported types.
export type { AgentClientFactory } from "./agent/provider-runtime";
export type { RoutineMutationOptions } from "./agent/routine-scheduler";

interface AgentServiceEvents {
  event: [event: AgentEvent];
}

export interface ResolvedSharedFile {
  path: string;
  name: string;
  size: number;
}

export class AgentService extends EventEmitter<AgentServiceEvents> {
  readonly channels: ChannelService;
  readonly #profileSave: ProfileSave;
  readonly #profileClients = new Set<AgentClient>();
  readonly #deletingAgents = new Set<string>();
  /**
   * Endpoints the running CLI may still list although the saved file no longer defines them, because
   * a restart it refused or failed leaves its catalogue as it was. The value is `#endpointRevision`
   * as it stood when the exclusion was taken, so a process that spawned before that number read the
   * old files and its catalogue says nothing about this endpoint.
   */
  readonly #releasedCustomProviders = new Map<string, number>();
  /**
   * Counts the endpoint changes, which puts an exclusion and a spawn in order. A CLI reads the files
   * once, at spawn, so a removal made while a process starts is not in the process that arrives.
   */
  #endpointRevision = 0;
  /**
   * One endpoint change or one agent update at a time. A removal excludes the endpoint, moves the
   * agents off it and then writes the file; an agent update that ran between those steps could put
   * an agent back onto the endpoint after the sweep and before the write, and the removal would not
   * notice. Both paths run here, so neither can start inside the other.
   */
  #endpointChain: Promise<unknown> = Promise.resolve();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #conversationReads: ConversationReadStore;
  readonly #memories: AgentMemories;
  readonly #routines: RoutineScheduler;
  readonly #routineTimer: RoutineTimer;
  readonly #channelRoutines: ChannelRoutineScheduler;
  readonly #providers: ProviderRuntime;
  readonly #prepareAgentWorkspace: (agent: AgentSummary) => Promise<void>;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #conversation: ConversationRuntime;
  readonly #attention: AttentionRegistry;
  readonly #images: ImageGenRuntime;
  readonly #threads: ThreadLifecycle;
  readonly #drain: DrainScheduler;
  readonly #attachments: AttachmentGateway;
  readonly #browserUploads: BrowserUploads;
  readonly #mailboxSync: MailboxSync;
  readonly #boot: BootRecovery;
  readonly #deltas: DeltaBuffer;
  readonly #turn: TurnLifecycle;
  readonly #compaction: ContextCompaction;
  readonly #duplication: DuplicationGate;
  readonly #sidebarLayout: AgentSidebar | null;
  #initialized = false;
  #stopping = false;

  constructor(
    store: AgentStore,
    mailbox: MailboxStore,
    browser: AgentBrowserHost,
    requestTimeoutMs = 30_000,
    preferredProvider: AgentProvider = "codex",
    clientFactory: AgentClientFactory | null = null,
    bundledExecutables: BundledProviderExecutables = DEFAULT_BUNDLED_EXECUTABLES,
    prepareAgentWorkspace: (agent: AgentSummary) => Promise<void> = async () => undefined,
    hostedSites: AgentHostedSites | null = null,
    sidebarLayout: AgentSidebar | null = null,
    /**
     * The model setup chose beside `preferredProvider`, or `null` for that provider's own default.
     * It arrives last because it was added last, and every caller that has no answer says `null`.
     */
    preferredModel: AgentModelId | null = null,
    /**
     * What a spawned CLI is given beyond its own binary: the stored keys, and the user's own model
     * endpoints. The main process owns both, because they carry secrets that must not reach the
     * renderer or the database.
     */
    credentials: ProviderClientContext = NO_PROVIDER_CREDENTIALS,
  ) {
    super();
    this.#store = store;
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
        await this.#deleteAgentData(agent);
        this.#emit({ type: "agents-changed", agents: this.listAgents() });
      },
    });
    this.#mailbox = mailbox;
    this.#browser = browser;
    this.#conversationReads = new ConversationReadStore(store.database);
    this.#prepareAgentWorkspace = prepareAgentWorkspace;
    this.#conversation = new ConversationRuntime(
      store,
      (event) => this.#emit(event),
      () => this.listAgents(),
    );
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
        excludedAgents: () => new Set([...this.#duplication.pendingAgents(), ...this.#deletingAgents]),
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
          client.on("request", (request) => void this.#handleServerRequest(client, request));
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
          this.#attention.clearApprovals();
          this.#browser.clearControls();
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
        captureConfigRevision: () => this.#endpointRevision,
        onProviderActivated: (provider, configRevision) => {
          if (provider === "opencode") this.#clearReleasedCustomProviders(configRevision);
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
      credentials,
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
        deleteAgentData: (agent) => this.#deleteAgentData(agent),
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
      },
    });
    this.#boot = new BootRecovery({
      store,
      mailbox,
      providers: this.#providers,
      conversation: this.#conversation,
      mailboxSync: this.#mailboxSync,
      hooks: {
        emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
        executionThreads: () => this.channels.store.executionThreads(),
        deliveryThreadId: (deliveryId) => {
          const assignment = this.channels.store.assignmentForDelivery(deliveryId);
          return assignment ? this.channels.store.context(assignment.channelId, assignment.agentId).threadId : null;
        },
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
      hooks: {
        logRecovery: (agentId, provider, outcome) =>
          logger.warn("Recovered an unavailable provider session.", { agentId, provider, outcome }),
      },
    });
    this.channels = new ChannelService(store.database, mailbox, {
      agents: () => this.listAgents(),
      generate: async (lead, prompt) => {
        await this.#providers.ensureProvider(lead.provider);
        const model = this.#availableModels().find((item) => item.provider === lead.provider && item.id === lead.model);
        if (!model) throw new Error("The channel lead model is unavailable.");
        const client = this.#providers.createProfileClient(lead.provider);
        this.#profileClients.add(client);
        try {
          return await generateTextWithoutTools(
            client,
            { ...model, defaultReasoningEffort: lead.reasoningEffort },
            prompt,
          );
        } finally {
          this.#profileClients.delete(client);
        }
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
        isStopping: () => this.#stopping,
        servesModel: (model) => this.#servesModel(model),
      },
    });
    this.#browser.onControlChanged((state) => {
      this.#emit({ type: "browser-control-changed", state });
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
    const agents = this.listAgents();
    const runtimeAgents: AgentRuntimeSnapshot["agents"] = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      notifications: agent.notifications,
      preview: agent.preview.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
      updatedAt: agent.updatedAt,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      avatarUrl: agent.avatarUrl,
    }));
    const activeTurns: AgentRuntimeSnapshot["activeTurns"] = [];
    const latestMessages: AgentRuntimeSnapshot["latestMessages"] = [];
    for (const agent of agents) {
      const live = this.#conversation.snapshot(agent.id);
      const liveLatest = [...(live?.messages ?? [])]
        .reverse()
        .find(
          (message) =>
            (message.author === "assistant" || message.author === "agent") &&
            message.itemType !== "commentary" &&
            message.itemType !== "question_prompt" &&
            message.itemType !== "agent_attachment",
        );
      const persisted =
        !live || !liveLatest
          ? this.#store.database.readConversationRuntime(agent.id, agent.threadId)
          : { activeTurnId: null, latestMessage: null };
      const activeTurnId = live ? live.activeTurnId : persisted.activeTurnId;
      if (activeTurnId && agent.threadId) {
        activeTurns.push({ agentId: agent.id, threadId: agent.threadId, turnId: activeTurnId });
      }
      const latest = liveLatest ?? persisted.latestMessage;
      if (latest) {
        latestMessages.push({
          agentId: agent.id,
          id: latest.id,
          text: latest.text.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
          createdAt: latest.createdAt,
        });
      }
    }
    return fitRuntimeSnapshot({
      agents: runtimeAgents,
      activeTurns,
      work: this.#mailbox.listRuntimeWork(
        agents.map((agent) => agent.id),
        this.#turn.failedTurns(),
      ),
      latestMessages,
      ...this.#attention.runtimeAttention(),
      failedTurns: [...this.#turn.failedTurns()].map(([agentId, turnId]) => ({ agentId, turnId })),
    });
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

  listModels(): AgentModelOption[] {
    return this.#availableModels();
  }

  /**
   * The catalogue every caller may choose from: what the connected providers report, less the models
   * of an endpoint whose removal is written.
   *
   * The two lists differ only while OpenCode keeps running with an old configuration, which is what
   * a removal during a turn leaves behind. The CLI still lists the endpoint, so the raw catalogue
   * would let the renderer show it, `updateAgent` accept it, and a new agent start on it, all after
   * the file that defines it is gone. `alsoExcluded` names an endpoint whose removal is in progress
   * and therefore not recorded yet.
   */
  #availableModels(): AgentModelOption[] {
    if (this.#releasedCustomProviders.size === 0) return this.#providers.listModels();
    return this.#providers.listModels().filter((option) => this.#servesModel(option.id));
  }

  /**
   * Whether the model id is one a save still defines. A model of no custom endpoint, and a model of
   * an endpoint nothing removed, are served; a model an endpoint no longer lists is not.
   */
  #servesModel(modelId: string): boolean {
    const separator = modelId.indexOf("/");
    if (separator <= 0) return true;
    return !this.#releasedCustomProviders.has(modelId.slice(0, separator));
  }

  async generateProfile(input: GenerateAgentProfileInput, sections: SidebarSection[]): Promise<AgentProfileDraft> {
    const agent = input.agentId ? this.listAgents().find((candidate) => candidate.id === input.agentId) : null;
    if (input.agentId && !agent) throw new Error("This agent no longer exists.");
    if (this.#stopping) throw new Error("OpenBot is shutting down.");
    if (this.#profileClients.size >= 3) throw new Error("Profile generation is busy. Try again shortly.");
    const provider = agent?.provider ?? this.#providers.preferredProvider();
    await this.ensureProvider(provider);
    const models = this.#availableModels();
    const model = agent
      ? models.find((candidate) => candidate.id === agent.model && candidate.provider === provider)
      : this.#startingModel(provider, models);
    if (!model) throw new Error("The selected provider has no available model.");
    if (this.#stopping) throw new Error("OpenBot is shutting down.");
    if (this.#profileClients.size >= 3) throw new Error("Profile generation is busy. Try again shortly.");
    const client = this.#providers.createProfileClient(provider);
    this.#profileClients.add(client);
    try {
      return await generateProfile(client, model, input, sections);
    } finally {
      this.#profileClients.delete(client);
    }
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

  /**
   * The model a new agent, or a profile draft with no agent, starts on for `provider`.
   *
   * Setup records a model beside the preferred provider, so that model comes first -- but only while
   * the CLI still lists it, because the list is the provider's answer and a saved id can name an
   * endpoint or a model that is gone. After it come the provider's own default and then whatever it
   * does list; `null` means it listed nothing at all.
   */
  #startingModel(provider: AgentProvider, models: AgentModelOption[]): AgentModelOption | null {
    const listed = (id: AgentModelId) => models.find((model) => model.provider === provider && model.id === id);
    const preferred = this.#providers.preferredModel();
    const chosen = preferred !== null && provider === this.#providers.preferredProvider() ? listed(preferred) : null;
    return (
      chosen ?? listed(defaultProviderModel(provider)) ?? models.find((model) => model.provider === provider) ?? null
    );
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
      const preferredProvider = this.#providers.preferredProvider();
      // A new record starts on the built-in default provider, so this is the one place a preferred
      // provider lands on a new agent -- and with it the model setup chose, which is how a custom
      // endpoint becomes the default: it is a model of the CLI that runs it, never a provider.
      if (preferredProvider !== agent.provider) {
        const preferredModel = this.#startingModel(preferredProvider, this.#availableModels());
        if (!preferredModel) throw new Error(`${providerLabel(preferredProvider)} has no available model.`);
        agent = await this.#store.updateAgent({
          agentId: agent.id,
          provider: preferredProvider,
          model: preferredModel.id,
          reasoningEffort: preferredModel.defaultReasoningEffort,
        });
      }
      if (configure) agent = await configure(agent);
      await this.sendMessage({ agentId: agent.id, text: initialMessage, attachmentDraftIds: [] });
      return this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent;
    } catch (error) {
      let rollbackError: unknown;
      try {
        await this.#deleteAgentData(agent);
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
      await this.#deleteAgentData(agent);
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
    return this.#runEndpointExclusive(() => this.#applyAgentUpdate(input));
  }

  /** A failed change does not stop the next one, so the chain swallows what it re-throws here. */
  #runEndpointExclusive<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.#endpointChain.then(run);
    this.#endpointChain = operation.catch(() => undefined);
    return operation;
  }

  async #applyAgentUpdate(input: UpdateAgentInput): Promise<AgentSummary> {
    this.#conversation.requireKnownAgent(input.agentId);
    const previous = this.#store.list().find((agent) => agent.id === input.agentId);
    const requestedModel = input.model
      ? this.#availableModels().find(
          (model) => model.id === input.model && (!input.provider || model.provider === input.provider),
        )
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
    // Re-resume before the next turn so App Server receives the updated standing instructions. The
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

  async resolveSharedFile(inputPath: string): Promise<ResolvedSharedFile> {
    const sharedRoot = await realpath(this.#store.sharedRoot);
    const candidatePath = sharedPathFromInput(this.#store.sharedRoot, inputPath);
    const resolvedPath = await realpath(candidatePath);
    if (!isWithin(sharedRoot, resolvedPath)) {
      throw new Error("Shared file must be inside the shared directory.");
    }
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile()) throw new Error("Shared path is not a file.");
    return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
  }

  async resolveWorkspaceFile(agentId: string, inputPath: string): Promise<ResolvedSharedFile> {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const workspaceRoot = await realpath(agent.workspacePath);
    const candidatePath = workspacePathFromInput(agent.workspacePath, agent.id, inputPath);
    const resolvedPath = await realpath(candidatePath).catch(async (error: unknown) => {
      // The file may be one the provider's own transcript still names under this agent's pre-rename
      // workspace root. The containment check below is unchanged and runs on whatever comes back.
      const rebased =
        isRecord(error) && error.code === "ENOENT"
          ? rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, candidatePath)
          : null;
      if (rebased === null) throw error;
      return await realpath(rebased);
    });
    if (!isWithin(workspaceRoot, resolvedPath)) {
      throw new Error("Workspace file must be inside the agent workspace.");
    }
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile()) throw new Error("Workspace path is not a file.");
    return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
  }

  async deleteAgent(agentId: string): Promise<void> {
    if (this.#deletingAgents.has(agentId)) throw new Error("Agent deletion is already in progress.");
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const hasPendingWork = this.#mailbox.hasUnfinishedDelivery(agentId);
    if (hasPendingWork || this.#conversation.workingSnapshot(agentId)?.activeTurnId) {
      throw new Error("Stop the agent and cancel its queued messages before deleting it.");
    }

    const { wasPending, release } = this.#duplication.releaseForDelete(agentId);
    this.#deletingAgents.add(agentId);
    const releaseDeliveries = this.#mailbox.blockAgentDeliveries(agentId);
    try {
      this.#routines.arm();
      await this.#deleteAgentData(agent ?? { id: agentId, threadId: null });
      this.#duplication.forget(agentId);
      if (!wasPending) this.#emit({ type: "agents-changed", agents: this.listAgents() });
    } finally {
      release();
      releaseDeliveries();
      this.#deletingAgents.delete(agentId);
      this.#routines.arm();
      if (this.#store.list().some((candidate) => candidate.id === agentId)) this.#drain.scheduleDrain(agentId);
    }
  }

  deleteChannel(channelId: string): Promise<void> {
    return this.channels.deleteChannel(channelId);
  }

  async #deleteAgentData(agent: Pick<AgentSummary, "id" | "threadId">): Promise<void> {
    const providerSessions = agent.threadId ? this.#store.database.listProviderSessions(agent.threadId) : [];
    let stage = "provider-files";
    try {
      // Keep session records available if private file removal needs a retry.
      for (const session of providerSessions) await this.#threads.deleteProviderSessionFiles(session.externalSessionId);
      stage = "mailbox";
      await this.#mailbox.deleteAgentData(agent.id, this.channels.store.allContextThreads());
      stage = "agent-files-and-record";
      await this.#store.deleteAgent(agent.id);
    } catch {
      // File-system errors can contain private paths. Log only the failed stage.
      logger.warn("Agent deletion failed.", { stage });
      throw new Error("The agent data could not be removed completely. Retry deleting the agent.");
    }
    this.#conversation.forgetAgent(agent.id);
    this.#turn.forgetAgent(agent.id);
    this.#drain.forgetAgent(agent.id);
    this.#hostedSites.forgetAgent(agent.id);
    if (agent.threadId) {
      for (const session of providerSessions) {
        this.#conversation.unbindThread(session.externalSessionId);
        this.#conversation.unloadThread(session.externalSessionId);
        this.#compaction.forgetThread(session.externalSessionId);
      }
    }
    this.#compaction.forgetAgent(agent.id);
  }

  async initialize(): Promise<void> {
    this.#stopping = false;
    await this.#store.initialize();
    await this.#mailbox.initialize();
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

  /**
   * Removes one endpoint: the exclusion, the agents that were on it, and `persist`, which is the
   * caller's file write, as one change nothing else can interleave with.
   *
   * The exclusion is taken *first*, so no agent can be moved onto the endpoint while its removal
   * runs, and given back when the write throws: an endpoint that is still on disk is still saved and
   * still served, and its models stay a valid fallback for the next removal.
   */
  removeCustomProvider<T>(providerId: string, persist: () => Promise<T>): Promise<T> {
    return this.#runEndpointExclusive(async () => {
      const previous = this.#releasedCustomProviders.get(providerId);
      this.#endpointRevision += 1;
      this.#releasedCustomProviders.set(providerId, this.#endpointRevision);
      this.#emitModelsChanged();
      try {
        await this.#releaseCustomProviderModels();
        return await persist();
      } catch (error) {
        if (previous !== undefined) this.#releasedCustomProviders.set(providerId, previous);
        else this.#releasedCustomProviders.delete(providerId);
        this.#emitModelsChanged();
        throw error;
      }
    });
  }

  /**
   * A fresh OpenCode process is the one the app uses now, and it read the endpoint files as they are,
   * so what it lists is the truth and nothing has to be masked any more.
   *
   * Only a client that reached `onProviderActivated` gets here. A restart that fails leaves the old
   * process answering, on the endpoints it started with, and every id removed since then stays out:
   * an id saved a second time may name another server, and the old process would take the message to
   * the one the user has just replaced.
   */
  #clearReleasedCustomProviders(configRevision: number): void {
    let changed = false;
    for (const [providerId, revision] of this.#releasedCustomProviders) {
      // A removal made while this process started is not in the files it read, so its catalogue is
      // the one from before the removal and the endpoint stays out.
      if (revision > configRevision) continue;
      this.#releasedCustomProviders.delete(providerId);
      changed = true;
    }
    if (changed) this.#emitModelsChanged();
  }

  /**
   * Tells the renderer to read the catalogue again. The model list reaches it by pull, refreshed on a
   * status event, and an exclusion changes what that pull answers while no provider state moves.
   */
  #emitModelsChanged(): void {
    this.#emit({ type: "status", status: this.getStatus() });
  }

  /**
   * Moves every agent off a removed endpoint's models, onto a model that is still served.
   *
   * Runs *before* the file write and the restart, so no agent is left naming a model the fresh
   * catalogue does not list, and inside `removeCustomProvider`, which has already excluded the
   * endpoint and holds the chain that keeps an agent update out.
   *
   * Throws while an affected agent is busy, which stops the removal: the move is a provider switch,
   * and that is refused during a turn or a queued delivery. The check runs over all of them first,
   * so a refusal moves no agent at all.
   */
  async #releaseCustomProviderModels(): Promise<void> {
    // Every endpoint already removed, not only this one. A removal during a turn leaves the running
    // CLI's catalogue as it was, so the models of an endpoint already taken out are still listed,
    // and choosing one here would move agents onto an endpoint that is gone.
    const affected = this.#store
      .list()
      .filter((agent) => providerForAgent(agent) === "opencode" && !this.#servesModel(agent.model));
    if (affected.length === 0) return;
    // OpenCode declares no default model of its own -- its catalogue is whatever the CLI lists -- so
    // the fallback is chosen from the live list with the endpoint being removed taken out of it.
    // The built-in default provider comes second, because an agent left on a model the CLI no longer
    // serves cannot answer, and a provider switch keeps its workspace, thread and identity.
    const remaining = this.#availableModels();
    // The built-in default is offered only while it is usable: `#applyAgentUpdate` connects the
    // provider it moves an agent to, and a Codex that is not installed or not signed in throws
    // there. That would trap a user who runs custom endpoints only, because the last endpoint could
    // never be removed while an agent still names one of its models.
    const fallback =
      this.#startingModel("opencode", remaining) ??
      (this.#providerAvailable(DEFAULT_AGENT_PROVIDER) ? this.#startingModel(DEFAULT_AGENT_PROVIDER, remaining) : null);
    // Nothing is listed, so there is no model to move to. The removal still goes ahead: refusing it
    // would trap the user on an endpoint that may be the reason no model is listed.
    if (!fallback) return;
    if (fallback.provider !== "opencode" && affected.some((agent) => this.#hasWorkInFlight(agent))) {
      throw new Error("Wait for the active turn and queue to finish before you remove this endpoint.");
    }
    for (const agent of affected) {
      // Not the public `updateAgent`: this already runs inside the chain that one takes.
      await this.#applyAgentUpdate({
        agentId: agent.id,
        provider: fallback.provider,
        model: fallback.id,
        reasoningEffort: fallback.defaultReasoningEffort,
      });
    }
  }

  /** Whether this provider reports a CLI that is installed, current, and signed in. */
  #providerAvailable(provider: AgentProvider): boolean {
    return (
      this.getStatus().providers?.some((candidate) => candidate.id === provider && candidate.state === "available") ??
      false
    );
  }

  /**
   * Whether a turn is running for this agent or a delivery is still queued for it. Read from the
   * live snapshot first, then from the stored conversation, because an agent whose thread is not
   * loaded keeps its active turn in the database.
   */
  #hasWorkInFlight(agent: AgentSummary): boolean {
    if (this.#mailbox.hasUnfinishedDelivery(agent.id)) return true;
    const active =
      this.#conversation.workingSnapshot(agent.id)?.activeTurnId ??
      (agent.threadId ? this.#store.database.readConversation(agent.id, agent.threadId).activeTurnId : null);
    return Boolean(active);
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
    this.#attention.clearPrompts();
    this.#attention.clearBrowserTakeovers();
    this.#attention.clearApprovals();
    const clients = [...this.#providers.dispose(), ...this.#profileClients];
    this.#profileClients.clear();
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

  async readConversation(agentId: string): Promise<ConversationSnapshot> {
    const agent = await this.#store.getOrCreate(agentId);
    const persisted = this.#store.database.readConversation(agentId, agent.threadId);
    const live = this.#conversation.snapshot(agentId);
    const snapshot = live?.activeTurnId ? mergeConversationSnapshots(persisted, live) : persisted;
    this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#conversation.setSnapshot(agentId, snapshot);
    return structuredClone(snapshot);
  }

  async readConversationFor(agentId: string, memberId: string): Promise<ConversationWithReadState> {
    const snapshot = await this.readConversation(agentId);
    return {
      ...snapshot,
      readState: this.#conversationReads.readState(memberId, snapshot),
    };
  }

  async readConversationPageFor(
    agentId: string,
    memberId: string,
    anchor: ConversationPageAnchor = { type: "latest" },
    limit = 50,
    options: ConversationMarkerExclusions = {},
  ): Promise<ConversationPage> {
    const agent = await this.#store.getOrCreate(agentId);
    this.#mailboxSync.reconcilePersistedMailboxMessages(agent);
    const page = this.#store.database.readConversationPage(agentId, agent.threadId, anchor, limit, options);
    return {
      ...page,
      readState: this.#conversationReads.readStateForThread(memberId, agent.threadId, options),
    };
  }

  searchConversationMessages(query: string, agentId?: string, cursor?: string, limit = 100): ConversationSearchPage {
    return this.#store.database.searchConversationMessages(query, agentId, cursor, limit);
  }

  listConversationReads(
    memberId: string,
    options: ConversationMarkerExclusions = {},
  ): Record<string, ConversationReadState> {
    return this.#conversationReads.listStates(memberId, this.listAgents(), options);
  }

  adoptConversationReads(sourceMemberId: string, targetMemberId: string): void {
    this.#conversationReads.adoptMemberState(sourceMemberId, targetMemberId);
  }

  async markConversationRead(
    agentId: string,
    memberId: string,
    throughMessageId: string | null,
    options: ConversationMarkerExclusions = {},
  ): Promise<ConversationReadState> {
    const snapshot = await this.readConversation(agentId);
    const previous = this.#conversationReads.readState(memberId, snapshot).throughMessageId;
    const state = this.#conversationReads.markRead(memberId, snapshot, throughMessageId, options);
    if (this.#conversationReads.readState(memberId, snapshot).throughMessageId !== previous) {
      // Read cursors are shared by a member's devices, not by every team member.
      // Invalidate without broadcasting a reader's cursor; each client reloads its own state.
      this.#emit({ type: "conversation-invalidated", agentId, revision: snapshot.revision });
    }
    return state;
  }

  async markConversationUnread(agentId: string, memberId: string): Promise<ConversationReadState> {
    const snapshot = await this.readConversation(agentId);
    const state = this.#conversationReads.markUnread(memberId, snapshot);
    this.#emit({ type: "conversation-invalidated", agentId, revision: snapshot.revision });
    return state;
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
    return this.#mailbox.listQueue(agentId);
  }

  acknowledgeFailedTurn(agentId: string, turnId: string): void {
    this.#turn.acknowledgeFailedTurn(agentId, turnId);
  }

  async cancelQueuedMessage(agentId: string, deliveryId: string): Promise<void> {
    if (this.channels.store.assignmentForDelivery(deliveryId))
      throw new Error("Use the channel task controls for this assignment.");
    await this.#mailbox.cancel(agentId, deliveryId);
    this.#mailboxSync.emitQueue(agentId);
  }

  async updateQueuedMessage(input: UpdateQueuedMessageInput): Promise<void> {
    if (this.channels.store.assignmentForDelivery(input.deliveryId))
      throw new Error("Use the channel task controls for this assignment.");
    await this.#mailbox.updateQueuedMessage(
      input.agentId,
      input.deliveryId,
      input.text,
      input.keepAttachmentIds,
      input.attachmentDraftIds,
    );
    const snapshot = this.#conversation.snapshot(input.agentId);
    if (snapshot) this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#mailboxSync.emitQueue(input.agentId);
    if (snapshot) this.#conversation.emitConversation(snapshot, "queue.message-updated");
  }

  async reorderQueue(input: ReorderQueueInput): Promise<void> {
    if (input.deliveryIds.some((id) => this.channels.store.assignmentForDelivery(id)))
      throw new Error("Use the channel task controls for channel work.");
    // The queue the user reads holds no channel work, so the order it sends names the normal
    // messages alone, and the mailbox reads the whole queued order. Channel work stays at the head:
    // it reserved the agent before these messages arrived.
    const channelDeliveryIds = this.#mailbox.queuedChannelDeliveryIds(input.agentId);
    await this.#mailbox.reorderQueue(input.agentId, [...channelDeliveryIds, ...input.deliveryIds]);
    this.#mailboxSync.emitQueue(input.agentId);
  }

  async steerQueuedMessage(input: SteerQueuedMessageInput): Promise<void> {
    const agent = await this.#store.getOrCreate(input.agentId);
    const client = this.#providers.requireReadyClient(providerForAgent(agent));
    const session = this.#store.activeProviderSession(agent.id);
    const snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    if (!session || !snapshot.activeTurnId || snapshot.activeTurnId !== input.expectedTurnId) {
      throw new Error("The active turn changed before this message could be steered.");
    }
    if (this.channels.store.assignmentForDelivery(input.deliveryId))
      throw new Error("Use the channel task controls for this assignment.");
    const context = this.#mailbox.getDelivery(input.deliveryId);
    if (!context || context.delivery.recipientAgentId !== agent.id || context.delivery.status !== "queued") {
      throw new Error("Only queued messages can be steered.");
    }

    const turnId = snapshot.activeTurnId;
    await this.#mailbox.markSteering(input.deliveryId, turnId);
    this.#mailboxSync.emitQueue(agent.id);
    try {
      await client.request(
        "turn/steer",
        {
          threadId: session.externalSessionId,
          expectedTurnId: turnId,
          clientUserMessageId: input.deliveryId,
          input: deliveryInput(context, agentNamesById(this.#store.list())),
        },
        decodeRecordResponse,
      );
      await this.#mailbox.markRunning(input.deliveryId, turnId);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#mailboxSync.emitQueue(agent.id);
      this.#conversation.emitConversation(snapshot, "queue.message-steered", { deliveryId: input.deliveryId });
    } catch (error) {
      await this.#mailbox.restoreQueued(input.deliveryId);
      this.#mailboxSync.emitQueue(agent.id);
      throw error;
    }
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
    const delivery = this.#mailbox.getDelivery(receipt.deliveries[0].id);
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

  async respondToBrowserTakeover(input: RespondToBrowserTakeoverInput): Promise<void> {
    await this.#attention.respondToBrowserTakeover(input);
  }

  async #handleServerRequest(client: AgentClient, request: AppServerRequest): Promise<void> {
    try {
      switch (request.method) {
        case "item/commandExecution/requestApproval":
          this.#attention.surfaceApproval(client, request, "command");
          return;
        case "item/fileChange/requestApproval":
          this.#attention.surfaceApproval(client, request, "file-change");
          return;
        case "item/permissions/requestApproval":
          this.#attention.surfaceApproval(client, request, "permissions");
          return;
        case "applyPatchApproval":
        case "execCommandApproval":
          this.#attention.surfaceLegacyApproval(client, request);
          return;
        case "item/tool/call": {
          if (!isDynamicToolCall(request.params)) throw new Error("Invalid dynamic tool request.");
          if (request.params.namespace === OPENBOT_BROWSER_NAMESPACE) {
            const agentId = this.#conversation.agentForThread(request.params.threadId);
            if (!agentId) throw new Error("The browsing OpenBot agent is unknown.");
            if (request.params.tool === "request_takeover") {
              client.respond(request.id, await this.#attention.surfaceBrowserTakeover(request));
              return;
            }
            if (this.#attention.hasBrowserTakeoverForAgent(agentId)) {
              client.respond(request.id, {
                success: false,
                contentItems: [{ type: "inputText", text: "Browser tools are unavailable during user takeover." }],
              });
              return;
            }
            const params = {
              ...request.params,
              threadId: this.#conversation.publicThreadId(agentId, request.params.threadId),
              ownerAgentId: agentId,
            };
            client.respond(
              request.id,
              request.params.tool === "upload_files"
                ? await this.#browserUploads.uploadFiles(agentId, params)
                : await this.#browser.handleDynamicTool(params),
            );
            return;
          }
          if (request.params.namespace === "openbot") {
            if (request.params.tool === "ask_user") {
              this.#attention.surfaceDynamicPrompt(client, request);
              return;
            }
            if (isHostedSiteMutationTool(request.params.tool)) {
              await this.#attention.surfaceHostedSiteApproval(client, request, request.params, request.params.tool);
              return;
            }
            client.respond(request.id, await this.#handleOpenBotTool(request.params));
            return;
          }
          throw new Error(`Unsupported dynamic tool namespace: ${request.params.namespace}`);
        }
        case "item/tool/requestUserInput":
          this.#attention.surfacePrompt(client, request);
          return;
        case "mcpServer/elicitation/request":
          this.#attention.surfaceMcpElicitation(client, request);
          return;
        case "currentTime/read":
          client.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1_000) });
          return;
        default:
          client.respondError(request.id, {
            code: -32601,
            message: `OpenBot does not implement server request ${request.method}.`,
          });
      }
    } catch (error) {
      if (client.running) {
        try {
          client.respondError(request.id, { code: -32603, message: String(error) });
        } catch {
          // The process can exit between the running check and the write.
        }
      }
      this.#emitError("server_request_failed", error);
    }
  }

  async #handleOpenBotTool(params: DynamicToolCallParams): Promise<OpenBotToolResponse> {
    const senderAgentId = this.#conversation.agentForThread(params.threadId);
    if (!senderAgentId) throw new Error("The sending OpenBot agent is unknown.");

    const executionThreadId = this.#conversation.publicThreadId(senderAgentId, params.threadId);
    const channelId = this.channels.store.channelForThread(executionThreadId);
    if (channelId && (params.tool.startsWith("channel_") || params.tool === "send_message")) {
      if (params.tool === "send_message") throw new Error("Use channel_assign or channel_transfer for channel work.");
      return openBotToolResult(
        await this.channels.tool(channelId, senderAgentId, params.turnId, params.callId, params.tool, params.arguments),
      );
    }
    if (params.tool.startsWith("channel_")) throw new Error("Channel tools require an active channel assignment.");

    if (params.tool === "list_sites") {
      return openBotToolResult({ sites: await this.#hostedSites.listSites(), limit: 10 });
    }

    if (isHostedSiteMutationTool(params.tool)) throw new Error("Hosted site changes require user approval.");

    if (params.tool === "attach_files_to_response") {
      const args = params.arguments;
      if (!isRecord(args) || !Array.isArray(args.paths)) throw new Error("paths must be an array of local files.");
      if (
        args.paths.length === 0 ||
        args.paths.length > INPUT_LIMITS.attachments ||
        !args.paths.every((path) => isString(path) && path.trim().length > 0 && path.length <= INPUT_LIMITS.path)
      ) {
        throw new Error(`paths must contain between 1 and ${INPUT_LIMITS.attachments} valid local file paths.`);
      }

      const messageId = responseAttachmentMessageId(params.threadId, params.turnId, params.callId);
      return this.#attachments.attachFiles(senderAgentId, params, args.paths, messageId);
    }

    if (params.tool === "list_agents") {
      const agents = this.listAgents().map((agent) => {
        const queue = this.#mailbox.listQueue(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          status: this.#conversation.workingSnapshot(agent.id)?.activeTurnId
            ? "working"
            : queue.deliveries.some((delivery) => delivery.status === "queued")
              ? "queued"
              : "ready",
        };
      });
      return {
        success: true,
        contentItems: [{ type: "inputText", text: JSON.stringify({ agents }) }],
      };
    }

    if (params.tool === "create_agent") {
      const args = createAgentToolSchema.parse(params.arguments);
      const hue = args.avatarHue ?? null;
      const sectionId = this.#sidebarLayout?.getSnapshot().agentAssignments[senderAgentId] ?? null;
      const create = (assign?: (agentId: string) => Promise<SidebarLayoutSnapshot>) =>
        this.createAgent(
          {
            name: args.name,
            description: args.description,
            initialMessage: args.initialMessage,
            avatarSeed: args.avatarSeed ?? randomUUID(),
            avatarHue: hue,
          },
          async (agent) => {
            if (assign) await assign(agent.id);
            return args.title === undefined ? agent : this.#store.updateAgent({ agentId: agent.id, title: args.title });
          },
        );
      const created =
        this.#sidebarLayout && sectionId !== null
          ? await this.#sidebarLayout.withProfileAssignment(sectionId, create)
          : await create();
      return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(created) }] };
    }

    if (params.tool === "update_profile") {
      const args = updateProfileToolSchema.parse(params.arguments);
      const { agentId, avatarHue, avatarPath, ...fields } = args;
      if (avatarPath !== undefined && (args.avatarSeed !== undefined || avatarHue !== undefined)) {
        throw new Error("Use avatarPath or generated avatar settings, not both.");
      }
      if (
        Object.values(fields).every((value) => value === undefined) &&
        avatarHue === undefined &&
        avatarPath === undefined
      ) {
        throw new Error("At least one profile field is required.");
      }
      const sender = this.listAgents().find((agent) => agent.id === senderAgentId);
      if (!sender) throw new Error("The calling agent no longer exists.");
      const image = avatarPath === undefined ? undefined : await loadAvatarFile(avatarPath, sender.workspacePath);
      const input: UpdateAgentInput = { agentId, ...fields, ...(avatarHue === undefined ? {} : { avatarHue }) };
      let updated = await this.updateAgent(input);
      if (image !== undefined) {
        updated = await this.setAvatar(agentId, image);
      } else if (args.avatarSeed !== undefined || args.avatarHue !== undefined) {
        updated = await this.setAvatar(agentId, null);
      }
      return {
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({
              id: updated.id,
              name: updated.name,
              title: updated.title,
              description: updated.description,
              avatarSeed: updated.avatarSeed,
              avatarHue: updated.avatarHue,
              avatarUrl: updated.avatarUrl,
            }),
          },
        ],
      };
    }

    const sidebarResult = await handleSidebarTool(
      params.tool,
      params.arguments,
      this.#sidebarLayout,
      new Set(this.listAgents().map((agent) => agent.id)),
    );
    if (sidebarResult) return sidebarResult;

    const routineResult = await this.#routines.handleTool(params, senderAgentId);
    if (routineResult) return routineResult;

    const memoryResult = this.#memories.handleTool(params, senderAgentId);
    if (memoryResult) return memoryResult;

    if (params.tool === "react_to_user_message") {
      const args = params.arguments;
      if (!isRecord(args) || !isMessageReaction(args.emoji)) {
        throw new Error("emoji must be exactly one complete Unicode emoji.");
      }
      const delivery = this.#mailbox
        .findDeliveriesByTurn(senderAgentId, params.turnId)
        .find((candidate) => candidate.delivery.sender.kind === "user");
      if (!delivery) throw new Error("Only the current user message can receive an agent reaction.");
      await this.#mailbox.setReaction(
        senderAgentId,
        delivery.delivery.id,
        { kind: "agent", agentId: senderAgentId },
        args.emoji,
      );
      const snapshot = this.#conversation.ensureSnapshot(senderAgentId, params.threadId);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#conversation.emitConversation(snapshot);
      return openBotToolResult({ status: "reacted", messageId: delivery.delivery.id, emoji: args.emoji });
    }

    if (params.tool !== "send_message" || !isRecord(params.arguments)) {
      throw new Error(`Unsupported OpenBot tool: ${params.tool}`);
    }
    const recipientValues = params.arguments.recipientAgentIds;
    if (!Array.isArray(recipientValues) || !recipientValues.every((item) => isString(item))) {
      throw new Error("recipientAgentIds must be an array of agent ids.");
    }
    if (recipientValues.length !== new Set(recipientValues).size) {
      throw new Error("Duplicate recipients are not allowed.");
    }
    if (recipientValues.includes(senderAgentId)) throw new Error("An agent cannot message itself.");
    const knownIds = new Set(this.listAgents().map((agent) => agent.id));
    for (const recipient of recipientValues) {
      if (!knownIds.has(recipient)) throw new Error(`Unknown OpenBot agent: ${recipient}`);
    }
    const paths = params.arguments.paths ?? [];
    if (!Array.isArray(paths) || !paths.every((item) => isString(item))) {
      throw new Error("paths must be an array of local file paths.");
    }
    const replyToMessageId = params.arguments.replyToMessageId;
    if (replyToMessageId !== undefined && replyToMessageId !== null && !isString(replyToMessageId)) {
      throw new Error("replyToMessageId must be a message id.");
    }
    if (!isString(params.arguments.text)) throw new Error("text is required.");

    const receipt = await this.#mailbox.enqueue({
      sender: { kind: "agent", agentId: senderAgentId },
      recipientAgentIds: recipientValues,
      text: params.arguments.text,
      sourcePaths: paths,
      replyToMessageId: replyToMessageId ?? null,
      idempotencyKey: `${params.threadId}:${params.turnId}:${params.callId}`,
    });
    for (const recipient of recipientValues) {
      this.#mailboxSync.emitQueue(recipient);
      this.#drain.scheduleDrain(recipient);
    }
    const snapshot = this.#conversation.ensureSnapshot(senderAgentId, params.threadId);
    this.#mailboxSync.syncMailboxMessages(snapshot);
    this.#conversation.emitConversation(snapshot);
    return {
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(receipt) }],
    };
  }

  #emitError(code: string, error: unknown, agentId?: string): void {
    this.#emit({
      type: "error",
      agentId,
      code,
      // Redacted, because every error from a provider CLI arrives here on its way to the renderer
      // and the log, and a CLI quotes what it was given: a failure against a custom endpoint can
      // carry that endpoint's API key or a header value.
      message: redactText(error instanceof Error ? error.message : String(error)),
    });
  }

  #emitRuntimeSnapshot(): void {
    this.#emit({ type: "runtime-snapshot", snapshot: this.getRuntimeSnapshot() });
  }

  #emit(event: AgentEvent): void {
    if (this.channels?.event(event)) return;
    this.emit("event", event);
  }
}
