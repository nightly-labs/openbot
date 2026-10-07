import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSummary,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  agentProviderDescriptor,
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  isContextResetMarker,
  type McpServerConfig,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { BROWSER_DYNAMIC_TOOLS } from "../browser-tools";
import { mergeConversationSnapshots } from "../conversation-snapshots";
import type { ProviderSession } from "../database/provider-sessions";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import {
  agentMcpServers,
  type CodexDisabledMcpServer,
  type CodexMcpServer,
  codexDisabledServers,
  codexMcpServers,
  type McpAuthorizationSource,
  type McpServerDrop,
  type McpServerSource,
  type McpToolRuntimeSource,
  type McpToolRuntimes,
  mcpFingerprintValues,
  NO_MCP_TOOL_RUNTIMES,
  toMcpShapeFailed,
  usableMcpServers,
} from "../mcp-provider-shapes";
import { OPENBOT_DYNAMIC_TOOLS } from "../openbot-tools";
import { decodeRecordResponse, decodeThreadResponse, getString, type ResponseDecoder } from "../protocol";
import { TimeoutError, withTimeout } from "../with-timeout";
import type { AgentMemories } from "./agent-memories";
import { readCodexMcpConfig } from "./codex-mcp-config";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  agentNamesById,
  estimateTokens,
  HANDOFF_END,
  HANDOFF_START,
  renderHandoffMessage,
  summarizeOldMessages,
} from "./delivery-content";
import { developerInstructions } from "./developer-instructions";
import {
  decodeCapturedSteps,
  decodeProviderTurns,
  encodeCapturedSteps,
  type ProviderTurnSteps,
  renderTurnSteps,
} from "./handoff-tool-steps";
import { isArchivedThreadError, isMissingProviderSessionError } from "./thread-items";
import { codexSandboxConfig, codexSandboxMode, workspaceWritableRoots } from "./workspace-sandbox";

/**
 * What the Codex adapter sends, versioned. Codex ignores MCP configuration on resume, so a
 * session started by an older adapter keeps the servers it was given even when the stored set
 * is unchanged. Folding this into the tool fingerprint refreshes those sessions once through
 * the replacement flow. Bump it when what Codex is sent changes; 2 is HTTP servers joining
 * the payload, 3 is the sweep that turns off the servers `~/.codex/config.toml` declares, and 4 is
 * the managed tool runtimes joining the fingerprint, so a session started before Bun finished
 * downloading is replaced once its servers can actually start, 5 is the plan tool below, and 6 is
 * server names in the form Codex accepts.
 */
const CODEX_MCP_ADAPTER_VERSION = 6;

/**
 * Codex offers `update_plan` only when this is on, and without it a turn sends no
 * `turn/plan/updated`, so the conversation shows no task list.
 */
const CODEX_TOOLS_CONFIG = { update_plan: { enabled: true } } as const;

// A handoff can follow an edit of the profile. The earlier replies then show the old standing
// remit, and without this line the model copies them instead of following the new one.
const HANDOFF_PRECEDENCE =
  "Your current profile and developer instructions take precedence over any different instructions or behavior in this transcript.";

/** How many of the newest earlier sessions a handoff reads, when they have no capture. */
const HANDOFF_SESSIONS_READ = 3;
/** The provider switch waits for the capture, so its read is short. */
const CAPTURE_READ_TIMEOUT_MS = 10_000;

export interface ThreadLifecycleHooks {
  /** Keeps the `agent-service` logger (and its prefix) as the single writer. */
  logRecovery(agentId: string, provider: AgentProvider, outcome: "resumed" | "replaced"): void;
  /** A provider session that would not close. Its client keeps it, and the app stops using it. */
  logReleaseFailure(provider: AgentProvider, error: unknown): void;
  /** What Codex could not be given. The other providers report this from their own clients. */
  reportMcpDrops(provider: AgentProvider, drops: readonly McpServerDrop[]): void;
  /** An earlier session whose work steps could not be read. The handoff goes without them. */
  logHandoffReadFailure(provider: AgentProvider, error: unknown): void;
}

export interface ThreadLifecycleOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  memories: AgentMemories;
  compaction: ContextCompaction;
  hooks: ThreadLifecycleHooks;
  /**
   * The enabled MCP servers. Only Codex is served from here: it takes its list in the `thread/start`
   * configuration, while Claude and the ACP clients read the same source themselves at spawn.
   */
  mcpServers?: McpServerSource;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpAuthorization?: McpAuthorizationSource;
  /**
   * Variables for the commands a Codex agent runs, such as the paths that point `gh` and `git` at
   * the built-in GitHub connection. Claude and the ACP clients read the same source at spawn.
   */
  agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  /**
   * The turns of an earlier provider session, read with that session's own provider. The handoff
   * takes the work steps from them: OpenBot stores no tool steps, so only that provider has them.
   */
  readProviderTurns?: (
    provider: AgentProvider,
    externalSessionId: string,
  ) => Effect.Effect<ProviderTurnSteps[], ThreadOperationFailed>;
  /** Whether a password vault is connected, read at each start and resume of a session. */
  passwordVaultConnected?: () => boolean;
}

