import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { Logger } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import type { AgentApiKeys } from "../agent-api-keys";
import type { AgentClient, AgentProvider } from "../agent-client";
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
  deleteTasks(agentId: string): Effect.Effect<void, AgentRemovalFailed>;
  cancelMemoryReview(agentId: string): Effect.Effect<void>;
  stopAgentProcess(agentId: string): Effect.Effect<boolean, AgentRemovalFailed>;
  releaseFolderHolders(agentId: string): Effect.Effect<boolean, AgentRemovalFailed>;
  currentClient(provider: AgentProvider): AgentClient | null;
  usageLimitHolds(agentId: string): boolean;
  settleModelMoves(agentId: string): Effect.Effect<void>;
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
  apiKeys?: AgentApiKeys | null | undefined;
  deleteWithRevokedApproval: (
    agentId: string,
    remove: () => Effect.Effect<void, AgentRemovalFailed>,
  ) => Effect.Effect<void, AgentRemovalFailed>;
  logger: Logger;
  hooks: AgentRemovalHooks;
}

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

  deleting(): ReadonlySet<string> {
    return this.#deleting;
  }

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
          yield* this.#drain.taskFor(agentId)?.pipe(Effect.ignore) ?? Effect.void;
          yield* this.#hooks.settleModelMoves(agentId);
          const current = yield* removalStep(() => {
            this.#assertIdle(agentId);
            return this.#store.list().find((entry) => entry.id === agentId) ?? agent;
          });
          yield* removalStep(() => this.#routines.arm());
          yield* this.deleteData(current ?? { id: agentId, threadId: null });
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
    this.#assertIdle(agentId);
    return this.#store.list().find((entry) => entry.id === agentId);
  }

  #assertIdle(agentId: string): void {
    const pendingWork = this.#hooks.usageLimitHolds(agentId)
      ? this.#mailbox.hasStartedDelivery(agentId) || this.#channels.queueHold(agentId) !== null
      : this.#mailbox.hasUnfinishedDelivery(agentId);
    if (
      pendingWork ||
      this.#conversation.anyWorkingSnapshot(agentId)?.activeTurnId ||
      this.#compaction.heldThreads(agentId).length > 0
    ) {
      throw new Error(sourceText("error.agent.stopBeforeDelete"));
    }
  }

  readonly deleteData = Effect.fn("AgentRemoval.deleteData")(function* (
    this: AgentRemoval,
    agent: Pick<AgentSummary, "id" | "threadId">,
  ) {
    yield* this.#deleteWithRevokedApproval(agent.id, () => this.#removeAgentDataEffect(agent)).pipe(
      Effect.mapError((failure) =>
        failure.cause instanceof AgentFolderInUse
          ? failure
          : new AgentRemovalFailed({ cause: new Error(sourceText("error.agent.deleteIncomplete")) }),
      ),
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
    yield* this.#threads.releaseAgentSessions(
      agent.id,
      providerSessions.map((session) => ({
        externalThreadId: session.externalSessionId,
        client: this.#hooks.currentClient(session.provider),
      })),
    );
    let stage = "provider-files";
    let orchestratorOf: readonly string[] = [];
    let processKeptForWork = false;
    yield* Effect.gen({ self: this }, function* () {
      for (const session of providerSessions)
        yield* this.#threads
          .deleteProviderSessionFiles(session.externalSessionId, session.id)
          .pipe(toAgentRemovalFailed);
      stage = "messaging";
      orchestratorOf = yield* this.#messaging.deleteForAgent(agent.id).pipe(toAgentRemovalFailed);
      stage = "tasks";
      yield* this.#hooks.deleteTasks(agent.id);
      stage = "mailbox";
      yield* this.#mailbox
        .deleteAgentData(agent.id, this.#channels.store.allContextThreads())
        .pipe(toAgentRemovalFailed);
      stage = "api-keys";
      if (this.#apiKeys) yield* this.#apiKeys.removeAgent(agent.id).pipe(toAgentRemovalFailed);
      const stopped = yield* Effect.result(this.#hooks.stopAgentProcess(agent.id));
      if (Result.isFailure(stopped))
        this.#logger.warn("Could not stop a deleted agent's provider process.", removalErrorCode(stopped.failure));
      else processKeptForWork = stopped.success;
      stage = "agent-files-and-record";
      yield* this.#store.deleteAgent(agent.id).pipe(
        toAgentRemovalFailed,
        Effect.catch((failure) =>
          removalErrorCode(failure).code === "EBUSY"
            ? this.#hooks.releaseFolderHolders(agent.id).pipe(
                Effect.tap((kept) =>
                  Effect.sync(() => {
                    if (kept) processKeptForWork = true;
                  }),
                ),
                Effect.andThen(this.#store.deleteAgent(agent.id).pipe(toAgentRemovalFailed)),
              )
            : Effect.fail(failure),
        ),
      );
    }).pipe(
      Effect.tapError(() =>
        removalStep(() => {
          if (this.#store.list().some((candidate) => candidate.id === agent.id))
            this.#messaging.store.restoreOrchestrator(agent.id, orchestratorOf);
        }).pipe(
          Effect.catch((failure) =>
            Effect.sync(() =>
              this.#logger.warn("Could not restore a deleted agent's orchestrator role.", removalErrorCode(failure)),
            ),
          ),
        ),
      ),
      Effect.mapError((failure) => {
        const code = removalErrorCode(failure);
        this.#logger.warn("Agent deletion failed.", { stage, ...code });
        if (stage === "agent-files-and-record" && processKeptForWork && code.code === "EBUSY")
          return new AgentRemovalFailed({ cause: new AgentFolderInUse(sourceText("error.agent.deleteFolderInUse")) });
        return new AgentRemovalFailed({ cause: new Error(sourceText("error.agent.deleteIncomplete")) });
      }),
    );
    yield* this.closeBrowserTabs(agent);
    yield* this.#hooks.cancelMemoryReview(agent.id);
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

class AgentFolderInUse extends Error {}

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
