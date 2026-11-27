import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_INSTRUCTION_FILE_NAMES,
  type AgentInstructionFileName,
  type AgentSummary,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  agentMemoryEnabled,
  agentProviderDescriptor,
  agentQuickAcknowledgementEnabled,
  COMPUTER_USE_MCP_SERVER_ID,
  DEFAULT_RESPONSE_STYLE,
  GITHUB_CONNECTOR_MCP_SERVER_ID,
  type McpServerConfig,
  type ResponseStyle,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Result, Schema, Semaphore } from "effect";
import { type AgentClient, type AgentProvider, ProviderStoppedError } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ProviderSession } from "../database/provider-sessions";
import { causeHelpers } from "../effect-boundary";
import { type HomeSkill, listHomeSkills, skillFolderNames, userSkillFolderNames } from "../home-skills";
import type { MailboxStore } from "../mailbox-store";
import type { McpOperationError } from "../mcp-effects";
import {
  agentMcpServers,
  type CodexDisabledMcpServer,
  type CodexMcpServer,
  type CodexOwnServers,
  type CodexOwnTransports,
  codexDeferredMcpServers,
  codexDirectMcpNamespaces,
  codexDisabledServers,
  codexMcpServerKey,
  codexMcpServers,
  codexThreadMcpServers,
  type McpEndpointSource,
  type McpServerDrop,
  type McpServerSource,
  type McpToolRuntimeSource,
  type McpToolRuntimes,
  mcpFingerprintValues,
  NO_MCP_TOOL_RUNTIMES,
  openCodeMcpServers,
  providerMcpServerName,
  toMcpShapeFailed,
  usableMcpServers,
} from "../mcp-provider-shapes";
import { decodeRecordResponse, decodeThreadResponse, getRecord, getString, type ResponseDecoder } from "../protocol";
import { TimeoutError, withTimeout } from "../with-timeout";
import type { AgentMemories } from "./agent-memories";
import { CodexArchiveRetries } from "./codex-archive-retries";
import { readCodexMcpConfig } from "./codex-mcp-config";
import { type CodexPromptSettings, codexPromptSettings } from "./codex-prompt-settings";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import { agentNamesById } from "./delivery-content";
import {
  developerInstructions,
  memoryContext,
  type SectionTeammates,
  type VaultContents,
} from "./developer-instructions";
import {
  appendRoutineDigest,
  hasEarlierChat,
  readHandoffHistory,
  renderProviderHandoff,
  renderRoutineHandoff,
  unsentHandoff,
} from "./handoff-history";
import { decodeCapturedSteps, readCapturedSteps } from "./handoff-tool-steps";
import { mcpFallbackRunsServer } from "./mcp-tools";
import { isProviderTimeout } from "./provider-status";
import { sessionSettingsIdentity } from "./session-settings";
import { isArchivedThreadError, isMissingProviderSessionError, providerLabel } from "./thread-items";
import { toolCatalogNames, visibleDynamicTools } from "./tool-catalog";
import {
  AGENT_INSTRUCTIONS_FILE_BYTES,
  missingInstructionFileNames,
  type PromptInstructionsFile,
  promptInstructionsFile,
} from "./workspace-instructions";
import {
  type CodexApprovalPolicy,
  checkAgentFolders,
  codexApprovalPolicy,
  codexSandboxConfig,
  codexSandboxMode,
  existingAgentFolders,
  workspaceExcludedFolders,
  workspaceWritableRoots,
} from "./workspace-sandbox";

const logger = createOpenBotLogger("thread-lifecycle");

const CODEX_MCP_ADAPTER_VERSION = 10;

const NO_CODEX_OWN_SERVERS: CodexOwnServers = { disabled: {}, transports: {}, read: null };

const RUNTIME_RELOADED_ON_RESUME: ReadonlySet<AgentProvider> = new Set(["claude"]);

export type RuntimeRefreshTiming = "now" | "after-background-work";

type CodexToolApprovals = Array<[string, DynamicRecord]>;
const SESSION_NAME_PREFIX = "OpenBot · ";

interface InstructionsFileInPrompt {
  fileName: PromptInstructionsFile["fileName"];
  found: PromptInstructionsFile | null;
  file: PromptInstructionsFile | null;
  hiddenFromCli: AgentInstructionFileName[];
}

const CODEX_TOOLS_CONFIG = {
  update_plan: { enabled: true },
  experimental_request_user_input: { enabled: false },
} as const;

export const CODEX_FEATURES_CONFIG = {
  "features.goals": false,
  "features.request_permissions_tool": false,
  "features.multi_agent_v2_dynamic_tools": true,
} as const;

const CODEX_COMPUTER_USE_PLUGINS_OFF = {
  "plugins.computer-use@openai-bundled.enabled": false,
  "plugins.unified-computer-use@openai-bundled.enabled": false,
} as const;

const CODEX_BROWSER_PLUGINS_OFF = {
  "plugins.browser@openai-bundled.enabled": false,
  "plugins.chrome@openai-bundled.enabled": false,
  "plugins.chrome-dev@openai-bundled.enabled": false,
  "plugins.chrome-internal@openai-bundled.enabled": false,
} as const;

const CODEX_MCP_STARTUP_GRACE_MS = 10_000;
const CODEX_WAIT_FOR_MCP_STARTUP_MS = 0;

function waitingForMcpStartup(params: DynamicRecord): DynamicRecord {
  const config = params.config;
  return isDynamicRecord(config)
    ? { ...params, config: { ...config, mcp_optional_startup_grace_ms: CODEX_WAIT_FOR_MCP_STARTUP_MS } }
    : params;
}

const CODEX_DIRECT_ONLY_NAMESPACES = [...visibleDynamicTools("codex").map((namespace) => namespace.name), "image_gen"];

const CAPTURE_READ_TIMEOUT_MS = 10_000;

export interface ThreadLifecycleHooks {
  logRecovery(agentId: string, provider: AgentProvider, outcome: "resumed" | "replaced"): void;
  logReleaseFailure(provider: AgentProvider, error: unknown): void;
  reportMcpDrops(provider: AgentProvider, drops: readonly McpServerDrop[]): void;
  logHandoffReadFailure(provider: AgentProvider, error: unknown): void;
}

export interface ThreadLifecycleOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  memories: AgentMemories;
  compaction: ContextCompaction;
  hooks: ThreadLifecycleHooks;
  mcpServers?: McpServerSource;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpEndpoint?: McpEndpointSource;
  mcpProxyFingerprint?: (configs: readonly McpServerConfig[]) => Effect.Effect<string | null, McpOperationError>;
  mcpProxiedServerIds?: (configs: readonly McpServerConfig[]) => readonly string[];
  agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  passwordVaultConnected?: () => boolean;
  vaultItems?: (agentId: string) => VaultContents;
  serverHost?: boolean;
  hostedStorageGb?: () => number | null;
  agentCursorDrawn?: boolean;
  computerUseOnWayland?: boolean;
  computerUseInputRefused?: () => boolean;
  computerUseForegroundInput?: boolean;
  responseStyle?: () => ResponseStyle;
  memoryReview?: () => boolean;
  skillRevision?: () => boolean;
  sectionTeammates?: (agentId: string) => SectionTeammates | null;
  channelThread?: (threadId: string) => boolean;
  branchThread?: (threadId: string) => boolean;
  importedHistory?: (threadId: string) => boolean;
  routineThread?: (threadId: string) => boolean;
  asksFirst?: (agentId: string) => boolean;
}