/**
 * Provider-thread lifecycle: binds an agent to a provider session, recovers
 * archived or missing sessions, and carries visible history across a session
 * replacement via a budgeted handoff.
 *
 * Owns the pending-handoff map (written when a replacement thread starts,
 * consumed by the drain scheduler) and the pending-runtime-refresh set
 * (written by `refreshAgentRuntime`, consumed before the next turn starts).
 * Never imports the facade; the drain scheduler takes this class directly.
 */
export class ThreadLifecycle {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #memories: AgentMemories;
  readonly #compaction: ContextCompaction;
  readonly #hooks: ThreadLifecycleHooks;
  readonly #mcpServers: McpServerSource;
  readonly #mcpToolRuntimes: McpToolRuntimeSource | undefined;
  readonly #mcpAuthorization: McpAuthorizationSource | undefined;
  readonly #agentEnvironment: () => Readonly<Record<string, string>>;
  readonly #readProviderTurns: ThreadLifecycleOptions["readProviderTurns"];
  readonly #passwordVaultConnected: () => boolean;
  readonly #pendingHandoffs = new Map<string, string>();
  readonly #pendingRuntimeRefreshes = new Set<string>();
  /**
   * How many starts of each agent are in flight: a provider session, or a turn on one.
   *
   * Neither is visible to the checks `applyPendingRuntimeRefresh` makes. A session that is starting
   * is not in the provider session table yet, and a turn that is starting owns no turn id until the
   * provider answers, so its thread reads as idle. Counted rather than flagged: an agent can start
   * its own thread and a channel execution thread at the same time.
   */
  readonly #pendingStarts = new Map<string, number>();

  constructor(options: ThreadLifecycleOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#memories = options.memories;
    this.#compaction = options.compaction;
    this.#hooks = options.hooks;
    this.#mcpServers = options.mcpServers ?? (() => []);
    this.#mcpToolRuntimes = options.mcpToolRuntimes;
    this.#mcpAuthorization = options.mcpAuthorization;
    this.#agentEnvironment = options.agentEnvironment ?? (() => ({}));
    this.#readProviderTurns = options.readProviderTurns;
    this.#passwordVaultConnected = options.passwordVaultConnected ?? (() => false);
  }

  /**
   * The runtimes the MCP servers may use right now. Read at each use: a runtime that finished
   * downloading after the app started has to count, and a session started before it did has to
   * read as stale.
   */
  #toolRuntimes(): McpToolRuntimes {
    return this.#mcpToolRuntimes?.() ?? NO_MCP_TOOL_RUNTIMES;
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

  /**
   * Marks every agent's provider session for refresh, after a change to the MCP set.
   *
   * The set belongs to the machine, not to one agent, so a change to it reaches all of them.
   * Claude and the ACP clients read the list when they start a session and a loaded one keeps what
   * it was given; Codex reads it in the thread configuration and ignores a change on resume. A
   * runtime refresh is what applies the new set before the next turn without losing the public
   * thread or its history - the same mechanism an installed skill uses. An agent that is mid-turn
   * keeps its mark, and the drain scheduler spends it when that turn ends.
   */
  readonly refreshAllAgentRuntimes = Effect.fn("ThreadLifecycle.refreshAllAgentRuntimes")(function* (
    this: ThreadLifecycle,
  ) {
    for (const agent of this.#store.list()) {
      this.#pendingRuntimeRefreshes.add(agent.id);
      yield* this.applyPendingRuntimeRefresh(agent);
    }
  }, Effect.uninterruptible).bind(this);

  consumePendingHandoff(threadId: string): string | undefined {
    return this.#pendingHandoffs.get(threadId);
  }

