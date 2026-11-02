import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { Logger } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import type { AgentApiKeys } from "../agent-api-keys";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import type { MessagingThreads } from "../messaging/messaging-threads";
import { isRecord } from "../protocol";
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
  /** Removes the agent's tasks, with their threads and provider session files. */
  deleteTasks(agentId: string): Effect.Effect<void, AgentRemovalFailed>;
  /** Ends the agent's background memory review, so that it does not write to a deleted agent. */
  cancelMemoryReview(agentId: string): Effect.Effect<void>;
  /** Stops the agent's own provider process, which runs in its workspace. */
  stopAgentProcess(agentId: string): Effect.Effect<void, AgentRemovalFailed>;
}

export interface AgentRemovalOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  browser: AgentBrowserHost;
  channels: ChannelService;
  messaging: MessagingThreads;
  routines: RoutineScheduler;
  duplication: DuplicationGate;
  drain: DrainScheduler;
  threads: ThreadLifecycle;
  turn: TurnLifecycle;
  hostedSites: HostedSiteCoordinator;
  compaction: ContextCompaction;
  /** The API keys that users saved for agents; null where nothing saves them. */
  apiKeys?: AgentApiKeys | null | undefined;
  /** Runs `remove` with the agent's approvals revoked. The main process gives it. */
  deleteWithRevokedApproval: (
    agentId: string,
    remove: () => Effect.Effect<void, AgentRemovalFailed>,
  ) => Effect.Effect<void, AgentRemovalFailed>;
  /** The `agent-removal` logger. The main process keeps its lines in the agent log file. */
  logger: Logger;
  hooks: AgentRemovalHooks;
}

