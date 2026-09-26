import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentSummary,
  agentComputerUseEnabled,
  type McpServerConfig,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { BROWSER_DYNAMIC_TOOLS } from "../browser-tools";
import { mergeConversationSnapshots } from "../conversation-snapshots";
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
  usableMcpServers,
} from "../mcp-provider-shapes";
import { OPENBOT_DYNAMIC_TOOLS } from "../openbot-tools";
import { decodeRecordResponse, decodeThreadResponse, getString, type ResponseDecoder } from "../protocol";
import type { AgentMemories } from "./agent-memories";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import { agentNamesById, estimateTokens, renderHandoffMessage, summarizeOldMessages } from "./delivery-content";
import { developerInstructions } from "./developer-instructions";
import { isArchivedThreadError, isMissingProviderSessionError } from "./thread-items";
import { codexSandboxConfig, codexSandboxMode } from "./workspace-sandbox";

/**
 * What the Codex adapter sends, versioned. Codex ignores MCP configuration on resume, so a
 * session started by an older adapter keeps the servers it was given even when the stored set
 * is unchanged. Folding this into the tool fingerprint refreshes those sessions once through
 * the replacement flow. Bump it when what Codex is sent changes; 2 is HTTP servers joining
 * the payload, 3 is the sweep that turns off the servers `~/.codex/config.toml` declares, and 4 is
 * the managed tool runtimes joining the fingerprint, so a session started before Bun finished
 * downloading is replaced once its servers can actually start.
 */
const CODEX_MCP_ADAPTER_VERSION = 4;

// A handoff can follow an edit of the profile. The earlier replies then show the old standing
// remit, and without this line the model copies them instead of following the new one.
const HANDOFF_PRECEDENCE =
  "Your current profile and developer instructions take precedence over any different instructions or behavior in this transcript.";

