import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AccountUsage,
  AgentEvent,
  AgentMemory,
  AgentModelOption,
  AgentProfileDraft,
  AgentRuntimeSnapshot,
  AgentStatus,
  AgentSummary,
  AttachmentDataInput,
  AvatarImageInput,
  ConversationPage,
  ConversationPageAnchor,
  ConversationReadState,
  ConversationSearchPage,
  ConversationSnapshot,
  ConversationWithReadState,
  CreateAgentInput,
  CreateAgentMemoryInput,
  CreateRoutineInput,
  DeleteAgentMemoryInput,
  DeleteRoutineInput,
  DraftAttachment,
  DuplicateAgentResult,
  GenerateAgentProfileInput,
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
  TestRoutineInput,
  UpdateAgentInput,
  UpdateAgentMemoryInput,
  UpdateQueuedMessageInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import { AGENT_RUNTIME_TEXT_LIMIT, isMessageReaction } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { AgentMemories } from "./agent/agent-memories";
import { AttachmentGateway } from "./agent/attachment-gateway";
import { AttentionRegistry } from "./agent/attention-registry";
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
import type { AgentStore } from "./agent-store";
import { OPENBOT_BROWSER_NAMESPACE } from "./browser-tools";
import { type ConversationMarkerExclusions, ConversationReadStore } from "./conversation-read-store";
import { mergeConversationSnapshots } from "./conversation-snapshots";
import { GroupService } from "./group-service";
import type { MailboxStore } from "./mailbox-store";
import { type AppServerRequest, type DynamicToolCallParams, decodeRecordResponse, isRecord } from "./protocol";
import type { SidebarLayoutStore } from "./sidebar-layout-store";
import { isWithin, rebaseLegacyWorkspacePath, sharedPathFromInput, workspacePathFromInput } from "./workspace-paths";