export class ThreadLifecycle {
  readonly #sessionStarts = new Map<string, number>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #memories: AgentMemories;
  readonly #compaction: ContextCompaction;
  readonly #hooks: ThreadLifecycleHooks;
  readonly #mcpServers: McpServerSource;
  readonly #mcpToolRuntimes: McpToolRuntimeSource | undefined;
  readonly #mcpEndpoint: McpEndpointSource | undefined;
  readonly #mcpProxyFingerprint: (
    configs: readonly McpServerConfig[],
  ) => Effect.Effect<string | null, McpOperationError>;
  readonly #mcpProxiedServerIds: (configs: readonly McpServerConfig[]) => readonly string[];
  readonly #agentEnvironment: () => Readonly<Record<string, string>>;
  readonly #passwordVaultConnected: () => boolean;
  readonly #vaultItems: (agentId: string) => VaultContents;
  readonly #serverHost: boolean;
  readonly #hostedStorageGb: () => number | null;
  readonly #agentCursorDrawn: boolean;
  readonly #computerUseOnWayland: boolean;
  readonly #computerUseInputRefused: () => boolean;
  readonly #computerUseForegroundInput: boolean;
  readonly #responseStyle: () => ResponseStyle;
  readonly #memoryReview: () => boolean;
  readonly #skillRevision: () => boolean;
  readonly #sectionTeammates: (agentId: string) => SectionTeammates | null;
  readonly #channelThread: (threadId: string) => boolean;
  readonly #branchThread: (threadId: string) => boolean;
  readonly #importedHistory: (threadId: string) => boolean;
  readonly #routineThread: (threadId: string) => boolean;
  readonly #asksFirst: (agentId: string) => boolean;
  readonly #pendingHandoffs = new Map<string, string>();
  readonly #failedTurnImages = new Map<string, readonly string[]>();
  readonly #givenTurnContext = new Map<string, string>();
  readonly #handoffWrites = Semaphore.makeUnsafe(1);
  readonly #archiveRetries: CodexArchiveRetries;
  readonly #pendingRuntimeRefreshes = new Set<string>();
  readonly #mcpRuntimeRefreshes = new Set<string>();
  readonly #pendingStarts = new Map<string, number>();
  readonly #pendingMainStarts = new Map<string, number>();
  readonly #idleReleases = new Map<string, Deferred.Deferred<void>>();

  constructor(options: ThreadLifecycleOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#memories = options.memories;
    this.#compaction = options.compaction;
    this.#hooks = options.hooks;
    this.#archiveRetries = new CodexArchiveRetries({
      path: () => join(this.#store.database.userDataPath, "provider-archive-retries.json"),
      logFailure: (provider, error) => this.#hooks.logReleaseFailure(provider, error),
    });
    this.#mcpServers = options.mcpServers ?? (() => []);
    this.#mcpToolRuntimes = options.mcpToolRuntimes;
    this.#mcpEndpoint = options.mcpEndpoint;
    this.#mcpProxyFingerprint = options.mcpProxyFingerprint ?? (() => Effect.succeed(null));
    this.#mcpProxiedServerIds = options.mcpProxiedServerIds ?? (() => []);
    this.#agentEnvironment = options.agentEnvironment ?? (() => ({}));
    this.#passwordVaultConnected = options.passwordVaultConnected ?? (() => false);
    this.#vaultItems = options.vaultItems ?? (() => ({ available: false, cards: false, contacts: false }));
    this.#serverHost = options.serverHost ?? false;
    this.#hostedStorageGb = options.hostedStorageGb ?? (() => null);
    this.#agentCursorDrawn = options.agentCursorDrawn ?? false;
    this.#computerUseOnWayland = options.computerUseOnWayland ?? false;
    this.#computerUseInputRefused = options.computerUseInputRefused ?? (() => false);
    this.#computerUseForegroundInput = options.computerUseForegroundInput ?? false;
    this.#responseStyle = options.responseStyle ?? (() => DEFAULT_RESPONSE_STYLE);
    this.#memoryReview = options.memoryReview ?? (() => false);
    this.#skillRevision = options.skillRevision ?? (() => false);
    this.#sectionTeammates = options.sectionTeammates ?? (() => null);
    this.#channelThread = options.channelThread ?? (() => false);
    this.#branchThread = options.branchThread ?? (() => false);
    this.#importedHistory = options.importedHistory ?? (() => false);
    this.#routineThread = options.routineThread ?? (() => false);
    this.#asksFirst = options.asksFirst ?? (() => false);
  }

  approvalPolicy(agent: Pick<AgentSummary, "id" | "access">): CodexApprovalPolicy {
    return codexApprovalPolicy(agent, this.#asksFirst(agent.id));
  }

  #toolRuntimes(): McpToolRuntimes {
    return this.#mcpToolRuntimes?.() ?? NO_MCP_TOOL_RUNTIMES;
  }

  runtimeRefreshPending(agentId: string): boolean {
    return this.#pendingRuntimeRefreshes.has(agentId);
  }

  readonly refreshAgentRuntime = Effect.fn("ThreadLifecycle.refreshAgentRuntime")(function* (
    this: ThreadLifecycle,
    agentId: string,
  ) {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.selectedGone"));
    this.#pendingRuntimeRefreshes.add(agentId);
    yield* this.applyPendingRuntimeRefresh(agent);
  }, Effect.uninterruptible).bind(this);

  readonly refreshAllAgentRuntimes = Effect.fn("ThreadLifecycle.refreshAllAgentRuntimes")(function* (
    this: ThreadLifecycle,
    timing: RuntimeRefreshTiming,
  ) {
    for (const agent of this.#store.list()) {
      this.#pendingRuntimeRefreshes.add(agent.id);
      if (timing === "now") this.#mcpRuntimeRefreshes.add(agent.id);
      yield* this.applyPendingRuntimeRefresh(agent);
    }
  }, Effect.uninterruptible).bind(this);

  consumePendingHandoff(threadId: string): string | undefined {
    return this.#pendingHandoffs.get(threadId);
  }

  failedTurnImages(agentId: string, providerThreadId: string): string[] {
    const images = this.#failedTurnImages.get(this.#conversation.publicThreadId(agentId, providerThreadId)) ?? [];
    return images.filter((path) => existsSync(path));
  }

  forgetFailedTurnImages(agentId: string, providerThreadId: string): void {
    this.#failedTurnImages.delete(this.#conversation.publicThreadId(agentId, providerThreadId));
  }

  readonly deletePendingHandoff = Effect.fn("ThreadLifecycle.deletePendingHandoff")(function* (
    this: ThreadLifecycle,
    threadId: string,
    sent: string | undefined,
  ) {
    const remove = Effect.gen({ self: this }, function* () {
      const current = this.#pendingHandoffs.get(threadId);
      if (current === undefined) return;
      const rest = unsentHandoff(current, sent);
      if (rest === current) return;
      if (rest === undefined) {
        yield* threadIo(() => rm(this.handoffPath(threadId), { force: true }));
        this.#pendingHandoffs.delete(threadId);
        return;
      }
      yield* threadIo(() => writeFile(this.handoffPath(threadId), rest, { mode: 0o600 }));
      this.#pendingHandoffs.set(threadId, rest);
    });
    yield* this.#handoffWrites.withPermit(remove);
  }).bind(this);

  readonly releaseAgentSessions = Effect.fn("ThreadLifecycle.releaseAgentSessions")(function* (
    this: ThreadLifecycle,
    agentId: string,
    recorded: ReadonlyArray<{ externalThreadId: string; client: AgentClient | null }>,
  ) {
    const sessions = new Map(this.#conversation.openAgentThreads(agentId));
    for (const { externalThreadId, client } of recorded)
      if (client && !sessions.has(externalThreadId)) sessions.set(externalThreadId, client);
    yield* Effect.forEach(
      sessions,
      ([externalThreadId, client]) =>
        Effect.gen({ self: this }, function* () {
          const releaseThread = client.releaseThread?.bind(client);
          if (releaseThread)
            yield* releaseThread(externalThreadId)
              .pipe(toThreadOperationFailed)
              .pipe(
                Effect.catch((failure) =>
                  Effect.sync(() => this.#hooks.logReleaseFailure(client.provider, failure.cause)),
                ),
              );
          yield* this.#archiveSession(client, externalThreadId);
          this.#conversation.unloadThread(externalThreadId);
        }),
      { concurrency: "unbounded", discard: true },
    );
  }, Effect.uninterruptible).bind(this);

  readonly releaseDeletedSession = Effect.fn("ThreadLifecycle.releaseDeletedSession")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
  ) {
    const client = this.#conversation.openClientFor(externalThreadId);
    if (!client) return;
    yield* this.#releaseProviderSession(externalThreadId, client);
    this.#conversation.unloadThread(externalThreadId);
  }, Effect.uninterruptible).bind(this);

  readonly deleteProviderSessionFiles = Effect.fn("ThreadLifecycle.deleteProviderSessionFiles")(function* (
    this: ThreadLifecycle,
    sessionId: string,
    databaseSessionId?: string,
  ) {
    yield* threadIo(() => rm(this.handoffPath(sessionId), { force: true }));
    yield* threadIo(() => rm(this.toolManifestPath(sessionId), { force: true }));
    if (databaseSessionId) yield* threadIo(() => rm(this.workStepsPath(databaseSessionId), { force: true }));
    if (!this.#store.database.listProviderSessionIds(sessionId).some((id) => id !== databaseSessionId))
      yield* threadIo(() => rm(this.legacyWorkStepsPath(sessionId), { force: true }));
    this.#pendingHandoffs.delete(sessionId);
  }, Effect.uninterruptible).bind(this);

  readonly reconcileProviderSessionFiles = Effect.fn("ThreadLifecycle.reconcileProviderSessionFiles")(function* (
    this: ThreadLifecycle,
  ) {
    const recorded = yield* threadStep(
      () =>
        new Set(
          this.#store.database.listExternalSessionIds().map((id) => createHash("sha256").update(id).digest("hex")),
        ),
    );
    const captured = new Set(
      this.#store.database.listProviderSessionIds().map((id) => createHash("sha256").update(id).digest("hex")),
    );
    for (const name of ["provider-handoffs", "provider-toolsets", "provider-work-steps", "provider-work-steps/v2"]) {
      const retained = name === "provider-work-steps/v2" ? captured : recorded;
      const directory = join(this.#store.database.userDataPath, name);
      const files = yield* threadIo(() => readdir(directory, { withFileTypes: true })).pipe(
        Effect.catch((failure) => {
          const error = failure.cause;
          return error instanceof Error && "code" in error && error.code === "ENOENT"
            ? Effect.succeed([])
            : Effect.fail(failure);
        }),
      );
      for (const file of files)
        if (file.isFile() && /^[a-f0-9]{64}$/.test(file.name) && !retained.has(file.name))
          yield* threadIo(() => rm(join(directory, file.name), { force: true }));
    }
  }).bind(this);

  dispose(): void {
    this.#pendingHandoffs.clear();
    this.#failedTurnImages.clear();
    this.#pendingRuntimeRefreshes.clear();
    this.#mcpRuntimeRefreshes.clear();
    this.#pendingStarts.clear();
    this.#pendingMainStarts.clear();
  }

  readonly ensureThread = Effect.fn("ThreadLifecycle.ensureThread")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    executionThreadId?: string,
  ) {
    const publicThreadId =
      executionThreadId ?? (yield* this.#store.ensureThreadId(agent.id).pipe(toThreadOperationFailed));
    if (executionThreadId) this.#conversation.registerExecutionThread(agent.id, executionThreadId);
    const { currentAgent, session } = yield* threadStep(() => ({
      currentAgent: this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent,
      session: this.#store.database.activeProviderSession(publicThreadId, agent.provider),
    }));
    if (session) {
      this.#conversation.bindThread(session.externalSessionId, agent.id, publicThreadId);
      const handoff = yield* Effect.result(
        threadIo(() => readFile(this.handoffPath(session.externalSessionId), "utf8")),
      );
      if (Result.isSuccess(handoff)) this.#pendingHandoffs.set(session.externalSessionId, handoff.success);
      else if (!missingSessionFile(handoff.failure.cause)) return yield* handoff.failure;
      if (
        !(yield* this.#hasCurrentSessionTools(
          this.#sessionAgent(currentAgent, publicThreadId),
          client,
          session.externalSessionId,
        ))
      ) {
        const replacement = yield* this.startProviderThread(
          currentAgent,
          client,
          publicThreadId,
          "configuration-change",
        );
        yield* this.#releaseProviderSession(session.externalSessionId, client);
        yield* threadStep(() => {
          this.retireProviderSession(currentAgent, session.externalSessionId);
          this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
        });
        return replacement;
      }
      const turnContext = yield* this.#turnContextKey(currentAgent, client);
      if (
        this.#conversation.loadedClientFor(session.externalSessionId) !== client ||
        this.#turnContextChanged(client, session.externalSessionId, turnContext)
      ) {
        const resumed = yield* Effect.result(this.resumeThread(currentAgent, client, session.externalSessionId));
        if (Result.isFailure(resumed)) {
          if (!isMissingProviderSessionError(resumed.failure.cause, client.provider)) return yield* resumed.failure;
          yield* threadStep(() => this.retireProviderSession(currentAgent, session.externalSessionId));
          const replacement = yield* this.startProviderThread(currentAgent, client, publicThreadId, "missing-session");
          this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
          return replacement;
        }
      }
      this.#conversation.bindThread(session.externalSessionId, agent.id, publicThreadId);
      return session.externalSessionId;
    }
    return yield* this.startProviderThread(currentAgent, client, publicThreadId);
  }, Effect.uninterruptible).bind(this);

  holdRuntimeRefresh(agentId: string, sideThread = false): () => void {
    const counts = sideThread ? [this.#pendingStarts] : [this.#pendingStarts, this.#pendingMainStarts];
    for (const count of counts) count.set(agentId, (count.get(agentId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const count of counts) {
        const remaining = (count.get(agentId) ?? 1) - 1;
        if (remaining > 0) count.set(agentId, remaining);
        else count.delete(agentId);
      }
    };
  }

  readonly releaseIdleSession = Effect.fn("ThreadLifecycle.releaseIdleSession")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
    client: AgentClient,
    held: (agentId: string) => boolean,
  ) {
    const before = this.#idleSessionState(externalThreadId, client, held);
    if (before !== "idle") return before;
    if (!client.holdsBackgroundWork || !client.releaseThread) return "held";
    const background = yield* Effect.result(client.holdsBackgroundWork(externalThreadId));
    if (Result.isFailure(background) || background.success) return "held";
    const after = this.#idleSessionState(externalThreadId, client, held);
    if (after !== "idle") return after;
    const released = Deferred.makeUnsafe<void>();
    this.#idleReleases.set(externalThreadId, released);
    this.#conversation.unloadThread(externalThreadId);
    yield* this.#releaseProviderSession(externalThreadId, client, true);
    this.#idleReleases.delete(externalThreadId);
    yield* Deferred.succeed(released, undefined);
    return "released";
  }, Effect.uninterruptible).bind(this);

  #idleSessionState(
    externalThreadId: string,
    client: AgentClient,
    held: (agentId: string) => boolean,
  ): "idle" | "held" | "gone" {
    if (this.#conversation.loadedClientFor(externalThreadId) !== client) return "gone";
    const agentId = this.#conversation.agentForThread(externalThreadId);
    if (!agentId || this.#conversation.isRoutineSession(externalThreadId)) return "gone";
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    const session = this.#store.database.activeProviderSession(publicThreadId, client.provider);
    if (session?.externalSessionId !== externalThreadId) return "gone";
    if (
      held(agentId) ||
      this.#pendingStarts.has(agentId) ||
      !this.#compaction.mayDrain(agentId) ||
      this.#mailbox.startingDeliveriesForAgent(agentId).length > 0 ||
      this.#activeTurnOf(agentId, publicThreadId) !== null
    )
      return "held";
    return "idle";
  }

  readonly startProviderThread = Effect.fn("ThreadLifecycle.startProviderThread")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
    reason?: "configuration-change" | "missing-session",
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => this.holdRuntimeRefresh(agent.id, this.#conversation.isSideThread(publicThreadId))),
      () => this.#startProviderThread(agent, client, publicThreadId, reason),
      (release) => Effect.sync(release),
    );
  }, Effect.uninterruptible).bind(this);

  readonly startRoutineThread = Effect.fn("ThreadLifecycle.startRoutineThread")(function* (
    this: ThreadLifecycle,
    owner: AgentSummary,
    client: AgentClient,
    routineThreadId?: string,
  ) {
    const chatThreadId = yield* this.#store.ensureThreadId(owner.id).pipe(toThreadOperationFailed);
    const publicThreadId = routineThreadId ?? chatThreadId;
    const handoff = yield* threadStep(() => {
      const names = agentNamesById(this.#store.list());
      const chat = readHandoffHistory(this.#store.database, owner.id, chatThreadId, names);
      const earlierRuns = routineThreadId
        ? readHandoffHistory(this.#store.database, owner.id, routineThreadId, names)
        : undefined;
      return renderRoutineHandoff(chat, names, earlierRuns);
    });
    const { params } = yield* this.#startParams(owner, client, publicThreadId);
    const response = yield* client
      .request(
        "thread/start",
        { ...waitingForMcpStartup(params), ephemeral: false, persistSession: false },
        decodeThreadResponse,
      )
      .pipe(toThreadOperationFailed);
    const externalThreadId = response.thread.id;
    this.#conversation.bindThread(externalThreadId, owner.id, publicThreadId);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    this.#conversation.registerRoutineSession(owner.id, externalThreadId);
    if (handoff) this.#pendingHandoffs.set(externalThreadId, handoff);
    return externalThreadId;
  }, Effect.uninterruptible).bind(this);

  readonly closeRoutineThread = Effect.fn("ThreadLifecycle.closeRoutineThread")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
    archive = false,
  ) {
    if (!this.#conversation.isRoutineSession(externalThreadId)) return;
    this.#conversation.forgetRoutineSession(externalThreadId);
    const client = this.#conversation.openClientFor(externalThreadId);
    yield* this.#releaseProviderSession(externalThreadId, client);
    if (archive && client) yield* this.#archiveSession(client, externalThreadId);
    this.#conversation.unbindThread(externalThreadId);
    this.#conversation.unloadThread(externalThreadId);
    this.#givenTurnContext.delete(externalThreadId);
    this.#compaction.forgetThread(externalThreadId);
    this.#pendingHandoffs.delete(externalThreadId);
  }, Effect.uninterruptible).bind(this);

  readonly addRoutineDigest = Effect.fn("ThreadLifecycle.addRoutineDigest")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    routineName: string,
    answer: string,
    routineThreadId?: string,
  ) {
    for (const threadId of [agent.threadId, routineThreadId]) {
      if (threadId) yield* this.#addRoutineDigestTo(threadId, agent.provider, routineName, answer);
    }
  }).bind(this);

  readonly #addRoutineDigestTo = Effect.fn("ThreadLifecycle.addRoutineDigestTo")(function* (
    this: ThreadLifecycle,
    threadId: string,
    provider: AgentSummary["provider"],
    routineName: string,
    answer: string,
  ) {
    const session = this.#store.database.activeProviderSession(threadId, provider);
    if (!session) return;
    const id = session.externalSessionId;
    const add = Effect.gen({ self: this }, function* () {
      let existing = this.#pendingHandoffs.get(id);
      if (existing === undefined) {
        const stored = yield* Effect.result(threadIo(() => readFile(this.handoffPath(id), "utf8")));
        if (Result.isSuccess(stored)) existing = stored.success;
        else if (!missingSessionFile(stored.failure.cause)) return yield* stored.failure;
      }
      const handoff = appendRoutineDigest(existing, routineName, answer);
      yield* threadIo(() =>
        mkdir(join(this.#store.database.userDataPath, "provider-handoffs"), { recursive: true, mode: 0o700 }),
      );
      yield* threadIo(() => writeFile(this.handoffPath(id), handoff, { mode: 0o600 }));
      this.#pendingHandoffs.set(id, handoff);
    });
    yield* this.#handoffWrites.withPermit(add);
  }).bind(this);

  readonly #startParams = Effect.fn("ThreadLifecycle.startParams")(function* (
    this: ThreadLifecycle,
    owner: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
  ) {
    const agent = this.#sessionAgent(owner, publicThreadId);
    yield* checkAgentFolders(agent);
    const mcpServers = this.#agentMcpServers(agent);
    const toolRuntimes = this.#toolRuntimes();
    const own = yield* this.codexOwnServersEffect(client, mcpServers, toolRuntimes);
    const environment = this.#agentEnvironment();
    const section = this.#sectionTeammates(agent.id);
    const proxy = client.provider === "codex" ? yield* this.#proxyFingerprint(mcpServers) : null;
    const instructionsFile = yield* this.#instructionsFile(agent, client);
    const config = yield* this.codexConfigEffect(agent, client, mcpServers, own, toolRuntimes, environment);
    const params: DynamicRecord = {
      ...config,
      model: agent.model,
      effort: agent.reasoningEffort,
      cwd: agent.workspacePath,
      runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
      approvalPolicy: this.approvalPolicy(agent),
      approvalsReviewer: "user",
      sandbox: codexSandboxMode(agent),
      ...this.#workspaceOnlyParam(agent, client),
      ...this.#computerUseParam(agent, client),
      ...this.#mcpAgentParam(agent, client),
      ...this.#channelToolsParam(client, publicThreadId),
      ...this.#excludedInstructionFilesParam(instructionsFile),
      ...this.#instructions(
        agent,
        client,
        section,
        this.#computerUseInOwnChat(owner, publicThreadId),
        yield* this.#homeSkills(agent, client),
        this.#runsBesideOwnChat(owner, publicThreadId),
        mcpServers,
        instructionsFile,
        yield* this.#workspaceSkills(agent, client),
      ),
      serviceName: "openbot",
      dynamicTools: visibleDynamicTools(client.provider),
    };
    return { agent, mcpServers, toolRuntimes, own, environment, proxy, instructionsFile, params };
  });

  readonly #startProviderThread = Effect.fn("ThreadLifecycle.prepareProviderThread")(function* (
    this: ThreadLifecycle,
    owner: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
    reason?: "configuration-change" | "missing-session",
  ) {
    const givenContext = yield* this.#turnContextKey(owner, client);
    const { agent, mcpServers, toolRuntimes, own, environment, proxy, instructionsFile, params } =
      yield* this.#startParams(owner, client, publicThreadId);
    const mcpSet = this.#mcpSetFingerprint(mcpServers, toolRuntimes);
    const response = yield* client
      .request("thread/start", { ...params, ephemeral: false }, decodeThreadResponse)
      .pipe(toThreadOperationFailed);
    const sessions = this.#store.database.listProviderSessions(publicThreadId);
    const previousSession = sessions.at(-1);
    const startReason =
      reason ??
      (previousSession
        ? previousSession.provider === client.provider
          ? "retired-session"
          : "provider-switch"
        : "new-session");
    const replaced =
      startReason === "missing-session" ? undefined : sessions.findLast((one) => one.provider === client.provider);
    const key = `${client.provider}:${startReason}`;
    const count = (this.#sessionStarts.get(key) ?? 0) + 1;
    this.#sessionStarts.set(key, count);
    logger.info("Started a provider session.", { provider: client.provider, reason: startReason, count });
    const externalThreadId = response.thread.id;
    const prepared = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        if (client.provider === "codex") {
          const approvals = this.#toolApprovals(mcpServers, own);
          yield* this.#writeToolManifest(
            externalThreadId,
            this.toolFingerprint(agent, mcpServers, own, approvals, toolRuntimes, environment, proxy, instructionsFile),
            approvals,
          );
        } else if (client.mcpToolsFixedAtStart?.(externalThreadId)) {
          yield* this.#writeToolManifest(externalThreadId, mcpSet, []);
        }
        const handoff = yield* this.buildProviderHandoff(agent.id, publicThreadId).pipe(
          Effect.catchDefect((cause) => Effect.fail(new ThreadOperationFailed({ cause }))),
        );
        if (handoff) {
          yield* threadIo(() =>
            mkdir(join(this.#store.database.userDataPath, "provider-handoffs"), { recursive: true, mode: 0o700 }),
          );
          yield* threadIo(() => writeFile(this.handoffPath(externalThreadId), handoff, { mode: 0o600 }));
          this.#pendingHandoffs.set(externalThreadId, handoff);
        }
        yield* threadStep(() => {
          if (publicThreadId === agent.threadId)
            this.#store.bindProviderSession(agent.id, client.provider, externalThreadId);
          else
            this.#store.database.bindProviderSession({
              threadId: publicThreadId,
              provider: client.provider,
              externalSessionId: externalThreadId,
              model: agent.model,
              effort: agent.reasoningEffort,
            });
        });
      }),
    );
    if (Result.isFailure(prepared)) {
      const cleanup = yield* Effect.result(this.deleteProviderSessionFiles(externalThreadId));
      if (Result.isFailure(cleanup))
        return yield* new ThreadOperationFailed({
          cause: new AggregateError(
            [prepared.failure.cause, cleanup.failure.cause],
            "Failed to prepare and clean up the provider session.",
          ),
        });
      return yield* prepared.failure;
    }
    this.#rememberTurnContext(client, externalThreadId, givenContext);
    this.#conversation.bindThread(externalThreadId, agent.id, publicThreadId);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    this.#conversation.ensureSnapshot(agent.id, publicThreadId);
    yield* this.#nameSession(client, externalThreadId, agent, null);
    yield* this.#archiveRetries.retry(client);
    if (replaced) yield* this.#archiveSession(client, replaced.externalSessionId);
    return externalThreadId;
  });

  readonly #archiveSession = Effect.fn("ThreadLifecycle.archiveSession")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    externalThreadId: string,
  ) {
    yield* this.#archiveRetries.archive(client, externalThreadId);
  }, Effect.uninterruptible);

  readonly #nameSession = Effect.fn("ThreadLifecycle.nameSession")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    externalThreadId: string,
    agent: AgentSummary,
    currentName: string | null,
  ) {
    const name = `${SESSION_NAME_PREFIX}${agent.name}`;
    if (!client.nameThread || currentName === name) return;
    if (currentName !== null && !currentName.startsWith(SESSION_NAME_PREFIX)) return;
    yield* client
      .nameThread(externalThreadId, name)
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() =>
            logger.warn("Could not name a provider session.", { provider: client.provider, error: failure.cause }),
          ),
        ),
      );
  }, Effect.uninterruptible);

  private handoffPath(sessionId: string): string {
    return join(
      this.#store.database.userDataPath,
      "provider-handoffs",
      createHash("sha256").update(sessionId).digest("hex"),
    );
  }

  private workStepsPath(sessionId: string): string {
    return join(
      this.#store.database.userDataPath,
      "provider-work-steps",
      "v2",
      createHash("sha256").update(sessionId).digest("hex"),
    );
  }

  private legacyWorkStepsPath(externalSessionId: string): string {
    return join(
      this.#store.database.userDataPath,
      "provider-work-steps",
      createHash("sha256").update(externalSessionId).digest("hex"),
    );
  }

  private toolManifestDirectory(): string {
    return join(this.#store.database.userDataPath, "provider-toolsets");
  }

  private toolManifestPath(sessionId: string): string {
    return join(this.toolManifestDirectory(), createHash("sha256").update(sessionId).digest("hex"));
  }

  private readonly codexConfigEffect = Effect.fn("ThreadLifecycle.codexConfig")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    configs: readonly McpServerConfig[],
    own: CodexOwnServers,
    toolRuntimes: McpToolRuntimes,
    environment: Readonly<Record<string, string>>,
  ): Effect.fn.Return<
    {
      config?: {
        mcp_servers?: Record<string, CodexMcpServer | CodexDisabledMcpServer>;
        tools: typeof CODEX_TOOLS_CONFIG;
        model_reasoning_effort: AgentSummary["reasoningEffort"];
        project_doc_max_bytes: number;
        mcp_optional_startup_grace_ms: number;
        "features.code_mode.direct_only_tool_namespaces": string[];
        [variable: `shell_environment_policy.set.${string}`]: string;
      } & typeof CODEX_FEATURES_CONFIG &
        CodexPromptSettings &
        typeof CODEX_BROWSER_PLUGINS_OFF &
        Partial<typeof CODEX_COMPUTER_USE_PLUGINS_OFF> &
        ReturnType<typeof codexSandboxConfig>;
    },
    ThreadOperationFailed
  > {
    if (client.provider !== "codex") return {};
    const usable = yield* usableMcpServers(configs, toolRuntimes, this.#mcpEndpoint, agent.id).pipe(
      toThreadOperationFailed,
    );
    const { servers, dropped } = yield* threadStep(() => codexMcpServers(usable, own.transports));
    this.#hooks.reportMcpDrops(client.provider, dropped);
    const mcpServers = codexThreadMcpServers(own.disabled, servers);
    return {
      config: {
        ...(Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
        tools: CODEX_TOOLS_CONFIG,
        model_reasoning_effort: agent.reasoningEffort,
        ...CODEX_FEATURES_CONFIG,
        ...codexPromptSettings(own.read),
        ...CODEX_BROWSER_PLUGINS_OFF,
        ...(agentComputerUseEnabled(agent) ? {} : CODEX_COMPUTER_USE_PLUGINS_OFF),
        project_doc_max_bytes: AGENT_INSTRUCTIONS_FILE_BYTES,
        mcp_optional_startup_grace_ms: CODEX_MCP_STARTUP_GRACE_MS,
        "features.code_mode.direct_only_tool_namespaces": [
          ...CODEX_DIRECT_ONLY_NAMESPACES,
          ...codexDirectMcpNamespaces(servers),
        ],
        ...codexSandboxConfig(agent, this.#store.sharedRoot),
        ...Object.fromEntries(
          Object.entries(environment).map(([name, value]) => [`shell_environment_policy.set.${name}`, value]),
        ),
      },
    };
  });

  private readonly codexOwnServersEffect = Effect.fn("ThreadLifecycle.codexOwnServers")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    configs: readonly McpServerConfig[],
    toolRuntimes: McpToolRuntimes,
  ): Effect.fn.Return<CodexOwnServers, ThreadOperationFailed> {
    if (client.provider !== "codex") return NO_CODEX_OWN_SERVERS;
    const usable = yield* usableMcpServers(configs, toolRuntimes).pipe(toThreadOperationFailed);
    const servers = (own: CodexOwnTransports) => codexMcpServers(usable, own).servers;
    return yield* codexDisabledServers(() => readCodexMcpConfig(client, servers).pipe(toMcpShapeFailed)).pipe(
      Effect.catch((failure) => {
        if (Object.keys(servers({})).length === 0) return Effect.succeed(NO_CODEX_OWN_SERVERS);
        if (isProviderTimeout(failure.cause) || !client.running) {
          return Effect.fail(
            new ThreadOperationFailed({
              cause: new ProviderStoppedError(
                "Codex",
                sourceText("error.provider.cliTimedOut", { provider: providerLabel(client.provider) }),
              ),
            }),
          );
        }
        logger.warn("Codex did not register the MCP servers.", {
          message: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
        });
        return Effect.fail(
          new ThreadOperationFailed({
            cause: new Error(
              sourceText(
                configs.every((server) => server.id === COMPUTER_USE_MCP_SERVER_ID)
                  ? "error.provider.computerUseConfig"
                  : "error.provider.mcpConfig",
              ),
            ),
          }),
        );
      }),
    );
  });

  private toolFingerprint(
    agent: AgentSummary,
    configs: readonly McpServerConfig[],
    { disabled }: CodexOwnServers,
    approvals: CodexToolApprovals,
    toolRuntimes: McpToolRuntimes,
    environment: Readonly<Record<string, string>>,
    proxy: string | null,
    instructionsFile: InstructionsFileInPrompt,
    legacySection: SectionTeammates | null = null,
  ): string {
    const folders = existingAgentFolders(agent);
    const excluded = workspaceExcludedFolders(agent);
    const catalogCommands = configs.flatMap((config) => {
      const command = toolRuntimes.catalogCommand?.(config) ?? null;
      return command === null ? [] : [[config.name, command]];
    });
    return createHash("sha256")
      .update(
        JSON.stringify([
          visibleDynamicTools(agent.provider),
          mcpFingerprintValues(configs),
          Object.keys(disabled).sort(),
          approvals,
          [toolRuntimes.binDirectories, toolRuntimes.commandAliases],
          CODEX_MCP_ADAPTER_VERSION,
          [
            agent.name,
            agent.title,
            agent.description,
            ...(workspaceAccessEnforced(agent) ? ["workspace"] : []),
            ...(folders.length ? [["folders", ...folders]] : []),
            ...(excluded.length ? [["excluded", ...excluded]] : []),
            ...(agentAutomationAllowed(agent, this.#store.agentDefaults()) ? ["automation"] : []),
            ...(agentQuickAcknowledgementEnabled(agent, this.#store.agentDefaults()) ? ["quick-acknowledgement"] : []),
            ...(this.#store.agentDefaults().commitCoAuthor ? [] : ["no-commit-co-author"]),
          ],
          ...(Object.keys(environment).length > 0 ? [Object.entries(environment).sort()] : []),
          ...(legacySection ? [legacySection.members.map((member) => member.id).sort()] : []),
          ...(proxy ? [proxy] : []),
          ...(instructionsFile.fileName === "AGENTS.md" ? [] : [["instructions-file", instructionsFile.fileName]]),
          ...(instructionsFile.found?.text ? [["instructions", instructionsFile.found.text]] : []),
          ...(catalogCommands.length > 0 ? [["catalog-commands", ...catalogCommands]] : []),
          ...(agentComputerUseEnabled(agent) ? [] : ["codex-computer-use-off"]),
          ...(agentMemoryEnabled(agent) ? [] : ["memory-off"]),
        ]),
      )
      .digest("hex");
  }

  #toolApprovals(configs: readonly McpServerConfig[], { disabled, transports }: CodexOwnServers): CodexToolApprovals {
    return configs.map((config) => {
      const key = codexMcpServerKey(config, transports);
      return [key, disabled[key]?.tools ?? {}];
    });
  }

  readonly #writeToolManifest = Effect.fn("ThreadLifecycle.writeToolManifest")(function* (
    this: ThreadLifecycle,
    sessionId: string,
    fingerprint: string,
    approvals: CodexToolApprovals,
  ) {
    yield* threadIo(() => mkdir(this.toolManifestDirectory(), { recursive: true, mode: 0o700 }));
    yield* threadIo(() =>
      writeFile(this.toolManifestPath(sessionId), `${fingerprint}\n${JSON.stringify(approvals)}`, { mode: 0o600 }),
    );
  });

  #proxyFingerprint(configs: readonly McpServerConfig[]): Effect.Effect<string | null, ThreadOperationFailed> {
    return this.#mcpProxyFingerprint(configs).pipe(toThreadOperationFailed);
  }

  #sessionAgent(agent: AgentSummary, publicThreadId: string): AgentSummary {
    return this.#computerUseInOwnChat(agent, publicThreadId) ? { ...agent, computerUse: false } : agent;
  }

  readonly #turnContextKey = Effect.fn("ThreadLifecycle.turnContextKey")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
  ) {
    const file = this.#instructionsFileInTurns(client) ? (yield* this.#instructionsFile(agent, client)).file : null;
    return JSON.stringify([
      this.#sectionTeammates(agent.id),
      this.#passwordVaultConnected(),
      file && [file.fileName, file.text, file.truncated],
    ]);
  }).bind(this);

  #instructionsFileInTurns(client: AgentClient): boolean {
    return client.provider === "claude" && client.turnContext === true;
  }

  #rememberTurnContext(client: AgentClient, externalThreadId: string, key: string): void {
    if (client.turnContext === true) this.#givenTurnContext.set(externalThreadId, key);
  }

  #turnContextChanged(client: AgentClient, externalThreadId: string, current: string): boolean {
    const given = this.#givenTurnContext.get(externalThreadId);
    return client.turnContext === true && given !== undefined && given !== current;
  }

  #computerUseInOwnChat(agent: AgentSummary, publicThreadId: string): boolean {
    return (
      this.#conversation.isTaskThread(publicThreadId) &&
      !this.#routineThread(publicThreadId) &&
      agentComputerUseEnabled(agent)
    );
  }

  #runsBesideOwnChat(agent: AgentSummary, publicThreadId: string): boolean {
    if (this.#conversation.isTaskThread(publicThreadId)) return true;
    return (
      this.#conversation.channelForThread(publicThreadId) !== null &&
      agentProviderDescriptor(agent.provider).concurrentTurns
    );
  }

  #agentMcpServers(agent: AgentSummary): readonly McpServerConfig[] {
    return agentMcpServers(this.#mcpServers(agent.id), agentComputerUseEnabled(agent));
  }

  #workspaceOnlyParam(agent: AgentSummary, client: AgentClient): { workspaceOnly?: true; excludedFolders?: string[] } {
    if (
      agentProviderDescriptor(client.provider).workspaceEnforcement !== "tool-sandbox" ||
      !workspaceAccessEnforced(agent)
    )
      return {};
    const excluded = workspaceExcludedFolders(agent);
    return { workspaceOnly: true, ...(excluded.length ? { excludedFolders: excluded } : {}) };
  }

  #computerUseParam(agent: AgentSummary, client: AgentClient): { computerUse?: false } {
    return client.provider === "codex" || agentComputerUseEnabled(agent) ? {} : { computerUse: false };
  }

  #mcpAgentParam(agent: AgentSummary, client: AgentClient): { openbotAgentId?: string } {
    return client.provider === "codex" ? {} : { openbotAgentId: agent.id };
  }

  #channelToolsParam(client: AgentClient, publicThreadId: string): { channelTools?: true } {
    return (client.provider === "claude" || client.provider === "grok") &&
      this.#conversation.channelForThread(publicThreadId) !== null
      ? { channelTools: true }
      : {};
  }

  readonly #hasCurrentSessionTools = Effect.fn("ThreadLifecycle.hasCurrentSessionTools")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    sessionId: string,
  ) {
    if (client.provider === "codex") return yield* this.hasCurrentToolsEffect(agent, client, sessionId);
    if (!client.mcpToolsFixedAtStart?.(sessionId) || this.#conversation.loadedClientFor(sessionId) === client)
      return true;
    const fingerprint = yield* threadStep(() =>
      this.#mcpSetFingerprint(this.#agentMcpServers(agent), this.#toolRuntimes()),
    );
    const stored = yield* Effect.result(threadIo(() => readFile(this.toolManifestPath(sessionId), "utf8")));
    if (Result.isSuccess(stored)) return stored.success.split("\n", 1)[0] === fingerprint;
    if (!missingSessionFile(stored.failure.cause)) return yield* stored.failure;
    yield* this.#writeToolManifest(sessionId, fingerprint, []);
    return true;
  });

  #mcpSetFingerprint(configs: readonly McpServerConfig[], toolRuntimes: McpToolRuntimes): string {
    const rows = configs.filter(
      (config) => config.id !== COMPUTER_USE_MCP_SERVER_ID && config.id !== GITHUB_CONNECTOR_MCP_SERVER_ID,
    );
    const { binDirectories, commandAliases } = toolRuntimes;
    return createHash("sha256")
      .update(
        JSON.stringify([mcpFingerprintValues(rows), this.#mcpProxiedServerIds(rows), [binDirectories, commandAliases]]),
      )
      .digest("hex");
  }

  private readonly hasCurrentToolsEffect = Effect.fn("ThreadLifecycle.hasCurrentTools")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    sessionId: string,
  ) {
    const stored = yield* Effect.result(threadIo(() => readFile(this.toolManifestPath(sessionId), "utf8")));
    if (Result.isFailure(stored)) {
      if (missingSessionFile(stored.failure.cause)) return false;
      return yield* stored.failure;
    }
    yield* checkAgentFolders(agent);
    const configs = this.#agentMcpServers(agent);
    const toolRuntimes = this.#toolRuntimes();
    const own = yield* this.codexOwnServersEffect(client, configs, toolRuntimes);
    const proxy = yield* this.#proxyFingerprint(configs);
    const environment = this.#agentEnvironment();
    const section = this.#sectionTeammates(agent.id);
    const approvals = this.#toolApprovals(configs, own);
    const instructionsFile = yield* this.#instructionsFile(agent, client);
    const newline = stored.success.indexOf("\n");
    const storedFingerprint = newline < 0 ? stored.success : stored.success.slice(0, newline);
    const matches = (sessionApprovals: CodexToolApprovals, sections: readonly (SectionTeammates | null)[]) =>
      threadStep(() =>
        sections.some(
          (legacySection) =>
            storedFingerprint ===
            this.toolFingerprint(
              agent,
              configs,
              own,
              sessionApprovals,
              toolRuntimes,
              environment,
              proxy,
              instructionsFile,
              legacySection,
            ),
        ),
      );
    const fingerprint = yield* threadStep(() =>
      this.toolFingerprint(agent, configs, own, approvals, toolRuntimes, environment, proxy, instructionsFile),
    );
    if (storedFingerprint === fingerprint) return true;
    if (section && (yield* matches(approvals, [section]))) {
      yield* this.#writeToolManifest(sessionId, fingerprint, approvals);
      return true;
    }
    if (newline < 0) return false;
    const sessionApprovals = yield* threadStep(() =>
      decodeToolApprovals(JSON.parse(stored.success.slice(newline + 1))),
    ).pipe(Effect.orElseSucceed(() => null));
    if (!sessionApprovals || approvalRevoked(sessionApprovals, approvals)) return false;
    if (!(yield* matches(sessionApprovals, section ? [null, section] : [null]))) return false;
    yield* this.#writeToolManifest(sessionId, fingerprint, approvals);
    return true;
  });

  #instructions(
    agent: AgentSummary,
    client: AgentClient,
    section = this.#sectionTeammates(agent.id),
    computerUseInOwnChat = false,
    homeSkills: readonly HomeSkill[] = [],
    sideThread = false,
    mcpServers: readonly McpServerConfig[],
    instructionsFile: InstructionsFileInPrompt,
    workspaceSkills: readonly string[] = [],
  ): DynamicRecord {
    const memoryEnabled = agentMemoryEnabled(agent);
    const memories = memoryEnabled ? this.#memories.essentialFor(agent.id) : [];
    const options = {
      computerUseInOwnChat,
      computerUseNotReady:
        agentComputerUseEnabled(agent) && !mcpServers.some((config) => config.id === COMPUTER_USE_MCP_SERVER_ID),
      sideThread,
      passwordVault: this.#passwordVaultConnected(),
      vaultItems: this.#vaultItems(agent.id),
      serverHost: this.#serverHost,
      hostedStorageGb: this.#hostedStorageGb(),
      agentCursorDrawn: this.#agentCursorDrawn,
      computerUseOnWayland: this.#computerUseOnWayland,
      computerUseInputRefused: this.#computerUseInputRefused(),
      computerUseForegroundInput: this.#computerUseForegroundInput,
      responseStyle: this.#responseStyle(),
      memoryReview: this.#memoryReview(),
      skillRevision: this.#skillRevision(),
      memoryLimit: this.#memories.limit(),
      storedMemoryCount: this.#memories.listFor(agent.id).length,
      memoriesInTurns: memoryEnabled && client.turnContext === true,
      teammatesInTurns: client.turnContext === true,
      savedLoginsInTurns: client.turnContext === true,
      instructionsFileInTurns: this.#instructionsFileInTurns(client),
      sectionTeammates: section,
      homeSkills,
      workspaceSkills,
      httpMcpServers: mcpServers.some((config) => config.transport === "http"),
      mcpApps: mcpServers.some((config) => config.id !== COMPUTER_USE_MCP_SERVER_ID),
      deferredMcpServers:
        client.provider === "codex"
          ? codexDeferredMcpServers(mcpServers).map((config) => config.name)
          : client.provider === "opencode"
            ? openCodeMcpServers(mcpServers).map((config) => config.name)
            : // Antigravity 1.5 leaves the tools over its schema budget out (#7427). OpenBot runs the
              client.provider === "antigravity"
              ? mcpServers
                  .filter((config) => mcpFallbackRunsServer(config, agent))
                  .map(
                    (config) =>
                      client.sessionMcpServerName?.(config, agent.workspacePath) ?? providerMcpServerName(config.name),
                  )
              : [],
      catalogAsMcpTools: client.catalogAsMcpTools?.(agent.model) === true,
      ...(client.provider === "antigravity" ? { toolCatalog: toolCatalogNames(client.provider) } : {}),
      instructionsFileName: instructionsFile.fileName,
      instructionsFile: instructionsFile.file,
    };
    const instructions = developerInstructions(
      agent,
      this.#store.sharedRoot,
      memories,
      this.#store.automationRoot,
      this.#store.agentDefaults(),
      options,
    );
    return client.turnContext === true
      ? {
          developerInstructions: instructions,
          ...(options.memoriesInTurns ? { memoryContext: memoryContext(memories, options) } : {}),
          sectionTeammates: section,
          savedLogins: options.passwordVault,
          ...(options.instructionsFileInTurns ? { instructionsFile: options.instructionsFile } : {}),
          ...(options.responseStyle === "natural" && client.provider === "claude" ? { turnStyleReminder: true } : {}),
        }
      : { developerInstructions: instructions };
  }

  readonly #homeSkills = Effect.fn("ThreadLifecycle.homeSkills")(function* (agent: AgentSummary, client: AgentClient) {
    const descriptor = agentProviderDescriptor(client.provider);
    if (descriptor.homeSkills !== "instructions") return [];
    const read = new Set<string>();
    for (const folder of descriptor.skillFolders)
      for (const name of yield* skillFolderNames(join(agent.workspacePath, folder))) read.add(name);
    return (yield* listHomeSkills()).filter((skill) => !read.has(skill.slug));
  });

  readonly #workspaceSkills = Effect.fn("ThreadLifecycle.workspaceSkills")(function* (
    agent: AgentSummary,
    client: AgentClient,
  ) {
    if (client.provider !== "codex") return [];
    return yield* userSkillFolderNames(join(agent.workspacePath, ".agents", "skills"));
  });

  readonly #instructionsFile = Effect.fn("ThreadLifecycle.instructionsFile")(function* (
    agent: AgentSummary,
    client: AgentClient,
  ) {
    const enforced = workspaceAccessEnforced(agent);
    const read =
      client.provider === "claude" && enforced
        ? []
        : agentProviderDescriptor(client.provider).workspaceInstructionFiles;
    const file = yield* promptInstructionsFile(agent.workspacePath, read);
    const sent = file && !file.readByCli ? file : null;
    const cliReadsProjectFiles = client.provider === "claude" && !enforced;
    const missing = cliReadsProjectFiles ? yield* missingInstructionFileNames(agent.workspacePath) : [];
    return {
      fileName: file?.fileName ?? "AGENTS.md",
      found: file,
      file: sent,
      hiddenFromCli: cliReadsProjectFiles
        ? AGENT_INSTRUCTION_FILE_NAMES.filter(
            (fileName) => !read.includes(fileName) && (sent?.fileName === fileName || missing.includes(fileName)),
          )
        : [],
    } satisfies InstructionsFileInPrompt;
  });

  #excludedInstructionFilesParam(instructionsFile: InstructionsFileInPrompt): {
    excludedInstructionFiles?: AgentInstructionFileName[];
  } {
    return instructionsFile.hiddenFromCli.length > 0
      ? { excludedInstructionFiles: instructionsFile.hiddenFromCli }
      : {};
  }

  readonly threadParams = Effect.fn("ThreadLifecycle.threadParams")(function* (
    this: ThreadLifecycle,
    owner: AgentSummary,
    client: AgentClient,
    externalThreadId: string,
  ): Effect.fn.Return<DynamicRecord, ThreadOperationFailed> {
    const publicThreadId = this.#conversation.publicThreadId(owner.id, externalThreadId);
    const computerUseInOwnChat = this.#computerUseInOwnChat(owner, publicThreadId);
    const agent = this.#sessionAgent(owner, publicThreadId);
    yield* checkAgentFolders(agent);
    const configs = this.#agentMcpServers(agent);
    const toolRuntimes = this.#toolRuntimes();
    const instructionsFile = yield* this.#instructionsFile(agent, client);
    return {
      threadId: externalThreadId,
      model: agent.model,
      effort: agent.reasoningEffort,
      cwd: agent.workspacePath,
      runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
      approvalPolicy: this.approvalPolicy(agent),
      approvalsReviewer: "user",
      sandbox: codexSandboxMode(agent),
      ...this.#workspaceOnlyParam(agent, client),
      ...this.#computerUseParam(agent, client),
      ...this.#mcpAgentParam(agent, client),
      ...this.#channelToolsParam(client, publicThreadId),
      ...this.#excludedInstructionFilesParam(instructionsFile),
      ...this.#instructions(
        agent,
        client,
        this.#sectionTeammates(agent.id),
        computerUseInOwnChat,
        yield* this.#homeSkills(agent, client),
        this.#runsBesideOwnChat(agent, publicThreadId),
        configs,
        instructionsFile,
        yield* this.#workspaceSkills(agent, client),
      ),
      ...(client.provider === "codex" ? {} : { dynamicTools: visibleDynamicTools(client.provider) }),
      ...(yield* this.codexConfigEffect(
        agent,
        client,
        configs,
        yield* this.codexOwnServersEffect(client, configs, toolRuntimes),
        toolRuntimes,
        this.#agentEnvironment(),
      )),
    };
  }).bind(this);

  readonly resumeThread = Effect.fn("ThreadLifecycle.resumeThread")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    externalThreadId: string,
  ) {
    const releasing = this.#idleReleases.get(externalThreadId);
    if (releasing) yield* Deferred.await(releasing);
    this.#conversation.bindThread(externalThreadId, agent.id);
    const givenContext = yield* this.#turnContextKey(agent, client);
    const params = yield* this.threadParams(agent, client, externalThreadId);
    const resumed = yield* Effect.result(
      client.request("thread/resume", params, decodeRecordResponse).pipe(toThreadOperationFailed),
    );
    let response: DynamicRecord;
    if (Result.isFailure(resumed)) {
      if (client.provider !== "codex" || !isArchivedThreadError(resumed.failure.cause)) return yield* resumed.failure;
      yield* client
        .request("thread/unarchive", { threadId: externalThreadId }, decodeRecordResponse)
        .pipe(toThreadOperationFailed);
      response = yield* client.request("thread/resume", params, decodeRecordResponse).pipe(toThreadOperationFailed);
    } else response = resumed.success;
    this.#rememberTurnContext(client, externalThreadId, givenContext);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    yield* this.#nameSession(client, externalThreadId, agent, getString(getRecord(response, "thread"), "name"));
    yield* this.#archiveRetries.retry(client);
  }).bind(this);

  readonly dropRefusedProviderSession = Effect.fn("ThreadLifecycle.dropRefusedProviderSession")(function* (
    this: ThreadLifecycle,
    agentId: string,
    externalThreadId: string,
    failedTurnImages: readonly string[] = [],
  ) {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    yield* this.#releaseProviderSession(externalThreadId);
    this.retireProviderSession(agent, externalThreadId);
    if (failedTurnImages.length > 0) this.#failedTurnImages.set(publicThreadId, failedTurnImages);
    else this.#failedTurnImages.delete(publicThreadId);
    this.#hooks.logRecovery(agentId, agent.provider, "replaced");
  }, Effect.uninterruptible).bind(this);

  rotatesSession(agentId: string, externalThreadId: string): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return false;
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    if (publicThreadId !== agent.threadId && !this.#channelThread(publicThreadId)) return false;
    return (
      this.#store.database.activeProviderSession(publicThreadId, agent.provider)?.externalSessionId === externalThreadId
    );
  }

  readonly loadSessionForCompaction = Effect.fn("ThreadLifecycle.loadSessionForCompaction")(function* (
    this: ThreadLifecycle,
    agentId: string,
    client: AgentClient,
    externalThreadId: string,
  ) {
    if (client.provider !== "codex" || this.#conversation.openClientFor(externalThreadId) === client) return true;
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return false;
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    if (!(yield* this.hasCurrentToolsEffect(this.#sessionAgent(agent, publicThreadId), client, externalThreadId)))
      return false;
    const resumed = yield* Effect.result(
      Effect.acquireUseRelease(
        Effect.sync(() => this.holdRuntimeRefresh(agentId, this.#conversation.isSideThread(publicThreadId))),
        () => this.resumeThread(agent, client, externalThreadId),
        (release) => Effect.sync(release),
      ),
    );
    if (Result.isSuccess(resumed)) return true;
    if (isMissingProviderSessionError(resumed.failure.cause, client.provider)) return false;
    return yield* resumed.failure;
  }, Effect.uninterruptible).bind(this);

  readonly rotateProviderSession = Effect.fn("ThreadLifecycle.rotateProviderSession")(function* (
    this: ThreadLifecycle,
    agentId: string,
    client: AgentClient,
    externalThreadId: string,
  ) {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return null;
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    if (publicThreadId !== agent.threadId && !this.#channelThread(publicThreadId)) return null;
    const session = this.#store.database.activeProviderSession(publicThreadId, client.provider);
    if (session?.externalSessionId !== externalThreadId) return null;
    const steps = yield* this.readWorkSteps(session);
    if (steps !== null) yield* this.saveWorkSteps(session, steps);
    yield* this.#releaseProviderSession(externalThreadId);
    this.retireProviderSession(agent, externalThreadId);
    return yield* this.startProviderThread(agent, client, publicThreadId);
  }, Effect.uninterruptible).bind(this);

  retireProviderSession(agent: AgentSummary, externalThreadId: string): void {
    const publicThreadId = this.#conversation.publicThreadId(agent.id, externalThreadId);
    const session = this.#store.database.activeProviderSession(publicThreadId, agent.provider);
    if (session?.externalSessionId !== externalThreadId) return;
    this.#store.database.deactivateProviderSessions(publicThreadId);
    this.#conversation.unbindThread(externalThreadId);
    this.#conversation.unloadThread(externalThreadId);
    this.#givenTurnContext.delete(externalThreadId);
    this.#compaction.forgetThread(externalThreadId);
    this.#pendingHandoffs.delete(externalThreadId);
  }

  readonly requestWithArchivedThreadRecovery = Effect.fn("ThreadLifecycle.requestWithArchivedThreadRecovery")(
    function* <T>(
      this: ThreadLifecycle,
      agent: AgentSummary,
      client: AgentClient,
      method: string,
      params: unknown,
      decoder: ResponseDecoder<T>,
    ) {
      const response = yield* Effect.result(client.request(method, params, decoder).pipe(toThreadOperationFailed));
      if (Result.isSuccess(response)) return response.success;
      if (client.provider !== "codex" || !isArchivedThreadError(response.failure.cause)) return yield* response.failure;
      const threadId = getString(params, "threadId");
      if (!threadId) return yield* response.failure;
      yield* this.resumeThread(agent, client, threadId);
      return yield* client.request(method, params, decoder).pipe(toThreadOperationFailed);
    },
  );

  logRecovery(agentId: string, provider: AgentProvider, outcome: "resumed" | "replaced"): void {
    this.#hooks.logRecovery(agentId, provider, outcome);
  }

  readonly applyPendingRuntimeRefresh = Effect.fn("ThreadLifecycle.applyPendingRuntimeRefresh")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    startingDeliveryIds: ReadonlySet<string> = new Set(),
  ) {
    const settingsIdentity = sessionSettingsIdentity(agent);
    const resets = this.#store.list().find((candidate) => candidate.id === agent.id)?.sessionSettingResets;
    if (resets?.includes(settingsIdentity)) this.#pendingRuntimeRefreshes.add(agent.id);
    if (!this.#pendingRuntimeRefreshes.has(agent.id)) return;
    if (!this.#compaction.mayDrain(agent.id)) return;
    if (this.#pendingStarts.has(agent.id)) return;
    const unconfirmed = this.#mailbox.startingDeliveriesForAgent(agent.id);
    if (unconfirmed.some(({ delivery }) => !startingDeliveryIds.has(delivery.id))) return;
    let deferred = false;
    const threadIds = this.#store.database.activeProviderSessionThreads(agent.id);
    const reloadProvider = RUNTIME_RELOADED_ON_RESUME.has(agent.provider) ? agent.provider : null;
    const waitsForBackground = reloadProvider !== null && !this.#mcpRuntimeRefreshes.has(agent.id);
    for (const threadId of threadIds) {
      if (this.#activeTurnOf(agent.id, threadId) || (waitsForBackground && (yield* this.#runsBackgroundWork(threadId))))
        deferred = true;
      else yield* this.#refreshThreadRuntime(threadId, reloadProvider);
    }
    if (!deferred) {
      this.#pendingRuntimeRefreshes.delete(agent.id);
      this.#mcpRuntimeRefreshes.delete(agent.id);
      this.#store.clearSessionSettingReset(agent.id, settingsIdentity);
    }
  }, Effect.uninterruptible).bind(this);

  mainRunsBackgroundWork(agent: AgentSummary): Effect.Effect<boolean> {
    if (agent.threadId === null) return Effect.succeed(false);
    return this.#runsBackgroundWork(agent.threadId, RUNTIME_RELOADED_ON_RESUME);
  }

  readonly #runsBackgroundWork = Effect.fn("ThreadLifecycle.runsBackgroundWork")(function* (
    this: ThreadLifecycle,
    threadId: string,
    providers?: ReadonlySet<AgentProvider>,
  ) {
    for (const session of this.#store.database.listProviderSessions(threadId)) {
      if (session.state !== "active" || (providers && !providers.has(session.provider))) continue;
      const client = this.#conversation.openClientFor(session.externalSessionId);
      if (!client?.holdsBackgroundWork) continue;
      const background = yield* Effect.result(client.holdsBackgroundWork(session.externalSessionId));
      if (Result.isFailure(background) || background.success) return true;
    }
    return false;
  });

  providerContextBusy(agent: AgentSummary): boolean {
    if (!this.#compaction.mayDrain(agent.id) || this.#pendingStarts.has(agent.id)) return true;
    if (this.#mailbox.startingDeliveriesForAgent(agent.id).length > 0) return true;
    return agent.threadId !== null && this.#activeTurnOf(agent.id, agent.threadId) !== null;
  }

  mainContextBusy(agent: AgentSummary): boolean {
    if (this.#pendingMainStarts.has(agent.id)) return true;
    const mainCompacts = this.#compaction
      .heldThreads(agent.id)
      .some(
        (externalThreadId) =>
          !this.#conversation.isSideThread(this.#conversation.publicThreadId(agent.id, externalThreadId)),
      );
    if (mainCompacts || this.#mailbox.startingDeliveriesForAgent(agent.id, null).length > 0) return true;
    return agent.threadId !== null && this.#activeTurnOf(agent.id, agent.threadId) !== null;
  }

  readonly endThreadContext = Effect.fn("ThreadLifecycle.endThreadContext")(function* (
    this: ThreadLifecycle,
    threadId: string,
  ) {
    yield* this.#refreshThreadRuntime(threadId);
  }, Effect.uninterruptible).bind(this);

  #activeTurnOf(agentId: string, threadId: string): string | null {
    const snapshot = [...this.#conversation.activeSnapshots()].find(
      ([id, candidate]) => id === agentId && candidate.threadId === threadId,
    )?.[1];
    return snapshot?.activeTurnId ?? this.#store.database.readActiveTurnId(agentId, threadId);
  }

  readonly #refreshThreadRuntime = Effect.fn("ThreadLifecycle.refreshThreadRuntime")(function* (
    this: ThreadLifecycle,
    threadId: string,
    reloadProvider: AgentProvider | null = null,
  ) {
    const sessions = this.#store.database.listProviderSessions(threadId).filter((one) => one.state === "active");
    if (reloadProvider && sessions.length > 0 && sessions.every((one) => one.provider === reloadProvider)) {
      for (const session of sessions) {
        yield* this.#releaseProviderSession(session.externalSessionId, undefined, true);
        this.#conversation.unloadThread(session.externalSessionId);
      }
      return;
    }
    this.#store.database.deactivateProviderSessions(threadId);
    this.#failedTurnImages.delete(threadId);
    for (const session of sessions) {
      yield* this.#releaseProviderSession(session.externalSessionId);
      this.#conversation.unbindThread(session.externalSessionId);
      this.#conversation.unloadThread(session.externalSessionId);
      this.#compaction.forgetThread(session.externalSessionId);
      this.#pendingHandoffs.delete(session.externalSessionId);
    }
  }, Effect.uninterruptible);

  readonly #releaseProviderSession = Effect.fn("ThreadLifecycle.releaseProviderSession")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
    client: AgentClient | undefined = this.#conversation.openClientFor(externalThreadId),
    resumes = false,
  ) {
    this.#givenTurnContext.delete(externalThreadId);
    if (!client?.releaseThread) return;
    yield* client
      .releaseThread(externalThreadId, resumes)
      .pipe(
        Effect.catch((failure) => Effect.sync(() => this.#hooks.logReleaseFailure(client.provider, failure.cause))),
      );
  }, Effect.uninterruptible);

  readonly capturedWorkSteps = Effect.fn("ThreadLifecycle.capturedWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    let text = yield* Effect.result(threadIo(() => readFile(this.workStepsPath(session.id), "utf8")));
    if (
      Result.isFailure(text) &&
      missingSessionFile(text.failure.cause) &&
      this.#store.database.listProviderSessionIds(session.externalSessionId).every((id) => id === session.id)
    )
      text = yield* Effect.result(
        threadIo(() => readFile(this.legacyWorkStepsPath(session.externalSessionId), "utf8")),
      );
    if (Result.isFailure(text)) {
      if (missingSessionFile(text.failure.cause)) return null;
      this.#hooks.logHandoffReadFailure(session.provider, text.failure.cause);
      return null;
    }
    const decoded = yield* Effect.result(threadStep(() => decodeCapturedSteps(text.success)));
    if (Result.isSuccess(decoded)) return decoded.success;
    this.#hooks.logHandoffReadFailure(session.provider, decoded.failure.cause);
    return null;
  }).bind(this);

  readonly readWorkSteps = Effect.fn("ThreadLifecycle.readWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    const client = this.#conversation.loadedClientFor(session.externalSessionId);
    if (!client || client.provider !== session.provider) return null;
    return yield* withTimeout(
      readCapturedSteps(client, session.externalSessionId),
      CAPTURE_READ_TIMEOUT_MS,
      "The session to replace could not be read in time.",
    ).pipe(
      Effect.map((steps) => JSON.stringify(Object.fromEntries(steps))),
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#hooks.logHandoffReadFailure(
            session.provider,
            failure instanceof TimeoutError ? failure : failure.cause,
          );
          return null;
        }),
      ),
    );
  }).bind(this);

  readonly saveWorkSteps = Effect.fn("ThreadLifecycle.saveWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
    captured: string,
  ) {
    yield* threadIo(() =>
      mkdir(join(this.#store.database.userDataPath, "provider-work-steps", "v2"), { recursive: true, mode: 0o700 }),
    ).pipe(
      Effect.andThen(threadIo(() => writeFile(this.workStepsPath(session.id), captured, { mode: 0o600 }))),
      Effect.catch((failure) => Effect.sync(() => this.#hooks.logHandoffReadFailure(session.provider, failure.cause))),
    );
  }).bind(this);

  readonly buildProviderHandoff = Effect.fn("ThreadLifecycle.buildProviderHandoff")(function* (
    this: ThreadLifecycle,
    agentId: string,
    threadId: string,
  ) {
    if (this.#conversation.isExecutionThread(threadId) && !this.#conversation.isTaskThread(threadId)) return null;
    const sessions = this.#store.database.listProviderSessions(threadId);
    const branch = this.#conversation.isTaskThread(threadId) && this.#branchThread(threadId);
    if (sessions.length < 1 && !branch && !this.#importedHistory(threadId)) return null;
    const agentNames = agentNamesById(this.#store.list());
    const history = readHandoffHistory(this.#store.database, agentId, threadId, agentNames);
    const captures = new Map<string, Map<string, string> | null>();
    const steps = new Map<string, string>();
    const turns = new Set<string>();
    for (const row of history.recent) {
      const session = sessions.find((candidate) => candidate.id === row.providerSessionId);
      if (!session || !row.message.turnId) continue;
      const key = `${session.id}:${row.message.turnId}`;
      if (turns.has(key)) continue;
      turns.add(key);
      if (!captures.has(session.id)) captures.set(session.id, yield* this.capturedWorkSteps(session));
      const text = captures.get(session.id)?.get(row.message.turnId);
      if (text) steps.set(row.message.id, text);
    }
    return renderProviderHandoff(history, agentNames, steps, {
      branch,
      earlierChat: hasEarlierChat(this.#store.database, agentId, threadId, history.resetMessageId),
    });
  }).bind(this);
}

export class ThreadOperationFailed extends Schema.TaggedError<ThreadOperationFailed>()("ThreadOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { io: threadIo, sync: threadStep, rewrap: toThreadOperationFailed } = causeHelpers(ThreadOperationFailed);

function decodeToolApprovals(value: unknown): CodexToolApprovals | null {
  if (!Array.isArray(value)) return null;
  const approvals: CodexToolApprovals = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isDynamicRecord(entry[1])) return null;
    approvals.push([entry[0], entry[1]]);
  }
  return approvals;
}

function approvalRevoked(session: CodexToolApprovals, current: CodexToolApprovals): boolean {
  const before = new Map(session);
  const now = new Map(current);
  const changed = session.some(([key, tools]) =>
    Object.entries(tools).some(([tool, setting]) => JSON.stringify(now.get(key)?.[tool]) !== JSON.stringify(setting)),
  );
  return (
    changed ||
    current.some(([key, tools]) =>
      Object.entries(tools).some(
        ([tool, setting]) =>
          before.get(key)?.[tool] === undefined && !(isDynamicRecord(setting) && setting.approval_mode === "approve"),
      ),
    )
  );
}

function missingSessionFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