export interface ThreadLifecycleHooks {
  /** Keeps the `agent-service` logger (and its prefix) as the single writer. */
  logRecovery(agentId: string, provider: AgentProvider, outcome: "resumed" | "replaced"): void;
  /** A provider session that would not close. Its client keeps it, and the app stops using it. */
  logReleaseFailure(provider: AgentProvider, error: unknown): void;
  /** What Codex could not be given. The other providers report this from their own clients. */
  reportMcpDrops(provider: AgentProvider, drops: readonly McpServerDrop[]): void;
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
  }

  /**
   * The runtimes the MCP servers may use right now. Read at each use: a runtime that finished
   * downloading after the app started has to count, and a session started before it did has to
   * read as stale.
   */
  #toolRuntimes(): McpToolRuntimes {
    return this.#mcpToolRuntimes?.() ?? NO_MCP_TOOL_RUNTIMES;
  }

  refreshAgentRuntime(agentId: string): void {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("The selected agent no longer exists.");
    this.#pendingRuntimeRefreshes.add(agentId);
    this.applyPendingRuntimeRefresh(agent);
  }

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
  refreshAllAgentRuntimes(): void {
    for (const agent of this.#store.list()) {
      this.#pendingRuntimeRefreshes.add(agent.id);
      this.applyPendingRuntimeRefresh(agent);
    }
  }

  consumePendingHandoff(threadId: string): string | undefined {
    return this.#pendingHandoffs.get(threadId);
  }

  async deletePendingHandoff(threadId: string): Promise<void> {
    if (!this.#pendingHandoffs.has(threadId)) return;
    await rm(this.handoffPath(threadId), { force: true });
    this.#pendingHandoffs.delete(threadId);
  }

  /**
   * Closes every provider session of an agent that is about to be deleted, and waits for the close.
   * A session keeps its provider process running in the agent's workspace, and Windows refuses to
   * remove a directory that a live process uses (`EBUSY`). A failed close is logged: the removal
   * that follows reports whether the files could go. Each session is also unloaded, so the next turn
   * of an agent whose deletion failed opens the session again.
   */
  async releaseAgentSessions(agentId: string): Promise<void> {
    await Promise.all(
      this.#conversation.loadedAgentThreads(agentId).map(async ([externalThreadId, client]) => {
        try {
          await client.releaseThread?.(externalThreadId);
        } catch (error) {
          this.#hooks.logReleaseFailure(client.provider, error);
        }
        this.#conversation.unloadThread(externalThreadId);
      }),
    );
  }

  async deleteProviderSessionFiles(sessionId: string): Promise<void> {
    // Deletion also covers retired sessions and handoffs not loaded this run.
    await rm(this.handoffPath(sessionId), { force: true });
    await rm(this.toolManifestPath(sessionId), { force: true });
    this.#pendingHandoffs.delete(sessionId);
  }

  async reconcileProviderSessionFiles(): Promise<void> {
    const recorded = new Set(
      this.#store.database.listExternalSessionIds().map((id) => createHash("sha256").update(id).digest("hex")),
    );
    for (const name of ["provider-handoffs", "provider-toolsets"]) {
      const directory = join(this.#store.database.userDataPath, name);
      const files = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      });
      for (const file of files) {
        if (file.isFile() && /^[a-f0-9]{64}$/.test(file.name) && !recorded.has(file.name)) {
          await rm(join(directory, file.name), { force: true });
        }
      }
    }
  }

  dispose(): void {
    this.#pendingHandoffs.clear();
    this.#pendingRuntimeRefreshes.clear();
    this.#pendingStarts.clear();
  }

  async ensureThread(agent: AgentSummary, client: AgentClient, executionThreadId?: string): Promise<string> {
    const publicThreadId = executionThreadId ?? (await this.#store.ensureThreadId(agent.id));
    if (executionThreadId) this.#conversation.registerExecutionThread(agent.id, executionThreadId);
    const currentAgent = this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent;
    const session = this.#store.database.activeProviderSession(publicThreadId, agent.provider);
    if (session) {
      this.#conversation.bindThread(session.externalSessionId, agent.id, publicThreadId);
      try {
        const handoff = await readFile(this.handoffPath(session.externalSessionId), "utf8");
        this.#pendingHandoffs.set(session.externalSessionId, handoff);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      // Codex ignores dynamicTools on thread/resume. A replacement provider session is
      // required when tools change; the public thread and its history stay intact. The old
      // session is closed in the client as well, or it keeps the MCP servers it started with
      // every further change adding another unreachable set of processes. Changed standing
      // instructions take the same path, for the reason given at `toolFingerprint`.
      if (
        client.provider === "codex" &&
        !(await this.hasCurrentTools(currentAgent, client, session.externalSessionId))
      ) {
        const replacement = await this.startProviderThread(currentAgent, client, publicThreadId);
        // The client is named here: a profile edit has already dropped the loaded entry, and the
        // lookup alone would leave the old session open inside Codex.
        this.#releaseProviderSession(session.externalSessionId, client);
        this.retireProviderSession(currentAgent, session.externalSessionId);
        this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
        return replacement;
      }
      if (this.#conversation.loadedClientFor(session.externalSessionId) !== client) {
        try {
          await this.resumeThread(currentAgent, client, session.externalSessionId);
        } catch (error) {
          if (!isMissingProviderSessionError(error, client.provider)) throw error;
          this.retireProviderSession(currentAgent, session.externalSessionId);
          const replacementThreadId = await this.startProviderThread(currentAgent, client, publicThreadId);
          this.#hooks.logRecovery(currentAgent.id, client.provider, "replaced");
          return replacementThreadId;
        }
      }
      this.#conversation.bindThread(session.externalSessionId, agent.id, publicThreadId);
      return session.externalSessionId;
    }

    return this.startProviderThread(currentAgent, client, publicThreadId);
  }

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

  async startProviderThread(agent: AgentSummary, client: AgentClient, publicThreadId: string): Promise<string> {
    const release = this.holdRuntimeRefresh(agent.id);
    try {
      return await this.#startProviderThread(agent, client, publicThreadId);
    } finally {
      release();
    }
  }

  async #startProviderThread(agent: AgentSummary, client: AgentClient, publicThreadId: string): Promise<string> {
    // One reading of the MCP set for the request and for the manifest below. Read twice, a change
    // that lands while the provider answers would be recorded as what this session was given, and
    // `hasCurrentTools` would then accept a session that never got it.
    const mcpServers = this.#agentMcpServers(agent);
    // The runtimes join that single reading for the same reason: a download that finishes while
    // the provider answers must not be recorded as what resolved this session's servers.
    const toolRuntimes = this.#toolRuntimes();
    // The same reading rule as above, and for the same reason: the manifest has to record the set
    // this session was started with, including the names swept out of the provider's own file.
    const disabled = await this.codexOwnServers(client);
    const response = await client.request(
      "thread/start",
      {
        ...(await this.codexConfig(agent, client, mcpServers, disabled, toolRuntimes)),
        model: agent.model,
        effort: agent.reasoningEffort,
        cwd: agent.workspacePath,
        runtimeWorkspaceRoots: [agent.workspacePath, this.#store.sharedRoot],
        approvalPolicy: "on-request",
        sandbox: codexSandboxMode(agent),
        ...this.#computerUseParam(agent, client),
        developerInstructions: developerInstructions(agent, this.#store.sharedRoot, this.#memories.listFor(agent.id)),
        ephemeral: false,
        serviceName: "openbot",
        dynamicTools: [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS],
      },
      decodeThreadResponse,
    );
    const externalThreadId = response.thread.id;
    try {
      if (client.provider === "codex") {
        await mkdir(this.toolManifestDirectory(), { recursive: true, mode: 0o700 });
        await writeFile(
          this.toolManifestPath(externalThreadId),
          this.toolFingerprint(agent, mcpServers, disabled, toolRuntimes),
          {
            mode: 0o600,
          },
        );
      }
      const handoff = this.buildProviderHandoff(agent.id, publicThreadId);
      if (handoff) {
        await mkdir(join(this.#store.database.userDataPath, "provider-handoffs"), { recursive: true, mode: 0o700 });
        // Persist before binding the replacement: a crash must not activate a session
        // whose first turn can no longer recover the existing conversation context.
        await writeFile(this.handoffPath(externalThreadId), handoff, { mode: 0o600 });
        this.#pendingHandoffs.set(externalThreadId, handoff);
      }
      if (publicThreadId === agent.threadId) this.#store.bindProviderSession(agent.id, externalThreadId);
      else
        this.#store.database.bindProviderSession({
          threadId: publicThreadId,
          provider: agent.provider,
          externalSessionId: externalThreadId,
          model: agent.model,
          effort: agent.reasoningEffort,
        });
    } catch (error) {
      await this.deleteProviderSessionFiles(externalThreadId).catch((cleanupError: unknown) => {
        throw new AggregateError([error, cleanupError], "Failed to prepare and clean up the provider session.");
      });
      throw error;
    }
    this.#conversation.bindThread(externalThreadId, agent.id, publicThreadId);
    this.#conversation.markThreadLoaded(externalThreadId, client);
    this.#conversation.ensureSnapshot(agent.id, publicThreadId);
    return externalThreadId;
  }

  private handoffPath(sessionId: string): string {
    return join(
      this.#store.database.userDataPath,
      "provider-handoffs",
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
   */
  private async codexConfig(
    agent: AgentSummary,
    client: AgentClient,
    configs: readonly McpServerConfig[],
    disabled: Record<string, CodexDisabledMcpServer>,
    toolRuntimes: McpToolRuntimes,
  ): Promise<{
    config?: {
      mcp_servers?: Record<string, CodexMcpServer | CodexDisabledMcpServer>;
    } & ReturnType<typeof codexSandboxConfig>;
  }> {
    if (client.provider !== "codex") return {};
    const { servers, dropped } = codexMcpServers(await usableMcpServers(configs, toolRuntimes, this.#mcpAuthorization));
    this.#hooks.reportMcpDrops(client.provider, dropped);
    const mcpServers = { ...disabled, ...servers };
    const config = {
      ...(Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
      ...codexSandboxConfig(agent, this.#store.sharedRoot),
    };
    return Object.keys(config).length > 0 ? { config } : {};
  }

  /**
   * The servers Codex would merge from its own file, each turned off.
   *
   * A failed read answers with none rather than stopping the thread: a user whose Codex
   * configuration cannot be parsed still gets their OpenBot servers, and the file's own entries
   * are the ones Codex was going to add anyway.
   */
  private async codexOwnServers(client: AgentClient): Promise<Record<string, CodexDisabledMcpServer>> {
    if (client.provider !== "codex") return {};
    return codexDisabledServers(() =>
      client.request("config/read", { includeLayers: false }, decodeRecordResponse),
    ).catch(() => ({}));
  }

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
   */
  private toolFingerprint(
    agent: AgentSummary,
    configs: readonly McpServerConfig[],
    disabled: Record<string, CodexDisabledMcpServer>,
    toolRuntimes: McpToolRuntimes,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS],
          mcpFingerprintValues(configs),
          Object.keys(disabled).sort(),
          [toolRuntimes.binDirectories, toolRuntimes.commandAliases],
          CODEX_MCP_ADAPTER_VERSION,
          // Only a sandboxed agent adds a value: a full-access session keeps the fingerprint it had.
          [agent.name, agent.title, agent.description, ...(workspaceAccessEnforced(agent) ? ["workspace"] : [])],
        ]),
      )
      .digest("hex");
  }

  /** The enabled servers this agent is given. Without Computer Use the fingerprint changes, so Codex replaces the session. */
  #agentMcpServers(agent: AgentSummary): readonly McpServerConfig[] {
    return agentMcpServers(this.#mcpServers(), agentComputerUseEnabled(agent));
  }

  /** Claude and the ACP clients read the servers themselves, so they are told to leave Computer Use out. */
  #computerUseParam(agent: AgentSummary, client: AgentClient): { computerUse?: false } {
    return client.provider === "codex" || agentComputerUseEnabled(agent) ? {} : { computerUse: false };
  }

  private async hasCurrentTools(agent: AgentSummary, client: AgentClient, sessionId: string): Promise<boolean> {
    try {
      const stored = await readFile(this.toolManifestPath(sessionId), "utf8");
      return (
        stored ===
        this.toolFingerprint(
          agent,
          this.#agentMcpServers(agent),
          await this.codexOwnServers(client),
          this.#toolRuntimes(),
        )
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }

  /**
   * What an existing provider session is addressed with. Read by `resumeThread` and by boot
   * recovery, which reads a session before any turn resumes it: a client that has to load the
   * session to answer needs the same workspace and settings as the resume would have given it.
   */
  async threadParams(agent: AgentSummary, client: AgentClient, externalThreadId: string): Promise<DynamicRecord> {
    return {
      threadId: externalThreadId,
      model: agent.model,
      effort: agent.reasoningEffort,
      cwd: agent.workspacePath,
      runtimeWorkspaceRoots: [agent.workspacePath, this.#store.sharedRoot],
      approvalPolicy: "on-request",
      sandbox: codexSandboxMode(agent),
      ...this.#computerUseParam(agent, client),
      developerInstructions: developerInstructions(agent, this.#store.sharedRoot, this.#memories.listFor(agent.id)),
      ...(client.provider === "codex" ? {} : { dynamicTools: [...BROWSER_DYNAMIC_TOOLS, OPENBOT_DYNAMIC_TOOLS] }),
      ...(await this.codexConfig(
        agent,
        client,
        this.#agentMcpServers(agent),
        await this.codexOwnServers(client),
        this.#toolRuntimes(),
      )),
    };
  }

  async resumeThread(agent: AgentSummary, client: AgentClient, externalThreadId: string): Promise<void> {
    this.#conversation.bindThread(externalThreadId, agent.id);
    const params = await this.threadParams(agent, client, externalThreadId);

    try {
      await client.request("thread/resume", params, decodeRecordResponse);
    } catch (error) {
      if (client.provider !== "codex" || !isArchivedThreadError(error)) throw error;
      await client.request("thread/unarchive", { threadId: externalThreadId }, decodeRecordResponse);
      await client.request("thread/resume", params, decodeRecordResponse);
    }
    this.#conversation.markThreadLoaded(externalThreadId, client);
  }

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

  async requestWithArchivedThreadRecovery<T>(
    agent: AgentSummary,
    client: AgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
  ): Promise<T> {
    try {
      return await client.request(method, params, decoder);
    } catch (error) {
      if (client.provider !== "codex" || !isArchivedThreadError(error)) throw error;
      const threadId = getString(params, "threadId");
      if (!threadId) throw error;
      await this.resumeThread(agent, client, threadId);
      return client.request(method, params, decoder);
    }
  }

  logRecovery(agentId: string, provider: AgentProvider, outcome: "resumed" | "replaced"): void {
    this.#hooks.logRecovery(agentId, provider, outcome);
  }

  /**
   * Spends this agent's refresh mark on the sessions that can take it, and keeps it otherwise.
   *
   * `startingDeliveryId` names the delivery whose start is calling this, which is the one delivery
   * whose unconfirmed state must not hold the mark back: it is about to be given the new set.
   */
  applyPendingRuntimeRefresh(agent: AgentSummary, startingDeliveryId?: string): void {
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
    const unconfirmed = this.#mailbox.startingDeliveryForAgent(agent.id);
    if (unconfirmed && unconfirmed.delivery.id !== startingDeliveryId) return;
    let deferred = false;
    // Every thread of this agent, not only `agent.threadId`: a channel turn runs on an execution
    // thread of its own, and its provider session holds the same stale runtime as the agent's.
    const threadIds = this.#store.database.activeProviderSessionThreads(agent.id);
    for (const threadId of threadIds) {
      // A running turn owns its provider session, so the refresh waits for it. The mark stays, and
      // the next drain of this agent refreshes the thread that was busy this time.
      if (this.#activeTurnOf(agent.id, threadId)) deferred = true;
      else this.#refreshThreadRuntime(threadId);
    }
    if (!deferred) this.#pendingRuntimeRefreshes.delete(agent.id);
  }

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
  #refreshThreadRuntime(threadId: string): void {
    const sessions = this.#store.database.listProviderSessions(threadId).filter((one) => one.state === "active");
    this.#store.database.deactivateProviderSessions(threadId);
    for (const session of sessions) {
      // The client first, while the routing entry below still names it. Dropping the entry alone
      // would leave the old session open inside the client with the MCP servers it spawned, so each
      // further change would add a set of processes the user can no longer reach.
      this.#releaseProviderSession(session.externalSessionId);
      this.#conversation.unbindThread(session.externalSessionId);
      this.#conversation.unloadThread(session.externalSessionId);
      this.#compaction.forgetThread(session.externalSessionId);
      this.#pendingHandoffs.delete(session.externalSessionId);
    }
  }

  /**
   * Tells the client to close one provider session, and does not wait for it. The callers are the
   * synchronous settings paths, and the close talks to a child process; the routing entries are
   * dropped either way, so the next turn starts a new session whatever the old one answers.
   */
  #releaseProviderSession(
    externalThreadId: string,
    client = this.#conversation.loadedClientFor(externalThreadId),
  ): void {
    if (!client?.releaseThread) return;
    void client.releaseThread(externalThreadId).catch((error: unknown) => {
      this.#hooks.logReleaseFailure(client.provider, error);
    });
  }

  buildProviderHandoff(agentId: string, threadId: string): string | null {
    if (this.#conversation.isExecutionThread(threadId)) return null;
    if (this.#store.database.listProviderSessions(threadId).length < 1) return null;
    const persisted = this.#store.database.readConversation(agentId, threadId);
    const messages = mergeConversationSnapshots(persisted, {
      agentId,
      threadId,
      activeTurnId: null,
      revision: persisted.revision,
      messages: this.#mailbox.conversationMessages(agentId),
    }).messages.filter(
      (message) =>
        ["user", "assistant", "agent"].includes(message.author) &&
        message.itemType !== "commentary" &&
        (!message.delivery || ["completed", "failed", "interrupted"].includes(message.delivery.status)),
    );
    if (messages.length === 0) return null;

    const agentNames = agentNamesById(this.#store.list());
    const rendered = messages.map((message) => renderHandoffMessage(message, agentNames));
    const budgetTokens = 60_000;
    const fullText = rendered.join("\n\n");
    if (estimateTokens(fullText) <= budgetTokens) {
      return [
        "Continue this OpenBot conversation. The following transcript is user-visible history from the previous provider.",
        HANDOFF_PRECEDENCE,
        "Do not repeat completed work unless the current message asks for it.",
        "--- previous transcript ---",
        fullText,
        "--- end previous transcript ---",
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
      "Continue this OpenBot conversation. The oldest visible history was summarized because the provider handoff exceeded its context budget.",
      HANDOFF_PRECEDENCE,
      "--- saved summary of older history ---",
      summaryText,
      "--- full recent transcript ---",
      newest.join("\n\n"),
      "--- end previous transcript ---",
    ].join("\n");
  }
}