/**
 * Owns the deletion of an agent: the set of agents being deleted, the close of its provider
 * sessions and the removal of its provider files, mailbox data, files and record, in that order,
 * and the release of everything the running app still holds for it, its browser tabs included.
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
  readonly #messaging: MessagingThreads;
  readonly #routines: RoutineScheduler;
  readonly #duplication: DuplicationGate;
  readonly #drain: DrainScheduler;
  readonly #threads: ThreadLifecycle;
  readonly #turn: TurnLifecycle;
  readonly #hostedSites: HostedSiteCoordinator;
  readonly #compaction: ContextCompaction;
  readonly #apiKeys: AgentApiKeys | null;
  readonly #deleteWithRevokedApproval: AgentRemovalOptions["deleteWithRevokedApproval"];
  readonly #logger: Logger;
  readonly #hooks: AgentRemovalHooks;

  constructor(options: AgentRemovalOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#browser = options.browser;
    this.#channels = options.channels;
    this.#messaging = options.messaging;
    this.#routines = options.routines;
    this.#duplication = options.duplication;
    this.#drain = options.drain;
    this.#threads = options.threads;
    this.#turn = options.turn;
    this.#hostedSites = options.hostedSites;
    this.#compaction = options.compaction;
    this.#apiKeys = options.apiKeys ?? null;
    this.#deleteWithRevokedApproval = options.deleteWithRevokedApproval;
    this.#logger = options.logger;
    this.#hooks = options.hooks;
  }

  /** The agents whose deletion is running. The routine scheduler leaves them out. */
  deleting(): ReadonlySet<string> {
    return this.#deleting;
  }

  /** Fails as `delete` would when the agent is being deleted, has an active turn or an unfinished delivery. */
  readonly ensureDeletable = Effect.fn("AgentRemoval.ensureDeletable")(function* (this: AgentRemoval, agentId: string) {
    yield* removalStep(() => this.#deletable(agentId));
  });

  readonly delete = Effect.fn("AgentRemoval.delete")(function* (this: AgentRemoval, agentId: string) {
    const agent = yield* removalStep(() => this.#deletable(agentId));
    yield* Effect.acquireUseRelease(
      removalStep(() => {
        const gate = this.#duplication.releaseForDelete(agentId);
        this.#deleting.add(agentId);
        const releaseDeliveries = this.#mailbox.blockAgentDeliveries(agentId);
        return { ...gate, releaseDeliveries };
      }),
      ({ wasPending }) =>
        Effect.gen({ self: this }, function* () {
          yield* removalStep(() => this.#routines.arm());
          yield* this.deleteData(agent ?? { id: agentId, threadId: null });
          yield* removalStep(() => {
            this.#channels.removeDeletedMembers(new Set(this.#store.list().map((candidate) => candidate.id)));
            this.#duplication.forget(agentId);
            if (!wasPending) this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
          });
        }),
      ({ release, releaseDeliveries }) =>
        Effect.sync(() => {
          release();
          releaseDeliveries();
          this.#deleting.delete(agentId);
          this.#routines.arm();
          if (this.#store.list().some((candidate) => candidate.id === agentId)) this.#drain.scheduleDrain(agentId);
        }),
    );
  }, Effect.uninterruptible);

  #deletable(agentId: string): AgentSummary | undefined {
    if (this.#deleting.has(agentId)) throw new Error(sourceText("error.agent.deletionBusy"));
    const candidate = this.#store.list().find((entry) => entry.id === agentId);
    if (this.#mailbox.hasUnfinishedDelivery(agentId) || this.#conversation.anyWorkingSnapshot(agentId)?.activeTurnId) {
      throw new Error(sourceText("error.agent.stopBeforeDelete"));
    }
    return candidate;
  }

  readonly deleteData = Effect.fn("AgentRemoval.deleteData")(function* (
    this: AgentRemoval,
    agent: Pick<AgentSummary, "id" | "threadId">,
  ) {
    // Approval revocation remains owned by the main-process gate. Its callback runs the
    // complete ordered removal before the gate can restore an approval on failure.
    yield* this.#deleteWithRevokedApproval(agent.id, () => this.#removeAgentDataEffect(agent)).pipe(
      Effect.mapError(() => new AgentRemovalFailed({ cause: new Error(sourceText("error.agent.deleteIncomplete")) })),
    );
  }, Effect.uninterruptible);

  readonly #removeAgentDataEffect = Effect.fn("AgentRemoval.removeData")(function* (
    this: AgentRemoval,
    agent: Pick<AgentSummary, "id" | "threadId">,
  ) {
    yield* this.#hooks.cancelMemoryReview(agent.id);
    const providerSessions = yield* removalStep(() =>
      agent.threadId ? this.#store.database.listProviderSessions(agent.threadId) : [],
    );
    // Keep provider session records until their private files have been removed.
    yield* this.#threads.releaseAgentSessions(agent.id);
    let stage = "provider-files";
    yield* Effect.gen({ self: this }, function* () {
      for (const session of providerSessions)
        yield* this.#threads
          .deleteProviderSessionFiles(session.externalSessionId, session.id)
          .pipe(toAgentRemovalFailed);
      stage = "messaging";
      yield* this.#messaging.deleteForAgent(agent.id).pipe(toAgentRemovalFailed);
      stage = "tasks";
      yield* this.#hooks.deleteTasks(agent.id);
      stage = "mailbox";
      yield* this.#mailbox
        .deleteAgentData(agent.id, this.#channels.store.allContextThreads())
        .pipe(toAgentRemovalFailed);
      stage = "api-keys";
      if (this.#apiKeys) yield* this.#apiKeys.removeAgent(agent.id).pipe(toAgentRemovalFailed);
      // Just before the files go, so that no later stage can start the process again. A failed stop is
      // logged: the removal reports whether the files could go.
      const stopped = yield* Effect.result(this.#hooks.stopAgentProcess(agent.id));
      if (Result.isFailure(stopped))
        this.#logger.warn("Could not stop a deleted agent's provider process.", removalErrorCode(stopped.failure));
      stage = "agent-files-and-record";
      yield* this.#store.deleteAgent(agent.id).pipe(toAgentRemovalFailed);
    }).pipe(
      Effect.mapError((failure) => {
        // File-system errors can contain private paths. Log only the failed stage and the error code.
        this.#logger.warn("Agent deletion failed.", { stage, ...removalErrorCode(failure) });
        return new AgentRemovalFailed({ cause: new Error(sourceText("error.agent.deleteIncomplete")) });
      }),
    );
    yield* this.closeBrowserTabs(agent);
    // Nobody can use the sign-ins of a deleted agent again.
    const cleared = yield* Effect.result(this.#browser.clearAgentSession(agent.id));
    if (Result.isFailure(cleared))
      this.#logger.warn("Could not clear a deleted agent's browser session.", removalErrorCode(cleared.failure));
    yield* removalStep(() => {
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
    });
  });

  /**
   * A deleted agent's tabs are reachable by nobody: no agent passes the host's owner check for them,
   * and the renderer lists tabs per agent, so they hold a view the user cannot even see to close.
   * They also survive a restart, because the browser persists its tabs outside `openbot.db`.
   *
   * The owner test matches the renderer's, so a tab the user could see under this agent is a tab this
   * closes -- including a legacy tab carrying only the thread id. Runs after the agent record is
   * already gone, so a failure here must not fail the deletion the user asked for.
   *
   * A change of the agent's own browser session closes its tabs too: each tab keeps the session it
   * opened in.
   */
  readonly closeBrowserTabs = Effect.fn("AgentRemoval.closeBrowserTabs")(function* (
    this: AgentRemoval,
    agent: Pick<AgentSummary, "id" | "threadId">,
  ) {
    const owned = this.#browser
      .listTabs()
      .filter((tab) =>
        tab.ownerAgentId
          ? tab.ownerAgentId === agent.id
          : Boolean(agent.threadId && tab.ownerThreadId === agent.threadId),
      );
    let closed = 0;
    for (const tab of owned) {
      const result = yield* Effect.result(this.#browser.close(tab.id).pipe(toAgentRemovalFailed));
      if (Result.isSuccess(result)) closed += 1;
      else this.#logger.warn("Could not close an agent's browser tab.", removalErrorCode(result.failure));
    }
    if (closed > 0) this.#logger.info("Closed an agent's browser tabs.", { agentId: agent.id, count: closed });
  });
}

export class AgentRemovalFailed extends Schema.TaggedError<AgentRemovalFailed>()("AgentRemovalFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: removalStep, rewrap: toAgentRemovalFailed } = causeHelpers(AgentRemovalFailed);

/** The first error code in the cause chain, such as `EBUSY` or `ERR_SQLITE_ERROR`. Never a message or a path. */
function removalErrorCode(failure: unknown): { code?: string; errcode?: number } {
  let cause = failure;
  for (let depth = 0; depth < 8 && isRecord(cause); depth += 1) {
    const { code, errcode } = cause;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/u.test(code))
      return { code, ...(typeof errcode === "number" ? { errcode } : {}) };
    cause = cause.cause;
  }
  return {};
}

export { toAgentRemovalFailed };
