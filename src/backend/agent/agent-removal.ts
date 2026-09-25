import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import type { MailboxStore } from "../mailbox-store";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import type { DrainScheduler } from "./drain-scheduler";
import type { DuplicationGate } from "./duplication-gate";
import type { HostedSiteCoordinator } from "./hosted-site-coordinator";
import type { RoutineScheduler } from "./routine-scheduler";
import type { ThreadLifecycle } from "./thread-lifecycle";
import type { AgentBrowserHost, TurnLifecycle } from "./turn-lifecycle";

export interface AgentRemovalHooks {
  emit(event: AgentEvent): void;
  listAgents(): AgentSummary[];
}

export interface AgentRemovalOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  browser: AgentBrowserHost;
  channels: ChannelService;
  routines: RoutineScheduler;
  duplication: DuplicationGate;
  drain: DrainScheduler;
  threads: ThreadLifecycle;
  turn: TurnLifecycle;
  hostedSites: HostedSiteCoordinator;
  compaction: ContextCompaction;
  /** Runs `remove` with the agent's approvals revoked. The main process gives it. */
  deleteWithRevokedApproval: (agentId: string, remove: () => Promise<void>) => Promise<void>;
  /** The agent service logger, so a deletion keeps the `agent-service` prefix it always had. */
  logger: Logger;
  hooks: AgentRemovalHooks;
}

/**
 * Owns the deletion of an agent: the set of agents being deleted, the removal of its provider
 * files, mailbox data, files and record, in that order, and the release of everything the running
 * app still holds for it, its browser tabs included.
 *
 * It never imports the agent service facade.
 */
export class AgentRemoval {
  readonly #deleting = new Set<string>();
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #browser: AgentBrowserHost;
  readonly #channels: ChannelService;
  readonly #routines: RoutineScheduler;
  readonly #duplication: DuplicationGate;
  readonly #drain: DrainScheduler;
  readonly #threads: ThreadLifecycle;
  readonly #turn: TurnLifecycle;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #compaction: ContextCompaction;
  readonly #deleteWithRevokedApproval: AgentRemovalOptions["deleteWithRevokedApproval"];
  readonly #logger: Logger;
  readonly #hooks: AgentRemovalHooks;

  constructor(options: AgentRemovalOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#browser = options.browser;
    this.#channels = options.channels;
    this.#routines = options.routines;
    this.#duplication = options.duplication;
    this.#drain = options.drain;
    this.#threads = options.threads;
    this.#turn = options.turn;
    this.#hostedSites = options.hostedSites;
    this.#compaction = options.compaction;
    this.#deleteWithRevokedApproval = options.deleteWithRevokedApproval;
    this.#logger = options.logger;
    this.#hooks = options.hooks;
  }

  /** The agents whose deletion is running. The routine scheduler leaves them out. */
  deleting(): ReadonlySet<string> {
    return this.#deleting;
  }

  async delete(agentId: string): Promise<void> {
    if (this.#deleting.has(agentId)) throw new Error("Agent deletion is already in progress.");
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const hasPendingWork = this.#mailbox.hasUnfinishedDelivery(agentId);
    if (hasPendingWork || this.#conversation.workingSnapshot(agentId)?.activeTurnId) {
      throw new Error("Stop the agent and cancel its queued messages before deleting it.");
    }

    const { wasPending, release } = this.#duplication.releaseForDelete(agentId);
    this.#deleting.add(agentId);
    const releaseDeliveries = this.#mailbox.blockAgentDeliveries(agentId);
    try {
      this.#routines.arm();
      await this.deleteData(agent ?? { id: agentId, threadId: null });
      this.#channels.removeDeletedMembers(new Set(this.#store.list().map((candidate) => candidate.id)));
      this.#duplication.forget(agentId);
      if (!wasPending) this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
    } finally {
      release();
      releaseDeliveries();
      this.#deleting.delete(agentId);
      this.#routines.arm();
      if (this.#store.list().some((candidate) => candidate.id === agentId)) this.#drain.scheduleDrain(agentId);
    }
  }

  async deleteData(agent: Pick<AgentSummary, "id" | "threadId">): Promise<void> {
    try {
      await this.#deleteWithRevokedApproval(agent.id, () => this.#removeAgentData(agent));
    } catch {
      throw new Error("The agent data could not be removed completely. Retry deleting the agent.");
    }
  }

  async #removeAgentData(agent: Pick<AgentSummary, "id" | "threadId">): Promise<void> {
    const providerSessions = agent.threadId ? this.#store.database.listProviderSessions(agent.threadId) : [];
    let stage = "provider-files";
    try {
      // Keep session records available if private file removal needs a retry.
      for (const session of providerSessions) await this.#threads.deleteProviderSessionFiles(session.externalSessionId);
      stage = "mailbox";
      await this.#mailbox.deleteAgentData(agent.id, this.#channels.store.allContextThreads());
      stage = "agent-files-and-record";
      await this.#store.deleteAgent(agent.id);
    } catch {
      // File-system errors can contain private paths. Log only the failed stage.
      this.#logger.warn("Agent deletion failed.", { stage });
      throw new Error("The agent data could not be removed completely. Retry deleting the agent.");
    }
    await this.#closeBrowserTabs(agent);
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

  /**
   * A deleted agent's tabs are reachable by nobody: no agent passes the host's owner check for them,
   * and the renderer lists tabs per agent, so they hold a view the user cannot even see to close.
   * They also survive a restart, because the browser persists its tabs outside `openbot.db`.
   *
   * The owner test matches the renderer's, so a tab the user could see under this agent is a tab this
   * closes -- including a legacy tab carrying only the thread id. Runs after the agent record is
   * already gone, so a failure here must not fail the deletion the user asked for.
   */
  async #closeBrowserTabs(agent: Pick<AgentSummary, "id" | "threadId">): Promise<void> {
    const owned = this.#browser
      .listTabs()
      .filter((tab) =>
        tab.ownerAgentId
          ? tab.ownerAgentId === agent.id
          : Boolean(agent.threadId && tab.ownerThreadId === agent.threadId),
      );
    let closed = 0;
    for (const tab of owned) {
      try {
        await this.#browser.close(tab.id);
        closed += 1;
      } catch (error) {
        this.#logger.warn("Could not close a deleted agent's browser tab.", { error });
      }
    }
    if (closed > 0) this.#logger.info("Closed a deleted agent's browser tabs.", { agentId: agent.id, count: closed });
  }
}
