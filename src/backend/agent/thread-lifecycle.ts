import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSummary,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  agentProviderDescriptor,
  agentQuickAcknowledgementEnabled,
  COMPUTER_USE_MCP_SERVER_ID,
  DEFAULT_RESPONSE_STYLE,
  type McpServerConfig,
  type ResponseStyle,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Result, Schema, Semaphore } from "effect";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ProviderSession } from "../database/provider-sessions";
import { causeHelpers } from "../effect-boundary";
import { type HomeSkill, listHomeSkills, skillFolderNames } from "../home-skills";
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
  toMcpShapeFailed,
  usableMcpServers,
} from "../mcp-provider-shapes";
import { decodeRecordResponse, decodeThreadResponse, getString, type ResponseDecoder } from "../protocol";
import { TimeoutError, withTimeout } from "../with-timeout";
import type { AgentMemories } from "./agent-memories";
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
  readHandoffHistory,
  renderProviderHandoff,
  renderRoutineHandoff,
  unsentHandoff,
} from "./handoff-history";
import { decodeCapturedSteps, readCapturedSteps } from "./handoff-tool-steps";
import { isProviderTimeout } from "./provider-status";
import { sessionSettingsIdentity } from "./session-settings";
import { isArchivedThreadError, isMissingProviderSessionError, providerLabel } from "./thread-items";
import { visibleDynamicTools } from "./tool-catalog";
import {
  AGENT_INSTRUCTIONS_FILE_BYTES,
  type PromptInstructionsFile,
  promptInstructionsFile,
} from "./workspace-instructions";
import {
  checkAgentFolders,
  codexSandboxConfig,
  codexSandboxMode,
  existingAgentFolders,
  workspaceExcludedFolders,
  workspaceWritableRoots,
} from "./workspace-sandbox";

const logger = createOpenBotLogger("thread-lifecycle");

/**
 * What the Codex adapter sends, versioned. Codex ignores MCP configuration on resume, so a
 * session started by an older adapter keeps the servers it was given even when the stored set
 * is unchanged. Folding this into the tool fingerprint refreshes those sessions once through
 * the replacement flow. Bump it when what Codex is sent changes; 2 is HTTP servers joining
 * the payload, 3 is the sweep that turns off the servers `~/.codex/config.toml` declares, and 4 is
 * the managed tool runtimes joining the fingerprint, so a session started before Bun finished
 * downloading is replaced once its servers can actually start, 5 is the plan tool below, and 6 is
 * server names in the form Codex accepts. Version 7 keeps approvals for custom MCP servers. Version 8
 * is the MCP namespaces in `features.code_mode.direct_only_tool_namespaces`: Codex 0.164 does not
 * add them on resume to a thread started without them, so a code-mode-only model saw no MCP tools.
 * Since #4468 only Computer Use stays in that list. No new version: a session started before keeps
 * its MCP namespaces direct on resume and keeps working, and a new version would replace each Codex
 * session with a handoff. Such a session defers the tools from its next new session.
 * Version 9 adds `image_gen` to those namespaces. Version 10 gives a stdio server its working
 * directory as `cwd`; before, Codex did not get such a server.
 */
const CODEX_MCP_ADAPTER_VERSION = 10;

/** What a provider other than Codex, or a Codex with no file to read, has in its own files. */
const NO_CODEX_OWN_SERVERS: CodexOwnServers = { disabled: {}, transports: {}, read: null };

/**
 * Providers whose client starts its process again with the MCP servers and skills of that moment
 * when it resumes a session: `ClaudeAgentClient.#startThread` reads them at each start. A runtime
 * refresh keeps their sessions, with the provider history and its prompt cache. Decided by provider,
 * not by a running client: an idle client stops, and a session with no process resumes the same way.
 */
const RUNTIME_RELOADED_ON_RESUME: ReadonlySet<AgentProvider> = new Set(["claude"]);

/** Per server key, the `tools` table Codex saved for it: each tool's approval. */
type CodexToolApprovals = Array<[string, DynamicRecord]>;

/** The instruction file that the developer instructions name, and its text when they carry it. */
interface InstructionsFileInPrompt {
  fileName: PromptInstructionsFile["fileName"];
  /** The file, when there is one. */
  found: PromptInstructionsFile | null;
  /** The file that the instructions carry: the CLI does not read it by itself. */
  file: PromptInstructionsFile | null;
}

/**
 * Codex offers `update_plan` only when this is on, and without it a turn sends no
 * `turn/plan/updated`, so the conversation shows no task list.
 */
const CODEX_TOOLS_CONFIG = { update_plan: { enabled: true } } as const;