const logger = createOpenBotLogger("agent-service");

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
  readonly groups: GroupService;
  readonly #profileSave: ProfileSave;
  readonly #profileClients = new Set<AgentClient>();
  readonly #deletingAgents = new Set<string>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #browser: AgentBrowserHost;
  readonly #conversationReads: ConversationReadStore;
  readonly #memories: AgentMemories;
  readonly #routines: RoutineScheduler;
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
    bundledCodexExecutable: string | null | undefined = undefined,
    bundledClaudeExecutable: string | null | undefined = null,
    bundledGrokExecutable: string | null | undefined = null,
    prepareAgentWorkspace: (agent: AgentSummary) => Promise<void> = async () => undefined,
    hostedSites: AgentHostedSites | null = null,
    sidebarLayout: AgentSidebar | null = null,
  ) {
    super();
    this.#store = store;
    this.#sidebarLayout = sidebarLayout;
    this.#profileSave = new ProfileSave(store, {
      create: (input, configure) =>
        this.createAgent({ ...input.draft, initialMessage: input.initialMessage ?? "" }, configure, input.operationId),
      changed: (agent) => {
        const session = this.#store.activeProviderSession(agent.id);
        if (session) this.#conversation.unloadThread(session.externalSessionId);
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
    this.#routines = new RoutineScheduler({
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
          await this.groups.recover();
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
      },
      emit: (event) => this.#emit(event),
      emitError: (code, error, agentId) => this.#emitError(code, error, agentId),
      requestTimeoutMs,
      preferredProvider,
      clientFactory,
      bundledCodexExecutable,
      bundledClaudeExecutable,
      bundledGrokExecutable,
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
        executionThreads: () => this.groups.store.executionThreads(),
        deliveryThreadId: (deliveryId) => {
          const assignment = this.groups.store.assignmentForDelivery(deliveryId);
          return assignment ? this.groups.store.context(assignment.groupId, assignment.agentId).threadId : null;
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
    this.groups = new GroupService(store.database, mailbox, {
      agents: () => this.listAgents(),
      generate: async (lead, prompt) => {
        await this.#providers.ensureProvider(lead.provider);
        const model = this.#providers
          .listModels()
          .find((item) => item.provider === lead.provider && item.id === lead.model);
        if (!model) throw new Error("The group lead model is unavailable.");
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
      contextCharacters: (agentId, threadId) => {
        const agent = this.#store.list().find((item) => item.id === agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        return session ? this.#compaction.contextInputCharacters(session.externalSessionId) : 120_000;
      },
      normalBusy: () =>
        this.#mailbox
          .unresolvedDeliveries()
          .some((item) => !this.groups.store.assignmentForDelivery(item.delivery.id)) ||
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
      changed: (groupId, revision) => this.#emit({ type: "groups-changed", groupId, revision }),
      error: (error) => this.#emitError("group_coordination_failed", error),
    });
    this.#drain = new DrainScheduler({
      groups: this.groups,
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

  async getUsage(agentId?: string): Promise<AccountUsage> {
    if (!agentId) return this.#providers.usage();
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    return this.#providers.usage({ provider: agent.provider, model: agent.model });
  }

  listAgents(): AgentSummary[] {
    return this.#duplication.visibleAgents(this.#store.list());
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

  listModels(): AgentModelOption[] {
    return this.#providers.listModels();
  }

  async generateProfile(input: GenerateAgentProfileInput, sections: SidebarSection[]): Promise<AgentProfileDraft> {
    const agent = input.agentId ? this.listAgents().find((candidate) => candidate.id === input.agentId) : null;
    if (input.agentId && !agent) throw new Error("This agent no longer exists.");
    if (this.#stopping) throw new Error("OpenBot is shutting down.");
    if (this.#profileClients.size >= 3) throw new Error("Profile generation is busy. Try again shortly.");
    const provider = agent?.provider ?? this.#providers.preferredProvider();
    await this.ensureProvider(provider);
    const models = this.#providers.listModels();
    const defaultModel = provider === "codex" ? "gpt-5.6-luna" : provider === "claude" ? "claude-opus-5" : null;
    const model = agent
      ? models.find((candidate) => candidate.id === agent.model && candidate.provider === provider)
      : (models.find((candidate) => candidate.provider === provider && candidate.id === defaultModel) ??
        models.find((candidate) => candidate.provider === provider));
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
      if (preferredProvider !== agent.provider) {
        const models = this.#providers.listModels();
        const preferredDefault =
          preferredProvider === "codex" ? "gpt-5.6-luna" : preferredProvider === "claude" ? "claude-opus-5" : null;
        const preferredModel =
          models.find((model) => model.provider === preferredProvider && model.id === preferredDefault) ??
          models.find((model) => model.provider === preferredProvider);
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

  async updateAgent(input: UpdateAgentInput): Promise<AgentSummary> {
    this.#conversation.requireKnownAgent(input.agentId);
    const previous = this.#store.list().find((agent) => agent.id === input.agentId);
    const requestedModel = input.model
      ? this.#providers
          .listModels()
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
      const hasPendingWork = this.#mailbox
        .unresolvedDeliveries()
        .some((item) => item.delivery.recipientAgentId === input.agentId);
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
    if (profileChanged && activeSession) {
      // Re-resume before the next turn so App Server receives the updated standing instructions.
      this.#conversation.unloadThread(activeSession.externalSessionId);
    }
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
    const hasPendingWork = this.#mailbox
      .unresolvedDeliveries()
      .some((item) => item.delivery.recipientAgentId === agentId);
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

  async #deleteAgentData(agent: Pick<AgentSummary, "id" | "threadId">): Promise<void> {
    const providerSessions = agent.threadId ? this.#store.database.listProviderSessions(agent.threadId) : [];
    let stage = "provider-files";
    try {
      // Keep session records available if private file removal needs a retry.
      for (const session of providerSessions) await this.#threads.deleteProviderSessionFiles(session.externalSessionId);
      stage = "mailbox";
      await this.#mailbox.deleteAgentData(agent.id);
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
    this.groups.restoreDeliveryLinks();
    await this.#threads.reconcileProviderSessionFiles();
    this.#boot.recoverPersistedTurns();
    this.#hostedSites.restore();
    this.#routines.skipMissed(new Date());
    this.#initialized = true;
    await this.#providers.start();
    for (const agent of this.#store.list()) this.#mailboxSync.emitQueue(agent.id);
    await this.#routines.resumePendingRuns();
    this.#routines.arm();
  }

  setPreferredProvider(provider: AgentProvider): Promise<void> {
    return this.#providers.setPreferredProvider(provider, this.#initialized);
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

  async stop(): Promise<void> {
    this.#stopping = true;
    const groupStop = this.groups.stop();
    this.#initialized = false;
    this.#routines.dispose();
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
    await groupStop;
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
    if (this.groups.store.assignmentForDelivery(deliveryId))
      throw new Error("Use the group task controls for this assignment.");
    await this.#mailbox.cancel(agentId, deliveryId);
    this.#mailboxSync.emitQueue(agentId);
  }

  async updateQueuedMessage(input: UpdateQueuedMessageInput): Promise<void> {
    if (this.groups.store.assignmentForDelivery(input.deliveryId))
      throw new Error("Use the group task controls for this assignment.");
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
    if (input.deliveryIds.some((id) => this.groups.store.assignmentForDelivery(id)))
      throw new Error("Use the group task controls for group work.");
    await this.#mailbox.reorderQueue(input.agentId, input.deliveryIds);
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
    if (this.groups.store.assignmentForDelivery(input.deliveryId))
      throw new Error("Use the group task controls for this assignment.");
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
    const groupId = this.groups.store.groupForThread(executionThreadId);
    if (groupId && (params.tool.startsWith("group_") || params.tool === "send_message")) {
      if (params.tool === "send_message") throw new Error("Use group_assign or group_transfer for group work.");
      return openBotToolResult(
        await this.groups.tool(groupId, senderAgentId, params.turnId, params.callId, params.tool, params.arguments),
      );
    }
    if (params.tool.startsWith("group_")) throw new Error("Group tools require an active group assignment.");

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
      const created = await this.createAgent(
        {
          name: args.name,
          description: args.description,
          initialMessage: args.initialMessage,
          avatarSeed: args.avatarSeed ?? randomUUID(),
          avatarHue: hue,
        },
        args.title === undefined
          ? undefined
          : (agent) => this.#store.updateAgent({ agentId: agent.id, title: args.title }),
      );
      return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(created) }] };
    }

    if (params.tool === "update_profile") {
      const args = updateProfileToolSchema.parse(params.arguments);
      const { agentId, avatarHue, ...fields } = args;
      if (Object.values(fields).every((value) => value === undefined) && avatarHue === undefined) {
        throw new Error("At least one profile field is required.");
      }
      const input: UpdateAgentInput = { agentId, ...fields, ...(avatarHue === undefined ? {} : { avatarHue }) };
      let updated = await this.updateAgent(input);
      if (args.avatarSeed !== undefined || args.avatarHue !== undefined) {
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
      message: error instanceof Error ? error.message : String(error),
    });
  }

  #emitRuntimeSnapshot(): void {
    this.#emit({ type: "runtime-snapshot", snapshot: this.getRuntimeSnapshot() });
  }

  #emit(event: AgentEvent): void {
    if (this.groups?.event(event)) return;
    this.emit("event", event);
  }
}