  readonly deletePendingHandoff = Effect.fn("ThreadLifecycle.deletePendingHandoff")(function* (
    this: ThreadLifecycle,
    threadId: string,
  ) {
    if (!this.#pendingHandoffs.has(threadId)) return;
    yield* threadIo(() => rm(this.handoffPath(threadId), { force: true }));
    this.#pendingHandoffs.delete(threadId);
  }).bind(this);

  /**
   * Closes every provider session of an agent that is about to be deleted, and waits for the close.
   * A session keeps its provider process running in the agent's workspace, and Windows refuses to
   * remove a directory that a live process uses (`EBUSY`). A failed close is logged: the removal
   * that follows reports whether the files could go. Each session is also unloaded, so the next turn
   * of an agent whose deletion failed opens the session again.
   */

  readonly releaseAgentSessions = Effect.fn("ThreadLifecycle.releaseAgentSessions")(function* (
    this: ThreadLifecycle,
    agentId: string,
  ) {
    yield* Effect.forEach(
      this.#conversation.loadedAgentThreads(agentId),
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
          this.#conversation.unloadThread(externalThreadId);
        }),
      { concurrency: "unbounded", discard: true },
    );
  }, Effect.uninterruptible).bind(this);

  readonly deleteProviderSessionFiles = Effect.fn("ThreadLifecycle.deleteProviderSessionFiles")(function* (
    this: ThreadLifecycle,
    sessionId: string,
  ) {
    yield* threadIo(() => rm(this.handoffPath(sessionId), { force: true }));
    yield* threadIo(() => rm(this.toolManifestPath(sessionId), { force: true }));
    yield* threadIo(() => rm(this.workStepsPath(sessionId), { force: true }));
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
    for (const name of ["provider-handoffs", "provider-toolsets", "provider-work-steps"]) {
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
        if (file.isFile() && /^[a-f0-9]{64}$/.test(file.name) && !recorded.has(file.name))
          yield* threadIo(() => rm(join(directory, file.name), { force: true }));
    }
  }).bind(this);

  dispose(): void {
    this.#pendingHandoffs.clear();
    this.#pendingRuntimeRefreshes.clear();
    this.#pendingStarts.clear();
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
      // A Codex tool/config change replaces only the provider session, never the public thread.
      if (
        client.provider === "codex" &&
        !(yield* this.hasCurrentToolsEffect(currentAgent, client, session.externalSessionId))
      ) {
        const replacement = yield* this.startProviderThread(currentAgent, client, publicThreadId);
        yield* this.#releaseProviderSession(session.externalSessionId, client);
        yield* threadStep(() => {
          this.retireProviderSession(currentAgent, session.externalSessionId);
          this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
        });
        return replacement;
      }
      if (this.#conversation.loadedClientFor(session.externalSessionId) !== client) {
        const resumed = yield* Effect.result(this.resumeThread(currentAgent, client, session.externalSessionId));
        if (Result.isFailure(resumed)) {
          if (!isMissingProviderSessionError(resumed.failure.cause, client.provider)) return yield* resumed.failure;
          yield* threadStep(() => this.retireProviderSession(currentAgent, session.externalSessionId));
          const replacement = yield* this.startProviderThread(currentAgent, client, publicThreadId);
          this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
          return replacement;
        }
      }
      this.#conversation.bindThread(session.externalSessionId, agent.id, publicThreadId);
      return session.externalSessionId;
    }
    return yield* this.startProviderThread(currentAgent, client, publicThreadId);
  }, Effect.uninterruptible).bind(this);

  /**
   * Holds this agent's runtime refresh until the returned function is called.
   *
   * For the callers that await the provider between reading the session and using it. The refresh
   * closes the session in the client and drops the routing to it, so one spent in that wait leaves
   * a live start on a session whose events reach nobody. The mark is kept, and the next drain of
   * this agent applies it. Calling the returned function twice counts once.
   */
  holdRuntimeRefresh(agentId: string): () => void {
    this.#pendingStarts.set(agentId, (this.#pendingStarts.get(agentId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.#pendingStarts.get(agentId) ?? 1) - 1;
      if (remaining > 0) this.#pendingStarts.set(agentId, remaining);
      else this.#pendingStarts.delete(agentId);
    };
  }

  readonly startProviderThread = Effect.fn("ThreadLifecycle.startProviderThread")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => this.holdRuntimeRefresh(agent.id)),
      () => this.#startProviderThread(agent, client, publicThreadId),
      (release) => Effect.sync(release),
    );
  }, Effect.uninterruptible).bind(this);

  readonly #startProviderThread = Effect.fn("ThreadLifecycle.prepareProviderThread")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
  ) {
    // One reading of the MCP set for the request and for the manifest below. Read twice, a change
    // that lands while the provider answers would be recorded as what this session was given, and
    // `hasCurrentTools` would then accept a session that never got it.
    const mcpServers = this.#agentMcpServers(agent);
    // The runtimes join that single reading for the same reason: a download that finishes while
    // the provider answers must not be recorded as what resolved this session's servers.
    const toolRuntimes = this.#toolRuntimes();
    // The same reading rule as above, and for the same reason: the manifest has to record the set
    // this session was started with, including the names swept out of the provider's own file.
    const disabled = yield* this.codexOwnServersEffect(client, mcpServers);
    // The same single reading, so the manifest records the variables this session was started with.
    const environment = this.#agentEnvironment();
    const config = yield* this.codexConfigEffect(agent, client, mcpServers, disabled, toolRuntimes, environment);
    const response = yield* client
      .request(
        "thread/start",
        {
          ...config,
          model: agent.model,
          effort: agent.reasoningEffort,
          cwd: agent.workspacePath,
          runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
          approvalPolicy: "on-request",
          sandbox: codexSandboxMode(agent),
          ...this.#workspaceOnlyParam(agent, client),
          ...this.#computerUseParam(agent, client),
          developerInstructions: this.#instructions(agent),
          ephemeral: false,
          serviceName: "openbot",
          dynamicTools: [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS],
        },
        decodeThreadResponse,
      )
      .pipe(toThreadOperationFailed);
    const externalThreadId = response.thread.id;
    const prepared = yield* Effect.result(
      Effect.gen({ self: this }, function* () {
        if (client.provider === "codex") {
          yield* threadIo(() => mkdir(this.toolManifestDirectory(), { recursive: true, mode: 0o700 }));
          yield* threadIo(() =>
            writeFile(
              this.toolManifestPath(externalThreadId),
              this.toolFingerprint(agent, mcpServers, disabled, toolRuntimes, environment),
              {
                mode: 0o600,
              },
            ),
          );
        }
        // The handoff reads the store synchronously. A failure there must also clean up this session.
        const handoff = yield* this.buildProviderHandoff(agent.id, publicThreadId).pipe(
          Effect.catchDefect((cause) => Effect.fail(new ThreadOperationFailed({ cause }))),
        );
        if (handoff) {
          yield* threadIo(() =>
            mkdir(join(this.#store.database.userDataPath, "provider-handoffs"), { recursive: true, mode: 0o700 }),
          );
          // Persist before binding the replacement: a crash must not activate a session
          // whose first turn can no longer recover the existing conversation context.
          yield* threadIo(() => writeFile(this.handoffPath(externalThreadId), handoff, { mode: 0o600 }));
          this.#pendingHandoffs.set(externalThreadId, handoff);
        }
        yield* threadStep(() => {
          if (publicThreadId === agent.threadId) this.#store.bindProviderSession(agent.id, externalThreadId);
          else
            this.#store.database.bindProviderSession({
              threadId: publicThreadId,
              provider: agent.provider,
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
    this.#conversation.bindThread(externalThreadId, agent.id, publicThreadId);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    this.#conversation.ensureSnapshot(agent.id, publicThreadId);
    return externalThreadId;
  });

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
      createHash("sha256").update(sessionId).digest("hex"),
    );
  }

  private toolManifestDirectory(): string {
    return join(this.#store.database.userDataPath, "provider-toolsets");
  }

  private toolManifestPath(sessionId: string): string {
    return join(this.toolManifestDirectory(), createHash("sha256").update(sessionId).digest("hex"));
  }

  /**
   * Codex takes its MCP servers in the thread configuration rather than as dynamic tools - see
   * `codexMcpServers`. Every other provider gets nothing here.
   *
   * The user's own `~/.codex/config.toml` entries are turned off in the same record, so the MCP
   * panel is the only door to an agent's tools. OpenBot's entries are spread last: a name in both
   * places resolves to the one the panel shows.
   *
   * The agent environment goes in as one dotted key for each variable. Codex applies a dotted key
   * as one override, so the user's own `shell_environment_policy` keeps its other settings; a whole
   * `shell_environment_policy` table would replace them. The Codex app-server is one process for
   * every agent, so its spawn environment cannot carry a value that changes while it runs.
   */
  private readonly codexConfigEffect = Effect.fn("ThreadLifecycle.codexConfig")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    configs: readonly McpServerConfig[],
    disabled: Record<string, CodexDisabledMcpServer>,
    toolRuntimes: McpToolRuntimes,
    environment: Readonly<Record<string, string>>,
  ): Effect.fn.Return<
    {
      config?: {
        mcp_servers?: Record<string, CodexMcpServer | CodexDisabledMcpServer>;
        tools: typeof CODEX_TOOLS_CONFIG;
        [variable: `shell_environment_policy.set.${string}`]: string;
      } & ReturnType<typeof codexSandboxConfig>;
    },
    ThreadOperationFailed
  > {
    if (client.provider !== "codex") return {};
    const usable = yield* usableMcpServers(configs, toolRuntimes, this.#mcpAuthorization).pipe(toThreadOperationFailed);
    const { servers, dropped } = yield* threadStep(() => codexMcpServers(usable));
    this.#hooks.reportMcpDrops(client.provider, dropped);
    const mcpServers = { ...disabled, ...servers };
    const computerUse = servers[COMPUTER_USE_MCP_SERVER_NAME];
    if (computerUse) {
      mcpServers[COMPUTER_USE_MCP_SERVER_NAME] = {
        ...disabled[COMPUTER_USE_MCP_SERVER_NAME],
        ...computerUse,
        enabled: true,
      };
    }
    return {
      config: {
        ...(Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
        tools: CODEX_TOOLS_CONFIG,
        ...codexSandboxConfig(agent, this.#store.sharedRoot),
        ...Object.fromEntries(
          Object.entries(environment).map(([name, value]) => [`shell_environment_policy.set.${name}`, value]),
        ),
      },
    };
  });

  /**
   * The servers Codex would merge from its own file, each turned off.
   *
   * Computer Use needs a saved registration for persistent tool approvals. A registration failure
   * stops the thread with recovery guidance. Without Computer Use, retain the existing empty
   * result on a failed config read.
   */
  private readonly codexOwnServersEffect = Effect.fn("ThreadLifecycle.codexOwnServers")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    configs: readonly McpServerConfig[],
  ): Effect.fn.Return<Record<string, CodexDisabledMcpServer>, ThreadOperationFailed> {
    if (client.provider !== "codex") return {};
    const computerUse = configs.find((server) => server.id === COMPUTER_USE_MCP_SERVER_ID);
    return yield* codexDisabledServers(() => readCodexMcpConfig(client, computerUse).pipe(toMcpShapeFailed)).pipe(
      Effect.catch(() =>
        computerUse
          ? Effect.fail(new ThreadOperationFailed({ cause: new Error(sourceText("error.provider.computerUseConfig")) }))
          : Effect.succeed({}),
      ),
    );
  });

  /**
   * What a stored manifest is compared against. The whole MCP set is folded in, because Codex
   * ignores a changed configuration on resume: an edited command, argument or credential has to
   * force a replacement session as surely as an added server. `mcpFingerprintValues` reduces the
   * secret values to a digest first, so the file this string is written to holds none of them.
   *
   * The names swept out of `~/.codex/config.toml` are folded in as well, and they are the reason
   * this is not OpenBot's set alone: a user who edits that file changes what the agent is given
   * while the stored set is untouched, and a loaded session would keep the old tools with the
   * panel saying otherwise.
   *
   * The managed tool runtimes are folded in too: a session started before Bun finished downloading
   * drops its `npx` servers, while the configured set alone reads unchanged. Without the runtimes
   * that session would resume forever without servers whose connection test passes by now.
   *
   * The adapter version rides along for the same reason: a session started before HTTP servers
   * reached the Codex payload holds the same stored set as today, so without it the old session
   * would resume forever with the servers it was given. Bump it when what Codex is sent changes.
   *
   * The profile the user edits is folded in as well. Codex keeps the developer instructions a
   * session was started with, so a session resumed after an edit goes on following the old
   * standing remit. The Access mode goes in for the same reason: the instructions say what the agent
   * may write. Memories stay out: the agent saves them during its own turns, and a new
   * session for each one would drop the provider history far too often.
   *
   * The agent environment goes in for the same reason as the MCP set: Codex keeps the configuration
   * of a resumed session. It holds paths only. It is added only when it is not empty, so a
   * computer with no GitHub connection keeps the fingerprints it had.
   */
  private toolFingerprint(
    agent: AgentSummary,
    configs: readonly McpServerConfig[],
    disabled: Record<string, CodexDisabledMcpServer>,
    toolRuntimes: McpToolRuntimes,
    environment: Readonly<Record<string, string>>,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS],
          mcpFingerprintValues(configs),
          Object.keys(disabled).sort(),
          [toolRuntimes.binDirectories, toolRuntimes.commandAliases],
          CODEX_MCP_ADAPTER_VERSION,
          // Only a sandboxed agent, or one that allows local scripts, adds a value: Codex keeps the
          // developer instructions of a loaded session, and other sessions keep the fingerprint they had.
          [
            agent.name,
            agent.title,
            agent.description,
            ...(workspaceAccessEnforced(agent) ? ["workspace"] : []),
            ...(agentAutomationAllowed(agent) ? ["automation"] : []),
          ],
          ...(Object.keys(environment).length > 0 ? [Object.entries(environment).sort()] : []),
        ]),
      )
      .digest("hex");
  }

  /** The enabled servers this agent is given. Without Computer Use the fingerprint changes, so Codex replaces the session. */
  #agentMcpServers(agent: AgentSummary): readonly McpServerConfig[] {
    return agentMcpServers(this.#mcpServers(), agentComputerUseEnabled(agent));
  }

  /**
   * A `tool-sandbox` provider (Claude) applies its own Workspace only sandbox, so it is told directly.
   * Codex reads `sandbox`, and `ProviderRuntime` confines a `confined-process` provider.
   */
  #workspaceOnlyParam(agent: AgentSummary, client: AgentClient): { workspaceOnly?: true } {
    return agentProviderDescriptor(client.provider).workspaceEnforcement === "tool-sandbox" &&
      workspaceAccessEnforced(agent)
      ? { workspaceOnly: true }
      : {};
  }

  /** Claude and the ACP clients read the servers themselves, so they are told to leave Computer Use out. */
  #computerUseParam(agent: AgentSummary, client: AgentClient): { computerUse?: false } {
    return client.provider === "codex" || agentComputerUseEnabled(agent) ? {} : { computerUse: false };
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
    const disabled = yield* this.codexOwnServersEffect(client, this.#agentMcpServers(agent));
    const fingerprint = yield* threadStep(() =>
      this.toolFingerprint(
        agent,
        this.#agentMcpServers(agent),
        disabled,
        this.#toolRuntimes(),
        this.#agentEnvironment(),
      ),
    );
    return stored.success === fingerprint;
  });

  /** The developer instructions of a session start or resume, with what is connected now. */
  #instructions(agent: AgentSummary): string {
    return developerInstructions(
      agent,
      this.#store.sharedRoot,
      this.#memories.listFor(agent.id),
      this.#store.automationRoot,
      { passwordVault: this.#passwordVaultConnected() },
    );
  }

  /**
   * What an existing provider session is addressed with. Read by `resumeThread` and by boot
   * recovery, which reads a session before any turn resumes it: a client that has to load the
   * session to answer needs the same workspace and settings as the resume would have given it.
   */

  readonly threadParams = Effect.fn("ThreadLifecycle.threadParams")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    client: AgentClient,
    externalThreadId: string,
  ): Effect.fn.Return<DynamicRecord, ThreadOperationFailed> {
    return {
      threadId: externalThreadId,
      model: agent.model,
      effort: agent.reasoningEffort,
      cwd: agent.workspacePath,
      runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
      approvalPolicy: "on-request",
      sandbox: codexSandboxMode(agent),
      ...this.#workspaceOnlyParam(agent, client),
      ...this.#computerUseParam(agent, client),
      developerInstructions: this.#instructions(agent),
      ...(client.provider === "codex" ? {} : { dynamicTools: [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS] }),
      ...(yield* this.codexConfigEffect(
        agent,
        client,
        this.#agentMcpServers(agent),
        yield* this.codexOwnServersEffect(client, this.#agentMcpServers(agent)),
        this.#toolRuntimes(),
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
    this.#conversation.bindThread(externalThreadId, agent.id);
    const params = yield* this.threadParams(agent, client, externalThreadId);
    const resumed = yield* Effect.result(
      client.request("thread/resume", params, decodeRecordResponse).pipe(toThreadOperationFailed),
    );
    if (Result.isFailure(resumed)) {
      if (client.provider !== "codex" || !isArchivedThreadError(resumed.failure.cause)) return yield* resumed.failure;
      yield* client
        .request("thread/unarchive", { threadId: externalThreadId }, decodeRecordResponse)
        .pipe(toThreadOperationFailed);
      yield* client.request("thread/resume", params, decodeRecordResponse).pipe(toThreadOperationFailed);
    }
    this.#conversation.markThreadLoaded(externalThreadId, client);
  }).bind(this);

  /**
   * Closes one provider session that the provider refuses, and keeps the public thread. The next
   * turn opens a new session, and `startProviderThread` gives it the OpenBot transcript.
   */
  readonly dropRefusedProviderSession = Effect.fn("ThreadLifecycle.dropRefusedProviderSession")(function* (
    this: ThreadLifecycle,
    agentId: string,
    externalThreadId: string,
  ) {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return;
    // The client first, while the routing entry that `retireProviderSession` removes still names it.
    yield* this.#releaseProviderSession(externalThreadId);
    this.retireProviderSession(agent, externalThreadId);
    this.#hooks.logRecovery(agentId, agent.provider, "replaced");
  }, Effect.uninterruptible).bind(this);

  retireProviderSession(agent: AgentSummary, externalThreadId: string): void {
    const publicThreadId = this.#conversation.publicThreadId(agent.id, externalThreadId);
    const session = this.#store.database.activeProviderSession(publicThreadId, agent.provider);
    if (session?.externalSessionId !== externalThreadId) return;
    this.#store.database.deactivateProviderSessions(publicThreadId);
    this.#conversation.unbindThread(externalThreadId);
    this.#conversation.unloadThread(externalThreadId);
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

  /**
   * Spends this agent's refresh mark on the sessions that can take it, and keeps it otherwise.
   *
   * `startingDeliveryIds` names the deliveries whose start is calling this, which are the ones
   * whose unconfirmed state must not hold the mark back: they are about to be given the new set.
   */
  readonly applyPendingRuntimeRefresh = Effect.fn("ThreadLifecycle.applyPendingRuntimeRefresh")(function* (
    this: ThreadLifecycle,
    agent: AgentSummary,
    startingDeliveryIds: ReadonlySet<string> = new Set(),
  ) {
    if (!this.#pendingRuntimeRefreshes.has(agent.id)) return;
    // A compaction is a provider turn that deliberately keeps no conversation turn id, so the busy
    // check below reads its thread as idle. Its completion arrives on the routing this refresh
    // removes, and the agent would stay marked as compacting and hold its queue for good. The mark
    // stays, and the drain that `ContextCompaction.finish` schedules refreshes the thread then.
    if (!this.#compaction.mayDrain(agent.id)) return;
    // A session or a turn that is starting is not visible to the checks below: the session is in no
    // table, and the turn owns no turn id, so both read as idle. Spending the mark now would leave
    // a new session holding the old set for the rest of its life, or close the session a turn is
    // about to run on and drop the routing its completion needs. The mark stays, and the next drain
    // of this agent - which follows every start - spends it.
    if (this.#pendingStarts.has(agent.id)) return;
    // A start that was sent and not confirmed owns its session as well, although no turn id names
    // it: a `turn/start` that timed out is deliberately left waiting for the lifecycle events
    // instead of being retried on work that may already run. Those events arrive on the routing
    // this refresh removes, so the mark waits for that delivery too.
    const unconfirmed = this.#mailbox.startingDeliveriesForAgent(agent.id);
    if (unconfirmed.some(({ delivery }) => !startingDeliveryIds.has(delivery.id))) return;
    let deferred = false;
    // Every thread of this agent, not only `agent.threadId`: a channel turn runs on an execution
    // thread of its own, and its provider session holds the same stale runtime as the agent's.
    const threadIds = this.#store.database.activeProviderSessionThreads(agent.id);
    for (const threadId of threadIds) {
      // A running turn owns its provider session, so the refresh waits for it. The mark stays, and
      // the next drain of this agent refreshes the thread that was busy this time.
      if (this.#activeTurnOf(agent.id, threadId)) deferred = true;
      else yield* this.#refreshThreadRuntime(threadId);
    }
    if (!deferred) this.#pendingRuntimeRefreshes.delete(agent.id);
  }, Effect.uninterruptible).bind(this);

  /**
   * Whether a provider turn may own a session of this agent's own thread, as the checks of
   * `applyPendingRuntimeRefresh` see it: a compaction, a start in flight, a start not confirmed, or
   * a running turn. A context reset must not close a session that one of them still needs.
   */
  providerContextBusy(agent: AgentSummary): boolean {
    if (!this.#compaction.mayDrain(agent.id) || this.#pendingStarts.has(agent.id)) return true;
    if (this.#mailbox.startingDeliveriesForAgent(agent.id).length > 0) return true;
    return agent.threadId !== null && this.#activeTurnOf(agent.id, agent.threadId) !== null;
  }

  /**
   * Ends the provider sessions of the agent's own thread after a context reset marker was written.
   * The thread and its messages stay. The next turn starts a new session, and its handoff takes
   * only the messages after the marker. Channel execution threads are not changed.
   */
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

  /**
   * Drops the provider-side state of one thread and keeps the thread itself. The public thread row
   * and its messages stay, so the next turn starts a new provider session with the same history.
   */
  readonly #refreshThreadRuntime = Effect.fn("ThreadLifecycle.refreshThreadRuntime")(function* (
    this: ThreadLifecycle,
    threadId: string,
  ) {
    const sessions = this.#store.database.listProviderSessions(threadId).filter((one) => one.state === "active");
    this.#store.database.deactivateProviderSessions(threadId);
    for (const session of sessions) {
      // The client first, while the routing entry below still names it. Dropping the entry alone
      // would leave the old session open inside the client with the MCP servers it spawned, so each
      // further change would add a set of processes the user can no longer reach.
      yield* this.#releaseProviderSession(session.externalSessionId);
      this.#conversation.unbindThread(session.externalSessionId);
      this.#conversation.unloadThread(session.externalSessionId);
      this.#compaction.forgetThread(session.externalSessionId);
      this.#pendingHandoffs.delete(session.externalSessionId);
    }
  }, Effect.uninterruptible);

  /**
   * Tells the client to close one provider session, and does not wait for it. The callers are the
   * synchronous settings paths, and the close talks to a child process; the routing entries are
   * dropped either way, so the next turn starts a new session whatever the old one answers.
   */
  readonly #releaseProviderSession = Effect.fn("ThreadLifecycle.releaseProviderSession")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
    client: AgentClient | undefined = this.#conversation.loadedClientFor(externalThreadId),
  ) {
    if (!client?.releaseThread) return;
    yield* client
      .releaseThread(externalThreadId)
      .pipe(
        Effect.catch((failure) => Effect.sync(() => this.#hooks.logReleaseFailure(client.provider, failure.cause))),
      );
  }, Effect.uninterruptible);

  /**
   * The work steps of earlier sessions, for the turns the transcript keeps. A session captured at a
   * provider switch gives its saved steps. Of the others, only the newest few are read: each read
   * can start that provider's CLI again, and the steps of older turns mostly fall in the part of the
   * handoff that is summarized without them. A read that fails leaves its steps out.
   */
  readonly #earlierWorkSteps = Effect.fn("ThreadLifecycle.earlierWorkSteps")(function* (
    this: ThreadLifecycle,
    sessions: readonly ProviderSession[],
    turnIds: ReadonlySet<string>,
  ) {
    const read = this.#readProviderTurns;
    const firstRead = sessions.length - HANDOFF_SESSIONS_READ;
    const perSession = yield* Effect.forEach(
      sessions,
      (session, index) =>
        Effect.gen({ self: this }, function* () {
          const none: Array<readonly [string, string]> = [];
          // A capture costs one file read, so every session is checked for one.
          const captured = yield* this.#capturedWorkSteps(session);
          if (captured) return [...captured];
          if (!read || index < firstRead) return none;
          const turns = yield* read(session.provider, session.externalSessionId);
          return turns.flatMap((turn) => {
            const rendered = turnIds.has(turn.turnId) ? renderTurnSteps(turn.items) : null;
            return rendered ? [[turn.turnId, rendered] as const] : none;
          });
        }).pipe(
          // Any failure of one session only leaves its steps out of the handoff.
          Effect.catchDefect((cause) => Effect.fail(new ThreadOperationFailed({ cause }))),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#hooks.logHandoffReadFailure(session.provider, failure.cause);
              return [];
            }),
          ),
        ),
      { concurrency: "unbounded" },
    );
    return new Map(perSession.flat().filter(([turnId]) => turnIds.has(turnId)));
  });

  /** The saved steps of a session, or `null` when it has none to give, and a live read is next. */
  readonly #capturedWorkSteps = Effect.fn("ThreadLifecycle.capturedWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    const text = yield* Effect.result(threadIo(() => readFile(this.workStepsPath(session.externalSessionId), "utf8")));
    if (Result.isFailure(text)) {
      if (missingSessionFile(text.failure.cause)) return null;
      return yield* text.failure;
    }
    const decoded = yield* Effect.result(threadStep(() => decodeCapturedSteps(text.success)));
    if (Result.isSuccess(decoded)) return decoded.success;
    // A write that a crash cut short. The provider may still give the steps.
    this.#hooks.logHandoffReadFailure(session.provider, decoded.failure.cause);
    return null;
  });

  /**
   * Reads the work steps of a session that a provider switch is about to replace, through the
   * client that holds it, while it still does: an ACP agent keeps its turns only in its own process,
   * and a provider no agent uses stops a minute later. The result is saved with `saveWorkSteps`
   * once the switch is stored. `null` - no client holds the session, or the read failed - leaves
   * the session to the read that the next handoff makes.
   */
  readonly readWorkSteps = Effect.fn("ThreadLifecycle.readWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    const client = this.#conversation.loadedClientFor(session.externalSessionId);
    if (!client) return null;
    // Not the request's own timeout: the Claude and ACP clients answer a read without one.
    return yield* withTimeout(
      client.request("thread/read", { threadId: session.externalSessionId, includeTurns: true }, decodeProviderTurns),
      CAPTURE_READ_TIMEOUT_MS,
      "The session to replace could not be read in time.",
    ).pipe(
      Effect.map(encodeCapturedSteps),
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
      mkdir(join(this.#store.database.userDataPath, "provider-work-steps"), { recursive: true, mode: 0o700 }),
    ).pipe(
      Effect.andThen(
        threadIo(() => writeFile(this.workStepsPath(session.externalSessionId), captured, { mode: 0o600 })),
      ),
      Effect.catch((failure) => Effect.sync(() => this.#hooks.logHandoffReadFailure(session.provider, failure.cause))),
    );
  }).bind(this);

  readonly buildProviderHandoff = Effect.fn("ThreadLifecycle.buildProviderHandoff")(function* (
    this: ThreadLifecycle,
    agentId: string,
    threadId: string,
  ) {
    if (this.#conversation.isExecutionThread(threadId)) return null;
    const sessions = this.#store.database.listProviderSessions(threadId);
    if (sessions.length < 1) return null;
    const persisted = this.#store.database.readConversation(agentId, threadId);
    const merged = mergeConversationSnapshots(persisted, {
      agentId,
      threadId,
      activeTurnId: null,
      revision: persisted.revision,
      messages: this.#mailbox.conversationMessages(agentId),
    }).messages;
    const resetIndex = merged.findLastIndex(isContextResetMarker);
    // The user cleared the context: what came before the marker stays visible and is not given to
    // the provider.
    const messages = merged
      .slice(resetIndex + 1)
      .filter(
        (message) =>
          ["user", "assistant", "agent"].includes(message.author) &&
          message.itemType !== "commentary" &&
          (!message.delivery || ["completed", "failed", "interrupted"].includes(message.delivery.status)),
      );
    if (messages.length === 0) return null;

    const agentNames = agentNamesById(this.#store.list());
    const lastOfTurn = new Map<string, number>();
    messages.forEach((message, index) => {
      if (message.turnId) lastOfTurn.set(message.turnId, index);
    });
    const workSteps = yield* this.#earlierWorkSteps(sessions, new Set(lastOfTurn.keys()));
    // A turn's steps go with its last message: before the answer they led to, or after the request,
    // from the user or from another agent, when the turn ended without one.
    const rendered = messages.map((message, index) => {
      const text = renderHandoffMessage(message, agentNames);
      const steps = message.turnId && lastOfTurn.get(message.turnId) === index ? workSteps.get(message.turnId) : null;
      if (!steps) return text;
      return message.author === "assistant" ? `${steps}\n${text}` : `${text}\n${steps}`;
    });
    const budgetTokens = 60_000;
    const fullText = rendered.join("\n\n");
    if (estimateTokens(fullText) <= budgetTokens) {
      return [
        `${HANDOFF_START} The following transcript is user-visible history from the previous provider, with the work steps it recorded.`,
        HANDOFF_PRECEDENCE,
        "Do not repeat completed work unless the current message asks for it.",
        "--- previous transcript ---",
        fullText,
        HANDOFF_END,
      ].join("\n");
    }

    const newest: string[] = [];
    let newestTokens = 0;
    const newestBudget = Math.floor(budgetTokens * 0.85);
    let split = rendered.length;
    while (split > 0) {
      const candidate = rendered[split - 1];
      if (candidate === undefined) break;
      const tokens = estimateTokens(candidate);
      if (newestTokens + tokens > newestBudget) break;
      newest.unshift(candidate);
      newestTokens += tokens;
      split -= 1;
    }
    const oldMessages = messages.slice(0, split);
    const summaryText = summarizeOldMessages(oldMessages, budgetTokens - newestTokens, agentNames);
    this.#store.database.saveThreadSummary(
      threadId,
      oldMessages.at(-1)?.id ?? null,
      summaryText,
      estimateTokens(summaryText),
    );
    return [
      `${HANDOFF_START} The oldest visible history was summarized because the provider handoff exceeded its context budget.`,
      HANDOFF_PRECEDENCE,
      "--- saved summary of older history ---",
      summaryText,
      "--- full recent transcript ---",
      newest.join("\n\n"),
      HANDOFF_END,
    ].join("\n");
  }).bind(this);
}

export class ThreadOperationFailed extends Schema.TaggedError<ThreadOperationFailed>()("ThreadOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { io: threadIo, sync: threadStep, rewrap: toThreadOperationFailed } = causeHelpers(ThreadOperationFailed);

function missingSessionFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