/**
 * Codex declares `create_goal`, `get_goal` and `update_goal` in each request, about 3.5k characters.
 * A goal continues the turn by itself until the agent marks it done, and only the user can pause or
 * resume it. OpenBot has no control for a goal, so it turns the feature off.
 */
export const CODEX_FEATURES_CONFIG = { "features.goals": false } as const;

/**
 * Codex gives each MCP server that is not `required` 1 second to start before a turn's first step,
 * then leaves it out of that step with only a trace log (#4410). A cold `npx` server takes longer,
 * mostly on Windows. A server that starts in time adds no wait.
 */
const CODEX_MCP_STARTUP_GRACE_MS = 10_000;

/**
 * In code mode the model calls tools from an `exec` cell, and `exec` gives control back to the model
 * after its yield time while `ask_user` still waits. A model that then ends its turn expires the
 * question within seconds. Direct calls keep the turn waiting for the answer. It goes in as one
 * dotted key, as the agent environment does, so it does not turn code mode on or off. A thread adds
 * Computer Use, see `codexDirectMcpNamespaces`; Codex defers the other MCP servers. `image_gen` is
 * direct because from `exec` a model often reads `result.content` instead of `generatedImage(result)`:
 * it then sees no image and tells the user that the image failed, although the chat shows it.
 */
const CODEX_DIRECT_ONLY_NAMESPACES = [...visibleDynamicTools("codex").map((namespace) => namespace.name), "image_gen"];

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
  mcpEndpoint?: McpEndpointSource;
  /** What the tool manifest records about the OAuth proxy for a set. See `McpGateway.proxyFingerprint`. */
  mcpProxyFingerprint?: (configs: readonly McpServerConfig[]) => Effect.Effect<string | null, McpOperationError>;
  /**
   * Variables for the commands a Codex agent runs, such as the paths that point `gh` and `git` at
   * the built-in GitHub connection. Claude and the ACP clients read the same source at spawn.
   */
  agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  /** Whether a password vault is connected, read at each start and resume of a session. */
  passwordVaultConnected?: () => boolean;
  /** What the Vault holds, read at each start and resume of a session. */
  vaultItems?: () => VaultContents;
  /** OpenBot runs on a server. The prompt then names the sign-in on the user's computer. */
  serverHost?: boolean;
  /** How the agents talk while they work, read at each start and resume of a session. */
  responseStyle?: () => ResponseStyle;
  /** The other agents in an agent's sidebar section, read at each start and resume of a session. */
  sectionTeammates?: (agentId: string) => SectionTeammates | null;
  /** Whether a public thread is a channel member's thread. */
  channelThread?: (threadId: string) => boolean;
  /** Whether a side thread is a branch: a copy of another conversation, which its first session must receive. */
  branchThread?: (threadId: string) => boolean;
  /** Whether a side thread takes the runs of a routine. */
  routineThread?: (threadId: string) => boolean;
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
  readonly #agentEnvironment: () => Readonly<Record<string, string>>;
  readonly #passwordVaultConnected: () => boolean;
  readonly #vaultItems: () => VaultContents;
  readonly #serverHost: boolean;
  readonly #responseStyle: () => ResponseStyle;
  readonly #sectionTeammates: (agentId: string) => SectionTeammates | null;
  readonly #channelThread: (threadId: string) => boolean;
  readonly #branchThread: (threadId: string) => boolean;
  readonly #routineThread: (threadId: string) => boolean;
  readonly #pendingHandoffs = new Map<string, string>();
  /**
   * The section-mates and the saved-logins state that each loaded session got at its start or resume,
   * for a client with `turnContext`. A change does not change the tool fingerprint, so the next turn
   * resumes the session to give the new state to the turn context, as a memory change does.
   */
  readonly #givenTurnContext = new Map<string, string>();
  /**
   * Routine digests and the cleanup after a turn change a handoff one at a time. A routine thread
   * runs beside the chat, so its digest can arrive while a chat turn starts with the handoff.
   */
  readonly #handoffWrites = Semaphore.makeUnsafe(1);
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
  /** The starts of `#pendingStarts` that are not in a side thread: they hold the agent's own chat. */
  readonly #pendingMainStarts = new Map<string, number>();
  /**
   * The idle releases whose `thread/unsubscribe` is in flight. A resume of the same session waits
   * for it: a resume that went first would be undone by the unsubscribe after it.
   */
  readonly #idleReleases = new Map<string, Deferred.Deferred<void>>();

  constructor(options: ThreadLifecycleOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#memories = options.memories;
    this.#compaction = options.compaction;
    this.#hooks = options.hooks;
    this.#mcpServers = options.mcpServers ?? (() => []);
    this.#mcpToolRuntimes = options.mcpToolRuntimes;
    this.#mcpEndpoint = options.mcpEndpoint;
    this.#mcpProxyFingerprint = options.mcpProxyFingerprint ?? (() => Effect.succeed(null));
    this.#agentEnvironment = options.agentEnvironment ?? (() => ({}));
    this.#passwordVaultConnected = options.passwordVaultConnected ?? (() => false);
    this.#vaultItems = options.vaultItems ?? (() => ({ available: false, cards: false, contacts: false }));
    this.#serverHost = options.serverHost ?? false;
    this.#responseStyle = options.responseStyle ?? (() => DEFAULT_RESPONSE_STYLE);
    this.#sectionTeammates = options.sectionTeammates ?? (() => null);
    this.#channelThread = options.channelThread ?? (() => false);
    this.#branchThread = options.branchThread ?? (() => false);
    this.#routineThread = options.routineThread ?? (() => false);
  }

  /**
   * The runtimes the MCP servers may use right now. Read at each use: a runtime that finished
   * downloading after the app started has to count, and a session started before it did has to
   * read as stale.
   */
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

  /**
   * Removes the part of the handoff that a started turn sent (`sent`). A digest that arrived after
   * the turn read the handoff stays for the next turn.
   */
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

  /**
   * Closes every provider session of an agent that is about to be deleted, and waits for the close.
   * A session keeps its provider process running in the agent's workspace, and Windows refuses to
   * remove a directory that a live process uses (`EBUSY`). A failed close is logged: the removal
   * that follows reports whether the files could go. Each session is also unloaded, so the next turn
   * of an agent whose deletion failed opens the session again.
   *
   * `recorded` are the agent's stored sessions with the client that can hold each one. They are
   * closed too, because the conversation does not list every session that a client holds.
   */

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
          this.#conversation.unloadThread(externalThreadId);
        }),
      { concurrency: "unbounded", discard: true },
    );
  }, Effect.uninterruptible).bind(this);

  /**
   * Closes the provider session of a thread that is about to be deleted, and waits for the close, so
   * its process and MCP servers do not stay alive. A failure is logged: the delete goes on.
   */
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
    // Unattributed legacy captures stay until no recorded session uses the external identifier.
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
    this.#pendingRuntimeRefreshes.clear();
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
      // A Codex tool/config change replaces only the provider session, never the public thread.
      if (
        client.provider === "codex" &&
        !(yield* this.hasCurrentToolsEffect(
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
      if (
        this.#conversation.loadedClientFor(session.externalSessionId) !== client ||
        this.#turnContextChanged(currentAgent, client, session.externalSessionId)
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

  /**
   * Holds this agent's runtime refresh until the returned function is called.
   *
   * For the callers that await the provider between reading the session and using it. The refresh
   * closes the session in the client and drops the routing to it, so one spent in that wait leaves
   * a live start on a session whose events reach nobody. The mark is kept, and the next drain of
   * this agent applies it. Calling the returned function twice counts once. A start in a side thread
   * does not hold a context change of the agent's own chat.
   */
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

  /**
   * Unloads an idle session from its client, to free the processes and MCP servers that the client
   * holds for it, and keeps the session: its next turn resumes it in `ensureThread`. The result is
   * `held` when something still needs the session, and `gone` when this client does not hold a
   * session that can resume.
   *
   * `held` adds the checks that the caller owns, such as a pending approval. The routing is dropped
   * in the same step as the last check, before the release yields, so a start after it sees an
   * unloaded session and resumes it when the release is done.
   */
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
    // A failed check keeps the session: the release could end a terminal that the check did not see.
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
    // A routine session is ephemeral: no rollout is kept to resume it from.
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

  /**
   * Starts the provider session of one routine run. It is not saved as a session of a thread, and
   * `closeRoutineThread` ends it with the run: so no session grows with each run, and a run does not
   * read a whole session again. Its items go to `routineThreadId`, the routine's own side thread, or
   * with no such thread to the agent's chat. Its first turn reads the newest messages of the chat
   * and of the routine's thread.
   */
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
      .request("thread/start", { ...params, ephemeral: true, persistSession: false }, decodeThreadResponse)
      .pipe(toThreadOperationFailed);
    const externalThreadId = response.thread.id;
    this.#conversation.bindThread(externalThreadId, owner.id, publicThreadId);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    this.#conversation.registerRoutineSession(owner.id, externalThreadId);
    // Only in memory: the session ends with the run, and a restart ends the run.
    if (handoff) this.#pendingHandoffs.set(externalThreadId, handoff);
    return externalThreadId;
  }, Effect.uninterruptible).bind(this);

  /** Ends the provider session of a routine run. A second call does nothing. */
  readonly closeRoutineThread = Effect.fn("ThreadLifecycle.closeRoutineThread")(function* (
    this: ThreadLifecycle,
    externalThreadId: string,
  ) {
    if (!this.#conversation.isRoutineSession(externalThreadId)) return;
    this.#conversation.forgetRoutineSession(externalThreadId);
    yield* this.#releaseProviderSession(externalThreadId);
    this.#conversation.unbindThread(externalThreadId);
    this.#conversation.unloadThread(externalThreadId);
    this.#givenTurnContext.delete(externalThreadId);
    this.#compaction.forgetThread(externalThreadId);
    this.#pendingHandoffs.delete(externalThreadId);
  }, Effect.uninterruptible).bind(this);

  /**
   * Gives the answer of a routine run to the agent's own session and, for a routine with its own
   * thread, to that thread's session. Each reads it with its next turn. A thread with no active
   * session needs nothing: its next session reads the history.
   */
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

  /**
   * What a new provider session of this agent starts with. Each value is read once, so the request
   * and the tool manifest that records it see the same set.
   */
  readonly #startParams = Effect.fn("ThreadLifecycle.startParams")(function* (
    this: ThreadLifecycle,
    owner: AgentSummary,
    client: AgentClient,
    publicThreadId: string,
  ) {
    const agent = this.#sessionAgent(owner, publicThreadId);
    yield* checkAgentFolders(agent);
    // One reading of the MCP set for the request and for the manifest below. Read twice, a change
    // that lands while the provider answers would be recorded as what this session was given, and
    // `hasCurrentTools` would then accept a session that never got it.
    const mcpServers = this.#agentMcpServers(agent);
    // The runtimes join that single reading for the same reason: a download that finishes while
    // the provider answers must not be recorded as what resolved this session's servers.
    const toolRuntimes = this.#toolRuntimes();
    // The same reading rule as above, and for the same reason: the manifest has to record the set
    // this session was started with, including the names swept out of the provider's own file.
    const own = yield* this.codexOwnServersEffect(client, mcpServers, toolRuntimes);
    // The same single reading, so the manifest records the variables this session was started with.
    const environment = this.#agentEnvironment();
    const section = this.#sectionTeammates(agent.id);
    // Read before the configuration, which starts the same listener: both see one port.
    const proxy = client.provider === "codex" ? yield* this.#proxyFingerprint(mcpServers) : null;
    // The same single reading, so the manifest records the file text these instructions carry.
    const instructionsFile = yield* this.#instructionsFile(agent, client);
    const config = yield* this.codexConfigEffect(agent, client, mcpServers, own, toolRuntimes, environment);
    const params: DynamicRecord = {
      ...config,
      model: agent.model,
      effort: agent.reasoningEffort,
      cwd: agent.workspacePath,
      runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
      approvalPolicy: "on-request",
      sandbox: codexSandboxMode(agent),
      ...this.#workspaceOnlyParam(agent, client),
      ...this.#computerUseParam(agent, client),
      ...this.#mcpAgentParam(agent, client),
      ...this.#instructions(
        agent,
        client,
        section,
        this.#computerUseInOwnChat(owner, publicThreadId),
        yield* this.#homeSkills(agent, client),
        this.#runsBesideOwnChat(owner, publicThreadId),
        mcpServers,
        instructionsFile,
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
    // Read before the params: a change that lands after it then resumes the session at the next turn.
    const givenContext = this.#turnContextKey(owner);
    const { agent, mcpServers, toolRuntimes, own, environment, proxy, instructionsFile, params } =
      yield* this.#startParams(owner, client, publicThreadId);
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
    // The session of this provider that the new one replaces. A missing session has nothing to archive.
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
          // The provider that made the ID, not the agent's: the agent can change provider while
          // `thread/start` runs, and that ID must never reach the new provider (#2475).
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
    if (replaced) yield* this.#archiveReplacedSession(client, replaced.externalSessionId);
    return externalThreadId;
  });

  /**
   * Hides the session that a new one replaced from the provider's own thread list, after the new
   * session is bound. Each replacement starts a new provider thread with the handoff as its first
   * message, so without this the user's Codex history fills with rows that start with
   * `HANDOFF_START`. The history stays readable for the import. A failure is logged, and the new
   * session goes on: the old thread then only stays in the list.
   */
  readonly #archiveReplacedSession = Effect.fn("ThreadLifecycle.archiveReplacedSession")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    externalThreadId: string,
  ) {
    if (!client.archiveThread) return;
    yield* client
      .archiveThread(externalThreadId)
      .pipe(
        Effect.catch((failure) => Effect.sync(() => this.#hooks.logReleaseFailure(client.provider, failure.cause))),
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

  /** Captures saved before v2, keyed by the external identifier that two providers can share. */
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
    own: CodexOwnServers,
    toolRuntimes: McpToolRuntimes,
    environment: Readonly<Record<string, string>>,
  ): Effect.fn.Return<
    {
      config?: {
        mcp_servers?: Record<string, CodexMcpServer | CodexDisabledMcpServer>;
        tools: typeof CODEX_TOOLS_CONFIG;
        project_doc_max_bytes: number;
        mcp_optional_startup_grace_ms: number;
        "features.goals": false;
        "features.code_mode.direct_only_tool_namespaces": string[];
        [variable: `shell_environment_policy.set.${string}`]: string;
      } & CodexPromptSettings &
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
        ...CODEX_FEATURES_CONFIG,
        ...codexPromptSettings(own.read),
        // Codex reads 32 KiB of `AGENTS.md` by default. A file that the editor saves in a non-Latin
        // script can be longer, and Codex would drop its end.
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

  /**
   * The servers Codex would merge from its own file, each turned off.
   *
   * Each MCP server needs a saved registration for persistent tool approvals. A registration failure
   * stops the thread with recovery guidance. Without MCP servers, retain the existing empty
   * result on a failed config read. An app server that timed out or is gone gets the timeout
   * message: the guidance about `config.toml` would send the user to a file that is fine. The client
   * ends a process that stopped answering, and the runtime starts it again.
   */
  private readonly codexOwnServersEffect = Effect.fn("ThreadLifecycle.codexOwnServers")(function* (
    this: ThreadLifecycle,
    client: AgentClient,
    configs: readonly McpServerConfig[],
    toolRuntimes: McpToolRuntimes,
  ): Effect.fn.Return<CodexOwnServers, ThreadOperationFailed> {
    if (client.provider !== "codex") return NO_CODEX_OWN_SERVERS;
    // Register only the servers selected by the runtime adapter, including name collisions.
    const usable = yield* usableMcpServers(configs, toolRuntimes).pipe(toThreadOperationFailed);
    const servers = (own: CodexOwnTransports) => codexMcpServers(usable, own).servers;
    return yield* codexDisabledServers(() => readCodexMcpConfig(client, servers).pipe(toMcpShapeFailed)).pipe(
      Effect.catch((failure) => {
        if (Object.keys(servers({})).length === 0) return Effect.succeed(NO_CODEX_OWN_SERVERS);
        if (isProviderTimeout(failure.cause) || !client.running) {
          return Effect.fail(
            new ThreadOperationFailed({
              cause: new Error(sourceText("error.provider.cliTimedOut", { provider: providerLabel(client.provider) })),
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
   *
   * The section-mates and the memories stay out: they go with the turns (`turnContext`), so a change
   * keeps the session. `legacySection` gives the fingerprint of a session from before that change,
   * which had the sorted ids of its section-mates: `hasCurrentToolsEffect` accepts it once.
   *
   * The OAuth proxy goes in for the same reason as the MCP set: a session keeps the proxy address it
   * was given, and a row that gains a sign-in moves from its own URL to a proxy route. Only a set
   * with a proxied row adds a value.
   */
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
    return createHash("sha256")
      .update(
        JSON.stringify([
          visibleDynamicTools(agent.provider),
          mcpFingerprintValues(configs),
          Object.keys(disabled).sort(),
          // A revoked approval must also replace a loaded session with the old tool policy.
          approvals,
          [toolRuntimes.binDirectories, toolRuntimes.commandAliases],
          CODEX_MCP_ADAPTER_VERSION,
          // Only a sandboxed agent, one with added folders, one that allows local scripts, or one that
          // shows its plan adds a value: Codex keeps the developer instructions of a loaded session, and other sessions keep
          // the fingerprint they had.
          [
            agent.name,
            agent.title,
            agent.description,
            ...(workspaceAccessEnforced(agent) ? ["workspace"] : []),
            // The folders that the instructions name: a drive that is ejected or connected changes them.
            ...(folders.length ? [["folders", ...folders]] : []),
            ...(excluded.length ? [["excluded", ...excluded]] : []),
            ...(agentAutomationAllowed(agent, this.#store.agentDefaults()) ? ["automation"] : []),
            ...(agentQuickAcknowledgementEnabled(agent, this.#store.agentDefaults()) ? ["quick-acknowledgement"] : []),
          ],
          ...(Object.keys(environment).length > 0 ? [Object.entries(environment).sort()] : []),
          ...(legacySection ? [legacySection.members.map((member) => member.id).sort()] : []),
          ...(proxy ? [proxy] : []),
          // A loaded session keeps the instruction file that it read or got at its start, so a change
          // to the file adds a new value. Only another file name, or a file with text, adds a value.
          ...(instructionsFile.fileName === "AGENTS.md" ? [] : [["instructions-file", instructionsFile.fileName]]),
          ...(instructionsFile.found?.text ? [["instructions", instructionsFile.found.text]] : []),
        ]),
      )
      .digest("hex");
  }

  /** The tool approvals that Codex saved in its own file, by the key each server travels under. */
  #toolApprovals(configs: readonly McpServerConfig[], { disabled, transports }: CodexOwnServers): CodexToolApprovals {
    return configs.map((config) => {
      const key = codexMcpServerKey(config, transports);
      return [key, disabled[key]?.tools ?? {}];
    });
  }

  /**
   * The fingerprint, then the approvals it holds as JSON. A manifest from before has the fingerprint
   * only, and keeps the old rule: any change to the approvals replaces its session.
   */
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

  /**
   * The settings that one session of the agent runs with. A task runs without Computer Use: the
   * agent's own chat keeps the one screen of this computer, so two conversations of the agent never
   * drive it at the same time. A routine thread keeps it: a scheduled run that sends a message
   * through a desktop app has no person to continue the step in the chat.
   */
  #sessionAgent(agent: AgentSummary, publicThreadId: string): AgentSummary {
    return this.#computerUseInOwnChat(agent, publicThreadId) ? { ...agent, computerUse: false } : agent;
  }

  /**
   * What the turn context gets apart from the memories: the section-mates (names, titles and order
   * count) and whether saved logins are shared.
   */
  #turnContextKey(agent: AgentSummary): string {
    return JSON.stringify([this.#sectionTeammates(agent.id), this.#passwordVaultConnected()]);
  }

  #rememberTurnContext(client: AgentClient, externalThreadId: string, key: string): void {
    if (client.turnContext === true) this.#givenTurnContext.set(externalThreadId, key);
  }

  #turnContextChanged(agent: AgentSummary, client: AgentClient, externalThreadId: string): boolean {
    const given = this.#givenTurnContext.get(externalThreadId);
    return client.turnContext === true && given !== undefined && given !== this.#turnContextKey(agent);
  }

  #computerUseInOwnChat(agent: AgentSummary, publicThreadId: string): boolean {
    return (
      this.#runsBesideOwnChat(agent, publicThreadId) &&
      !this.#routineThread(publicThreadId) &&
      agentComputerUseEnabled(agent)
    );
  }

  /**
   * Whether turns of this thread can run at the same time as the agent's own chat: a task, or a
   * channel thread on a provider that runs several turns at once.
   */
  #runsBesideOwnChat(agent: AgentSummary, publicThreadId: string): boolean {
    if (this.#conversation.isTaskThread(publicThreadId)) return true;
    return (
      this.#conversation.channelForThread(publicThreadId) !== null &&
      agentProviderDescriptor(agent.provider).concurrentTurns
    );
  }

  /** The enabled servers this agent is given. Without Computer Use the fingerprint changes, so Codex replaces the session. */
  #agentMcpServers(agent: AgentSummary): readonly McpServerConfig[] {
    return agentMcpServers(this.#mcpServers(), agentComputerUseEnabled(agent));
  }

  /**
   * A `tool-sandbox` provider (Claude) applies its own Workspace only sandbox, so it is told directly.
   * Codex reads `sandbox`, and `ProviderRuntime` confines a `confined-process` provider.
   */
  #workspaceOnlyParam(agent: AgentSummary, client: AgentClient): { workspaceOnly?: true; excludedFolders?: string[] } {
    if (
      agentProviderDescriptor(client.provider).workspaceEnforcement !== "tool-sandbox" ||
      !workspaceAccessEnforced(agent)
    )
      return {};
    const excluded = workspaceExcludedFolders(agent);
    return { workspaceOnly: true, ...(excluded.length ? { excludedFolders: excluded } : {}) };
  }

  /** Claude and the ACP clients read the servers themselves, so they are told to leave Computer Use out. */
  #computerUseParam(agent: AgentSummary, client: AgentClient): { computerUse?: false } {
    return client.provider === "codex" || agentComputerUseEnabled(agent) ? {} : { computerUse: false };
  }

  /**
   * The agent, for Claude and the ACP clients, which read the servers themselves. Codex gets its
   * servers from `codexConfigEffect` and takes the params as they are, so it is told nothing.
   */
  #mcpAgentParam(agent: AgentSummary, client: AgentClient): { openbotAgentId?: string } {
    return client.provider === "codex" ? {} : { openbotAgentId: agent.id };
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
    // Also the form of a session from before the section-mates went with the turns, with their ids.
    // That session keeps the old list in its instructions, and its first turn sends the current one.
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
    // An approval given since the start is in the loaded session already: Codex saved it from that
    // session's answer. Only a revoked one needs a new session. The manifest takes the new approvals,
    // so that a later revoke of one of them is seen.
    const sessionApprovals = yield* threadStep(() =>
      decodeToolApprovals(JSON.parse(stored.success.slice(newline + 1))),
    ).pipe(Effect.orElseSucceed(() => null));
    if (!sessionApprovals || approvalRevoked(sessionApprovals, approvals)) return false;
    if (!(yield* matches(sessionApprovals, section ? [null, section] : [null]))) return false;
    yield* this.#writeToolManifest(sessionId, fingerprint, approvals);
    return true;
  });

  /**
   * The developer instructions of a session start or resume, with what is connected now. A client
   * with `turnContext` gets the memories and the section-mates apart, and sends them with the turns:
   * see `memoriesInTurns`. A change in the system prompt writes the full conversation to the cache again.
   */
  #instructions(
    agent: AgentSummary,
    client: AgentClient,
    section = this.#sectionTeammates(agent.id),
    computerUseInOwnChat = false,
    homeSkills: readonly HomeSkill[] = [],
    sideThread = false,
    mcpServers: readonly McpServerConfig[],
    instructionsFile: InstructionsFileInPrompt,
  ): DynamicRecord {
    const memories = this.#memories.essentialFor(agent.id);
    const options = {
      computerUseInOwnChat,
      sideThread,
      passwordVault: this.#passwordVaultConnected(),
      vaultItems: this.#vaultItems(),
      serverHost: this.#serverHost,
      responseStyle: this.#responseStyle(),
      memoryLimit: this.#memories.limit(),
      storedMemoryCount: this.#memories.listFor(agent.id).length,
      memoriesInTurns: client.turnContext === true,
      teammatesInTurns: client.turnContext === true,
      savedLoginsInTurns: client.turnContext === true,
      sectionTeammates: section,
      homeSkills,
      httpMcpServers: mcpServers.some((config) => config.transport === "http"),
      deferredMcpServers:
        client.provider === "codex" ? codexDeferredMcpServers(mcpServers).map((config) => config.name) : [],
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
    return options.memoriesInTurns
      ? {
          developerInstructions: instructions,
          memoryContext: memoryContext(memories, options),
          sectionTeammates: section,
          savedLogins: options.passwordVault,
          // Measured for Claude only: deep in a long thread, it skipped the natural style's first line.
          ...(options.responseStyle === "natural" && client.provider === "claude" ? { turnStyleReminder: true } : {}),
        }
      : { developerInstructions: instructions };
  }

  /**
   * The skills in `~/.agents/skills` that the instructions name, for a CLI that does not read that
   * folder. A skill that the CLI reads from a workspace skill folder of the same name is left out.
   */
  readonly #homeSkills = Effect.fn("ThreadLifecycle.homeSkills")(function* (agent: AgentSummary, client: AgentClient) {
    const descriptor = agentProviderDescriptor(client.provider);
    if (descriptor.homeSkills !== "instructions") return [];
    const read = new Set<string>();
    for (const folder of descriptor.skillFolders)
      for (const name of yield* skillFolderNames(join(agent.workspacePath, folder))) read.add(name);
    return (yield* listHomeSkills()).filter((skill) => !read.has(skill.slug));
  });

  /**
   * The agent's instruction file, and its text when the CLI does not read that file by itself.
   * Claude in workspace-only mode reads user settings only, so it gets the text too.
   */
  readonly #instructionsFile = Effect.fn("ThreadLifecycle.instructionsFile")(function* (
    agent: AgentSummary,
    client: AgentClient,
  ) {
    const read =
      client.provider === "claude" && workspaceAccessEnforced(agent)
        ? []
        : agentProviderDescriptor(client.provider).workspaceInstructionFiles;
    const file = yield* promptInstructionsFile(agent.workspacePath, read);
    return {
      fileName: file?.fileName ?? "AGENTS.md",
      found: file,
      file: file && !file.readByCli ? file : null,
    } satisfies InstructionsFileInPrompt;
  });

  /**
   * What an existing provider session is addressed with. Read by `resumeThread` and by boot
   * recovery, which reads a session before any turn resumes it: a client that has to load the
   * session to answer needs the same workspace and settings as the resume would have given it.
   */

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
      ...this.#mcpAgentParam(agent, client),
      ...this.#instructions(
        agent,
        client,
        this.#sectionTeammates(agent.id),
        computerUseInOwnChat,
        yield* this.#homeSkills(agent, client),
        this.#runsBesideOwnChat(agent, publicThreadId),
        configs,
        yield* this.#instructionsFile(agent, client),
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
    const givenContext = this.#turnContextKey(agent);
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
    this.#rememberTurnContext(client, externalThreadId, givenContext);
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

  /**
   * Whether a new session can take the place of this one with no lost context. The agent's own chat
   * starts the new session from its history handoff, and a channel thread from the complete channel
   * packet, which a new session always gets. Other threads have neither.
   */
  rotatesSession(agentId: string, externalThreadId: string): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return false;
    const publicThreadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    if (publicThreadId !== agent.threadId && !this.#channelThread(publicThreadId)) return false;
    return (
      this.#store.database.activeProviderSession(publicThreadId, agent.provider)?.externalSessionId === externalThreadId
    );
  }

  /**
   * Compacts the context of a provider that cannot compact on request: the session ends, and a new
   * one on the same public thread starts from the history handoff, or from the complete packet on a
   * channel thread. The agent, its thread, and its messages stay. Returns the new session, or `null`
   * when the old one is no longer the active one or `rotatesSession` refuses its thread.
   */
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
    // The steps first: an ACP agent keeps them only in the session that closes below.
    const steps = yield* this.readWorkSteps(session);
    if (steps !== null) yield* this.saveWorkSteps(session, steps);
    // The client that holds the session, while the routing entry that `retireProviderSession`
    // removes still names it. After a CLI replacement that is not the agent's current client.
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
    const settingsIdentity = sessionSettingsIdentity(agent);
    const resets = this.#store.list().find((candidate) => candidate.id === agent.id)?.sessionSettingResets;
    if (resets?.includes(settingsIdentity)) this.#pendingRuntimeRefreshes.add(agent.id);
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
      else
        yield* this.#refreshThreadRuntime(
          threadId,
          RUNTIME_RELOADED_ON_RESUME.has(agent.provider) ? agent.provider : null,
        );
    }
    if (!deferred) {
      this.#pendingRuntimeRefreshes.delete(agent.id);
      this.#store.clearSessionSettingReset(agent.id, settingsIdentity);
    }
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
   * As `providerContextBusy`, for the agent's own chat alone: a task or channel thread that starts a
   * turn or compacts its own session does not hold a change to the chat's context.
   */
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
   *
   * `reloadProvider`: the thread only needs the current runtime, and this provider's client reloads
   * it on resume. Its sessions keep their provider history: a process that holds one closes, and
   * the next turn resumes it with the new set. A session that no process holds has nothing to close.
   */
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

  /** The saved steps of a session, or `null` when no capture is available. */
  readonly capturedWorkSteps = Effect.fn("ThreadLifecycle.capturedWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    let text = yield* Effect.result(threadIo(() => readFile(this.workStepsPath(session.id), "utf8")));
    // A pre-v2 capture belongs to this session only when no other session uses its external identifier.
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
    // A write that a crash cut short. Omit the capture.
    this.#hooks.logHandoffReadFailure(session.provider, decoded.failure.cause);
    return null;
  }).bind(this);

  /**
   * Reads the work steps of a session that a provider switch is about to replace, through the
   * client that holds it, while it still does: an ACP agent keeps its turns only in its own process,
   * and a provider no agent uses stops a minute later. The result is saved with `saveWorkSteps`
   * once the switch is stored. `null` - no client holds the session, or the read failed - leaves
   * the session to an unavailable capture in the next handoff.
   */
  readonly readWorkSteps = Effect.fn("ThreadLifecycle.readWorkSteps")(function* (
    this: ThreadLifecycle,
    session: ProviderSession,
  ) {
    const client = this.#conversation.loadedClientFor(session.externalSessionId);
    if (!client || client.provider !== session.provider) return null;
    // Not the request's own timeout: the Claude and ACP clients answer a read without one.
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
    // A task keeps its own conversation across sessions, as the agent's own chat does.
    if (this.#conversation.isExecutionThread(threadId) && !this.#conversation.isTaskThread(threadId)) return null;
    const sessions = this.#store.database.listProviderSessions(threadId);
    // A branch starts with a copied conversation and no session, so its first session gets the copy.
    const branch = this.#conversation.isTaskThread(threadId) && this.#branchThread(threadId);
    if (sessions.length < 1 && !branch) return null;
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
    return renderProviderHandoff(history, agentNames, steps, { branch });
  }).bind(this);
}

export class ThreadOperationFailed extends Schema.TaggedError<ThreadOperationFailed>()("ThreadOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { io: threadIo, sync: threadStep, rewrap: toThreadOperationFailed } = causeHelpers(ThreadOperationFailed);

/** The approvals of a manifest this app wrote, or null for any other value. */
function decodeToolApprovals(value: unknown): CodexToolApprovals | null {
  if (!Array.isArray(value)) return null;
  const approvals: CodexToolApprovals = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isDynamicRecord(entry[1])) return null;
    approvals.push([entry[0], entry[1]]);
  }
  return approvals;
}

/**
 * Whether a tool setting that a session started with is gone or changed now, or a tool got a setting
 * other than an approval, such as `approval_mode = "prompt"`. Only a new approval leaves the session.
 */
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
