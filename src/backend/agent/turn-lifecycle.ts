import {
  type AgentEvent,
  type AgentSummary,
  agentProviderDescriptor,
  type BrowserControlState,
  type BrowserTab,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  type ConversationPlan,
  type ConversationSnapshot,
  type ConversationSubagent,
  type ConversationTurnTrace,
  clampConversationSubagents,
  conversationPlanText,
  conversationSubagentsText,
  isAgentContextCategories,
  latestTurnAnswer,
  PLAN_CONTINUATION_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { type CauseCode, classifyFailure } from "@openbot/telemetry";
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { BrowserOperationError } from "../browser-effects";
import type { BrowserDynamicToolHooks } from "../browser-tool-actions";
import { newAssistantMessage, normalizeCompletionStatus } from "../conversation-snapshots";
import { causeHelpers, reportOriginalFailure } from "../effect-boundary";
import type { DeliveryContext, MailboxStore, UsageLimitContinuation } from "../mailbox-store";
import {
  type AppServerNotification,
  type DynamicToolCallParams,
  type DynamicToolResult,
  decodeAccountLoginCompletedResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type ThreadItem,
} from "../protocol";
import type { AgentMemories } from "./agent-memories";
import { answerFilePaths } from "./answer-file-paths";
import type { AttentionBrowserHost, AttentionRegistry } from "./attention-registry";
import type { BrowserUploadTarget } from "./browser-uploads";
import { type ContextCompaction, compactsOnRequest } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import type { DeltaBuffer } from "./delta-buffer";
import type { FailureContext, FailureSignal } from "./failure-signal";
import { readCapturedSteps } from "./handoff-tool-steps";
import type { ImageGenRuntime } from "./image-gen-runtime";
import { markIncompleteImageGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import { memoryChangesMessage } from "./memory-changes-message";
import type { PlanContinuation } from "./plan-continuation";
import { PLAN_UPDATED_METHOD, planFromNotification } from "./plan-updates";
import { isBalanceDiagnostic, isPlanLimitDiagnostic, isUsageLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import { isNoUpdateAnswer, settleQuietRoutineTurn } from "./routine-quiet-runs";
import {
  foldCodexSubagentItem,
  SUBAGENTS_UPDATED_METHOD,
  stopRunningSubagents,
  subagentsFromNotification,
} from "./subagent-updates";
import { ThreadFileHistory } from "./thread-file-history";
import {
  isNonActionableCodexWarning,
  isToolItem,
  refusedSessionFailure,
  type ToolUsageSignal,
  toolErrorText,
  toolFailed,
  toolProgressText,
  toolTraceDetail,
  toolUsage,
  toThreadItem,
} from "./thread-items";
import { TurnTraces, traceMessage } from "./turn-traces";
import { collectProviderUsage } from "./usage-collection";
import { USAGE_LIMIT_METHOD, type UsageLimitGate } from "./usage-limit-gate";

const logger = createOpenBotLogger("turn-lifecycle");
const ENDED_TURN_LIMIT = 256;
/** How long before a turn's start its usage records can be, as in host analytics. */
const TURN_USAGE_MARGIN_MS = 60 * 60 * 1_000;
/**
 * The provider errors that move an agent set to switch without asking to its next backup model. Each
 * one can pass on another provider, account or model; a request the model refuses fails on each.
 */
const FAILOVER_CAUSES: ReadonlySet<CauseCode> = new Set([
  "billing",
  "provider_unavailable",
  "rate_limit",
  "authentication",
  "network",
  "timeout",
]);

/** A provider error held until the end of its turn, which runs the turn again on a backup model or shows it. */
interface HeldProviderError {
  message: string;
  context: FailureContext & { causeCode: CauseCode };
}

export interface AgentBrowserHost extends AttentionBrowserHost, BrowserUploadTarget {
  onChanged(listener: (tabs: BrowserTab[], activeTabId: string | null) => void): () => void;
  onControlChanged(listener: (state: BrowserControlState) => void): () => void;
  /**
   * Fires with the document ids a tab still has. A navigation drops the file input that justified a
   * staged upload, so `BrowserUploads` listens here to delete the copy it made.
   */
  onDocumentChanged(listener: (tabId: string, documentIds: ReadonlySet<string>) => void): () => void;
  clearControls(): void;
  endControl(threadId: string, turnId: string): void;
  /** Deleting an agent closes the tabs it owned, which nothing else can reach once it is gone. */
  close(tabId: string): Effect.Effect<void, BrowserOperationError>;
  /** Deleting an agent deletes the cookies and storage of its own browser session. */
  clearAgentSession(agentId: string): Effect.Effect<void, BrowserOperationError>;
  /** `onUserControl` gives the result of a call that reaches a held tab in the tab queue. */
  handleDynamicTool(
    params: DynamicToolCallParams,
    hooks?: BrowserDynamicToolHooks,
  ): Effect.Effect<DynamicToolResult, BrowserOperationError>;
  /** The tab of this browser tool call while the user controls it, or null. */
  userControlTabFor(params: DynamicToolCallParams): string | null;
  /** Ends when nobody controls the tab: a release, a tab close or the host shutdown. */
  awaitUserControlRelease(tabId: string): Effect.Effect<void>;
}

export interface TurnHooks {
  emitFailure?(failure: FailureSignal): void;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string, context?: FailureContext): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  /**
   * Takes a message from another agent into the recipient's running chat turn when the recipient's
   * busy-message mode is "steer". Otherwise the message waits in the queue.
   */
  steerAgentMessage(recipientAgentId: string, deliveryId: string): Effect.Effect<void>;
  /** Closes a provider session the provider refuses; the next turn opens a new one with the transcript. */
  dropRefusedSession(agentId: string, externalThreadId: string): Effect.Effect<void, TurnOperationFailed>;
  listAgents(): AgentSummary[];
  redactMcp(text: string): string;
  /** A finished tool step, for product analytics only. It never reaches a renderer or a remote client. */
  emitToolUsage(usage: ToolUsageSignal): void;
  /** The model this turn was started with, or null when the drain no longer knows it. */
  turnModel(agentId: string, turnId: string): string | null;
  /** Whether a provider error moves this agent to a backup model: it switches without asking and has a ready one. */
  mayFailOver(agentId: string): boolean;
  /**
   * Gives a channel task back to its channel's queue after a spent plan refused its turn. False
   * when the delivery is not an active channel assignment that can go back.
   */
  requeueChannelDelivery(deliveryId: string, continueWork?: boolean): Effect.Effect<boolean>;
  /**
   * Whether this delivery is a routine run that may end without a message: a scheduled run whose
   * agent answers only the no-update marker or calls the no-update tool.
   */
  quietRoutineDelivery(deliveryId: string): boolean;
  /** The task whose thread this is, or null for any other thread. */
  taskForThread(threadId: string): string | null;
  /** Whether this task's thread exists and is not archived. */
  taskOpen(taskId: string): boolean;
  /** The error of a task turn. It shows in the task's panel, not in the agent's own chat. */
  taskFailed(taskId: string, message: string): void;
  /**
   * The agent preview before the routine run of this delivery showed its task, and that task, once.
   * Null after a restart or for any other delivery.
   */
  takeRoutinePreview(deliveryId: string): { previous: string; shown: string } | null;
  /**
   * A turn of the agent's own chat (`sideThreadId` null) or of its side thread ended. `counts` is true
   * for a completed turn that a person started, and `memoryCommitted` when the agent changed its
   * memories in it.
   */
  conversationTurnEnded(
    agentId: string,
    sideThreadId: string | null,
    counts: boolean,
    memoryCommitted: boolean,
  ): Effect.Effect<void>;
  /** Whether the user stopped this turn, in the agent's own chat (`taskId` null) or in a task. */
  turnStopped(agentId: string, taskId: string | null, turnId: string): boolean;
  /** Whether the agent has an open wait for one of these deliveries. */
  hasOpenWait(agentId: string, deliveryIds: readonly string[]): boolean;
  /** Ends the provider session of a routine run. Nothing for any other session, or a second time. */
  closeRoutineSession(externalThreadId: string): Effect.Effect<void>;
  /** Gives the answer of a routine run in its own session to the session of the agent's chat. */
  routineAnswered(agentId: string, deliveryId: string, answer: string): Effect.Effect<void>;
  /** Attaches the files that a finished answer names by path to it. It never fails the turn. */
  attachAnswerFiles(
    agentId: string,
    snapshot: ConversationSnapshot,
    answer: ConversationSnapshot["messages"][number],
    paths: string[],
  ): Effect.Effect<void>;
}

export interface TurnLifecycleOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  memories: AgentMemories;
  attention: AttentionRegistry;
  browser: AgentBrowserHost;
  compaction: ContextCompaction;
  images: ImageGenRuntime;
  deltas: DeltaBuffer;
  usageLimits: UsageLimitGate;
  planContinuation: PlanContinuation;
  hooks: TurnHooks;
}

/**
 * Turn lifecycle: provider notifications in, settled conversation out.
 *
 * Owns the failed-turn, item→turn and turn-association maps. Streaming items
 * fan out to `ImageGenRuntime` (image generations) and `DeltaBuffer`
 * (message deltas); anything else becomes a conversation message here.
 * Completion settles deliveries, relays agent-to-agent results, and either
 * arms context compaction or schedules the next drain via hooks.
 */
export class TurnLifecycle {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #memories: AgentMemories;
  readonly #attention: AttentionRegistry;
  readonly #browser: AgentBrowserHost;
  readonly #compaction: ContextCompaction;
  readonly #images: ImageGenRuntime;
  readonly #deltas: DeltaBuffer;
  readonly #usageLimits: UsageLimitGate;
  readonly #planContinuation: PlanContinuation;
  readonly #hooks: TurnHooks;
  readonly fileHistory = new ThreadFileHistory();
  readonly #failedTurns = new Map<string, string>();
  readonly #observedCompactions = new Map<string, string>();
  readonly #itemTurns = new Map<string, string>();
  /** The real start and end of each step of a running turn, for the trace of the finished turn. */
  readonly #traces = new TurnTraces();
  #scope = Scope.makeUnsafe();
  readonly #turnAssociations = new Map<string, Deferred.Deferred<void, TurnOperationFailed>>();
  /**
   * The last error a provider reported for each running turn. The provider sends it just before
   * `turn/completed`, which carries only the status, so without this a failed delivery keeps no
   * reason once the banner that showed it is gone.
   */
  readonly #turnErrors = new Map<string, string>();
  /**
   * The client, provider thread and start time of each running turn, from its `turn/started`.
   * `produced` is set by the first item or delta: a refused turn is run again only without one.
   * `acted` is narrower: a tool step or answer text, which a turn run again would repeat. Thinking
   * and the echo of the user's message do not count. `sentAt` (when the message that started the
   * turn was sent) and `firstOutputAt` split a slow reply into OpenBot's wait and the provider's.
   */
  readonly #runningTurns = new Map<
    string,
    {
      client: AgentClient;
      agentId: string;
      threadId: string;
      startedAt: number;
      sentAt: number | null;
      firstOutputAt: number | null;
      produced: boolean;
      acted: boolean;
    }
  >();
  /** Running turns a provider plan refused, with the reset in epoch seconds when the provider gave it. */
  readonly #limitedTurns = new Map<string, number | null>();
  /**
   * Running turns that a provider error failed while their agent can move to a backup model, with
   * the error and its context. The end of the turn runs the turn again on the backup, or shows the error.
   */
  readonly #failoverTurns = new Map<string, HeldProviderError>();
  /**
   * The provider accounts and models (`UsageLimitGate.failureKey`) where a provider error failed each
   * delivery before it ran again, for one run again per key.
   */
  readonly #failoverRetries = new Map<string, Set<string>>();
  /** The deliveries run again after a refused session history. Each one gets a single retry. */
  readonly #refusedRetries = new Set<string>();
  /** Running turns whose agent called the no-update tool. The completion of the turn takes the entry. */
  readonly #noUpdateTurns = new Set<string>();
  /** Running turns whose agent reported that its routine run failed, with the reason. The completion takes it. */
  readonly #reportedFailures = new Map<string, string>();
  /**
   * The newest turns that ended. A provider can end a turn before the drain reads its `turn/start`
   * answer, and the drain must not then mark the turn active again. Past the cap, the oldest goes.
   */
  readonly #endedTurns = new Set<string>();
  /** Turns whose normal end runs now. A Stop must not settle one of them as an orphan (#2214). */
  readonly #completingTurns = new Set<string>();
  /**
   * The time of the last provider notification for each agent: a delta, a tool item, a usage
   * update. It is the only clock that moves while a turn works, and it is lost on restart.
   */
  readonly #lastEventAt = new Map<string, number>();

  constructor(options: TurnLifecycleOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#memories = options.memories;
    this.#attention = options.attention;
    this.#browser = options.browser;
    this.#compaction = options.compaction;
    this.#images = options.images;
    this.#deltas = options.deltas;
    this.#usageLimits = options.usageLimits;
    this.#planContinuation = options.planContinuation;
    this.#hooks = options.hooks;
  }

  failedTurns(): ReadonlyMap<string, string> {
    return this.#failedTurns;
  }

  forgetAgent(agentId: string): void {
    this.fileHistory.forgetAgent(agentId);
    this.#failedTurns.delete(agentId);
    this.#lastEventAt.delete(agentId);
  }

  /** When this running turn sent `turn/started`, in epoch milliseconds. Null for a turn that is not running. */
  turnStartedAt(turnId: string): number | null {
    return this.#runningTurns.get(turnId)?.startedAt ?? null;
  }

  /**
   * When the oldest of the running turns sent `turn/started`, in epoch milliseconds, or null while
   * no turn runs. A compaction turn does not count.
   */
  earliestRunningTurnStartedAt(): number | null {
    let earliest: number | null = null;
    for (const turn of this.#runningTurns.values()) earliest = Math.min(earliest ?? turn.startedAt, turn.startedAt);
    return earliest;
  }

  /** When the provider last reported anything for this agent since OpenBot started. */
  lastEventAt(agentId: string): number | null {
    return this.#lastEventAt.get(agentId) ?? null;
  }

  trackItem(itemId: string, turnId: string): void {
    this.#itemTurns.set(itemId, turnId);
  }

  acknowledgeFailedTurn(agentId: string, turnId: string): void {
    if (this.#failedTurns.get(agentId) !== turnId) return;
    this.#failedTurns.delete(agentId);
    this.#hooks.emitRuntimeSnapshot();
  }

  readonly dispose = Effect.fn("TurnLifecycle.dispose")(function* (this: TurnLifecycle) {
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
    this.fileHistory.clear();
    this.#failedTurns.clear();
    this.#turnAssociations.clear();
    this.#turnErrors.clear();
    this.#limitedTurns.clear();
    this.#failoverTurns.clear();
    this.#failoverRetries.clear();
    this.#runningTurns.clear();
    this.#noUpdateTurns.clear();
    this.#reportedFailures.clear();
    this.#endedTurns.clear();
    this.#refusedRetries.clear();
    this.#lastEventAt.clear();
    this.#itemTurns.clear();
    this.#traces.clear();
    this.#observedCompactions.clear();
  }).bind(this);

  /**
   * Ends each turn a client ran when the runtime stops it for a reason other than an exit: a
   * sign-out that an account refresh found, or a new client for the same provider. The stopped
   * process sends no `turn/completed` and `#handleExit` skips it, so without this its turns stay
   * active, and its deliveries running, until OpenBot restarts.
   *
   * `keepRecoverable` is for a client whose process exited. A turn with a message that is not settled
   * then stays for the delivery recovery, which reads the provider's history for its result and ends
   * the turn. A turn with no such message, such as one the CLI started by itself, has no other way
   * to end.
   */
  readonly interruptTurnsOf = Effect.fn("TurnLifecycle.interruptTurnsOf")(function* (
    this: TurnLifecycle,
    client: AgentClient,
    options: { keepRecoverable?: boolean } = {},
  ) {
    for (const [turnId, turn] of this.#runningTurns) {
      if (turn.client !== client) continue;
      this.#runningTurns.delete(turnId);
      // A routine run's own session saves no history, so its turn ends now and closes the session.
      if (
        options.keepRecoverable &&
        !this.#conversation.isRoutineSession(turn.threadId) &&
        this.#mailbox
          .findDeliveriesByTurn(turn.agentId, turnId)
          .some(({ delivery }) => delivery.status === "starting" || delivery.status === "running")
      ) {
        // The turn does not end here, so it keeps no trace.
        this.#traces.drop(turnId);
        // The client is gone, so no browser tool of this turn can run. Other agents keep their controls.
        this.#browser.endControl(this.#conversation.publicThreadId(turn.agentId, turn.threadId), turnId);
        // The turn does not end here, so a provider error held for a failover shows now.
        const failover = this.#failoverTurns.get(turnId);
        this.#failoverTurns.delete(turnId);
        if (failover) this.#showFailoverError(turn.agentId, turn.threadId, failover);
        continue;
      }
      this.#attention.clearForTurn(turn.threadId, turnId);
      if (this.#observedCompactions.get(turn.threadId) === turnId) this.#observedCompactions.delete(turn.threadId);
      this.#compaction.abandonCompaction(turn.threadId);
      yield* this.#completeTurn(turn.agentId, turn.threadId, turnId, "interrupted").pipe(
        Effect.catchCause((cause) =>
          reportOriginalFailure(cause, (failure) =>
            this.#hooks.emitError("turn_completion_failed", failure, turn.agentId),
          ),
        ),
      );
    }
  }).bind(this);

  hasEnded(turnId: string): boolean {
    return this.#endedTurns.has(turnId);
  }

  /** A turn id that starts again, as a requeued delivery's does, has not ended. */
  forgetEnded(turnId: string): void {
    this.#endedTurns.delete(turnId);
  }

  /** True while the normal end of this turn runs: it settles the turn itself. */
  isCompleting(turnId: string): boolean {
    return this.#completingTurns.has(turnId);
  }

  /** The task of a provider thread, or null for the agent's own chat and its other threads. */
  #taskForThread(agentId: string, externalThreadId: string): string | null {
    const threadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    return this.#conversation.isTaskThread(threadId) ? this.#hooks.taskForThread(threadId) : null;
  }

  /**
   * Whether a completed turn may continue its plan: it served only the user's or the agent's own
   * messages, the user did not stop it, it asked nothing, opened no wait and holds no question,
   * approval or takeover, and no other message waits in its lane.
   */
  #planContinues(
    agentId: string,
    taskId: string | null,
    turnId: string,
    deliveries: readonly DeliveryContext[],
    answer: string | undefined,
  ): boolean {
    if (deliveries.length === 0 || this.#planContinuation.limit <= 0) return false;
    if (
      !deliveries.every(
        ({ delivery, channelId }) =>
          channelId === undefined &&
          (delivery.sender.kind === "user" ||
            (delivery.sender.kind === "agent" && delivery.sender.agentId === agentId)),
      )
    )
      return false;
    // A question anywhere in the last line, so Markdown or a closing remark after it does not hide it.
    if (/[?？]/.test(answer?.trimEnd().split("\n").at(-1) ?? "")) return false;
    return (
      !this.#hooks.turnStopped(agentId, taskId, turnId) &&
      !this.#hooks.hasOpenWait(
        agentId,
        deliveries.map(({ delivery }) => delivery.id),
      ) &&
      !this.#attention.hasAttentionFor(agentId) &&
      this.#mailbox.laneQueuedIds(agentId, taskId).length === 0
    );
  }

  /** Shows a provider error that was held for a failover that did not happen, as it shows with no backup. */
  #showFailoverError(agentId: string, threadId: string, failover: HeldProviderError): void {
    const taskId = this.#taskForThread(agentId, threadId);
    if (taskId !== null) {
      this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
      this.#hooks.taskFailed(taskId, failover.message);
    } else this.#hooks.emitError("agent_error", failover.message, agentId, failover.context);
  }

  readonly handleNotification = Effect.fn("TurnLifecycle.handleNotification")(function* (
    this: TurnLifecycle,
    notification: AppServerNotification,
    source: AgentClient,
  ) {
    const params = notification.params;
    const threadId = getString(params, "threadId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    if (agentId) this.#lastEventAt.set(agentId, Date.now());

    if (
      threadId &&
      agentId &&
      ["turn/started", "thread/tokenUsage/updated", "openbot/usage", "model/rerouted"].includes(notification.method)
    ) {
      const agent = this.#store.list().find((entry) => entry.id === agentId);
      // A task or other side thread keeps its provider sessions under its own thread, not the agent's.
      // A routine run's own session is not saved, so its usage has its own session id.
      const session = agent
        ? (this.#store.database
            .listProviderSessions(this.#conversation.publicThreadId(agentId, threadId))
            .find((entry) => entry.externalSessionId === threadId && entry.provider === source.provider) ??
          (this.#conversation.isRoutineSession(threadId)
            ? { id: `routine:${threadId}`, provider: source.provider, createdAt: new Date().toISOString() }
            : undefined))
        : undefined;
      if (agent && session) {
        try {
          collectProviderUsage(this.#store.database.usage, agent, session, notification.method, params);
        } catch {
          this.#hooks.emitError("usage_collection_failed", new Error("Usage data could not be saved."), agentId);
        }
      }
    }

    switch (notification.method) {
      case "account/login/completed": {
        yield* this.#providers.completeCodexLogin(params, source, decodeAccountLoginCompletedResult);
        return;
      }
      case "turn/started": {
        if (!threadId || !agentId) return;
        const turn = getRecord(params, "turn");
        const turnId = getString(turn, "id");
        if (!turnId) return;
        if (this.#compaction.claimTurn(agentId, threadId, turnId)) return;
        this.#compaction.beginTurn(threadId);
        // The provider started this turn itself. A delivery that is starting now waits for its own turn.
        const unprompted = isRecord(params) && params.unprompted === true;
        // Each lane of the agent starts its own turns: a task turn takes only that task's delivery.
        const taskId = this.#taskForThread(agentId, threadId);
        const starting = unprompted ? undefined : this.#mailbox.startingDeliveryForAgent(agentId, taskId)?.delivery;
        const sentAt = starting ? Date.parse(starting.createdAt) : Number.NaN;
        this.#runningTurns.set(turnId, {
          client: source,
          agentId,
          threadId,
          startedAt: Date.now(),
          sentAt: Number.isFinite(sentAt) ? sentAt : null,
          firstOutputAt: null,
          produced: false,
          acted: false,
        });
        this.#traces.begin(turnId, new Date().toISOString());
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        snapshot.activeTurnId = turnId;
        if (taskId === null) this.#failedTurns.delete(agentId);
        const origin = starting?.sender.kind ?? "unknown";
        if (!unprompted) {
          const association = Deferred.makeUnsafe<void, TurnOperationFailed>();
          this.#turnAssociations.set(turnId, association);
          yield* Effect.gen({ self: this }, function* () {
            const exit = yield* Effect.exit(this.#associateStartedTurn(agentId, taskId, turnId, snapshot));
            yield* Deferred.done(association, exit);
            if (this.#turnAssociations.get(turnId) === association) this.#turnAssociations.delete(turnId);
          }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
        }
        this.#hooks.emit({ type: "turn-started", agentId, threadId: publicThreadId, turnId, origin });
        this.#conversation.emitConversation(snapshot, "turn.started", { turnId });
        return;
      }
      case "item/started":
      case "item/completed": {
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const item = getRecord(params, "item");
        if (!turnId || !item) return;
        this.fileHistory.record(
          agentId,
          this.#conversation.publicThreadId(agentId, threadId),
          getArray(params, "filePaths"),
        );
        const itemId = getString(item, "id");
        if (itemId) this.#itemTurns.set(itemId, turnId);
        this.#markProduced(turnId, isRepeatedWork(item));
        if (item.type === "contextCompaction") {
          if (this.#conversation.loadedClientFor(threadId) !== source) return;
          if (notification.method === "item/started") this.#observedCompactions.set(threadId, turnId);
          else this.#observedCompactions.delete(threadId);
          if (!this.#compaction.isCompactionTurn(threadId, turnId))
            this.#compaction.observeCompaction(
              threadId,
              notification.method === "item/completed" ? "completed" : "running",
            );
          if (notification.method === "item/completed") {
            this.#compaction.markCompacted(threadId);
          }
          return;
        }
        if (notification.method === "item/completed" && itemId) {
          this.#deltas.flush(`${threadId}:${turnId}:${itemId}`);
        }
        if (item.type === "collabAgentToolCall") this.#applyCodexSubagents(agentId, threadId, turnId, item);
        const threadItem = toThreadItem(item);
        if (!threadItem) return;
        yield* this.#applyItem(agentId, threadId, turnId, threadItem, notification.method === "item/completed");
        return;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryPartAdded":
      case "item/agentMessage/delta": {
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const itemId = getString(params, "itemId");
        const delta = notification.method === "item/reasoning/summaryPartAdded" ? "\n\n" : getString(params, "delta");
        if (!turnId || !itemId || delta === null) return;
        this.#itemTurns.set(itemId, turnId);
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        let message = snapshot.messages.find((candidate) => candidate.id === itemId);
        if (!message) {
          message = newAssistantMessage(itemId, turnId);
          snapshot.messages.push(message);
        }
        // Claude streams its thinking as message deltas on a commentary item, which is not an answer.
        this.#markProduced(
          turnId,
          notification.method === "item/agentMessage/delta" && delta.trim() !== "" && message.itemType !== "commentary",
          delta.trim() !== "",
        );
        // A delta can come before its `item/started`, so it can start the step.
        this.#traces.observe(
          turnId,
          itemId,
          notification.method.startsWith("item/reasoning/") || message.itemType === "commentary"
            ? "reasoning"
            : "message",
          { completed: false },
        );
        if (notification.method.startsWith("item/reasoning/")) {
          if (message.itemType !== "commentary") {
            message.itemType = "commentary";
            this.#conversation.emitConversation(snapshot);
          }
          if (notification.method === "item/reasoning/summaryPartAdded" && !message.text) return;
        }
        message.text += delta;
        message.status = "streaming";
        this.#deltas.buffer({
          agentId,
          externalThreadId: threadId,
          publicThreadId,
          turnId,
          messageId: itemId,
          text: delta,
          createdAt: message.createdAt,
        });
        return;
      }
      case PLAN_UPDATED_METHOD: {
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const plan = planFromNotification(params);
        // A plan for a turn that is not running has no row to update, so it is dropped.
        if (!turnId || !this.#runningTurns.has(turnId)) return;
        if (plan) this.#applyPlan(agentId, threadId, turnId, plan);
        // An empty list removes the turn's plan: the agent deleted its last task.
        else if (isRecord(params) && Array.isArray(params.plan)) this.#clearPlan(agentId, threadId, turnId);
        return;
      }
      case SUBAGENTS_UPDATED_METHOD: {
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const subagents = subagentsFromNotification(params);
        if (turnId && subagents) this.#applySubagents(agentId, threadId, turnId, subagents);
        return;
      }
      case "turn/completed": {
        if (!threadId || !agentId) return;
        const turn = getRecord(params, "turn");
        const turnId = getString(turn, "id");
        if (!turnId) return;
        const status = getString(turn, "status") ?? "completed";
        if (status === "failed" && !this.#turnErrors.has(turnId)) {
          this.#hooks.emitFailure?.({
            code: "agent_error",
            agentId,
            turnId,
            provider: source.provider,
            model: this.#hooks.turnModel(agentId, turnId),
            causeCode: classifyFailure(getRecord(turn, "error")),
          });
        }
        this.#attention.clearForTurn(threadId, turnId);
        if (this.#observedCompactions.get(threadId) === turnId) {
          this.#observedCompactions.delete(threadId);
          this.#compaction.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
        }
        this.#compaction.threadTurnEnded(threadId);
        if (this.#compaction.isCompactionTurn(threadId, turnId)) {
          this.#compaction.finish(agentId, threadId, status);
          return;
        }
        // A defect too: this fiber has no other handler, and the turn is settled by then.
        yield* this.#completeTurn(agentId, threadId, turnId, status).pipe(
          Effect.catchCause((cause) =>
            reportOriginalFailure(cause, (failure) =>
              this.#hooks.emitError("turn_completion_failed", failure, agentId),
            ),
          ),
        );
        return;
      }
      case "thread/tokenUsage/updated": {
        if (!threadId || !agentId) return;
        if (this.#conversation.loadedClientFor(threadId) !== source) return;
        this.#compaction.updateBudget(threadId, params);
        const usage = getRecord(params, "tokenUsage");
        const last = getRecord(usage, "last");
        if (typeof last?.totalTokens === "number" && typeof usage?.modelContextWindow === "number")
          this.#compaction.observeUsage(
            threadId,
            last.totalTokens,
            usage.modelContextWindow,
            source.contextCompaction === "native",
            compactsOnRequest(source.contextCompaction) ? 0.8 : null,
            usage.estimated === true,
            isAgentContextCategories(usage.categories) ? usage.categories : undefined,
          );
        return;
      }
      case "openbot/context-compaction": {
        if (!threadId || !agentId || this.#conversation.loadedClientFor(threadId) !== source) return;
        const status = getString(params, "status");
        if (status !== "running" && status !== "completed" && status !== "failed") return;
        // Native Claude compaction does not report comparable full-context counts.
        this.#compaction.observeCompaction(threadId, status, "none");
        return;
      }
      case "thread/archived": {
        if (threadId && this.#conversation.loadedClientFor(threadId) === source)
          this.#conversation.unloadThread(threadId);
        return;
      }
      case "account/rateLimits/updated": {
        this.#providers.applyPushedUsage(source, params);
        return;
      }
      case USAGE_LIMIT_METHOD: {
        const turnId = getString(params, "turnId");
        const resetsAt = isRecord(params) && typeof params.resetsAt === "number" ? params.resetsAt : null;
        if (turnId && this.#runningTurns.has(turnId)) this.#limitedTurns.set(turnId, resetsAt);
        return;
      }
      case "error":
      case "warning": {
        // A notification that carries no `message` says only that something went wrong. The method
        // name used to stand in for it, which put the bare word "error" in front of the user as if
        // it were the report. An empty text lets the renderer's own sentence take its place; the
        // `code` still carries the method for the log.
        // Codex nests the report as `{ error: { message, codexErrorInfo }, willRetry }`; the other
        // clients send a flat `message`. Reading only the flat field turned every Codex failure,
        // an exhausted plan included, into the renderer's generic sentence under the usage notice.
        const error = getRecord(params, "error");
        const message = getString(params, "message") ?? getString(error, "message") ?? "";
        if (notification.method === "warning" && isNonActionableCodexWarning(message)) {
          // No banner, but the log keeps the reason, such as a closed WebSocket.
          logger.info("A provider warning needs no action.", {
            provider: source.provider,
            message: this.#hooks.redactMcp(message),
          });
          return;
        }
        // Codex retries on its own and reports the final failure again without `willRetry`.
        if (isRecord(params) && params.willRetry === true) return;
        // A usage limit shows no banner, but the failed delivery still keeps it as the reason.
        const errorTurnId = getString(params, "turnId");
        if (notification.method === "error" && errorTurnId && this.#runningTurns.has(errorTurnId)) {
          this.#turnErrors.set(errorTurnId, message);
          // The turn's completion runs it again or reports it in words the user can act on.
          if (refusedSessionFailure(source.provider, message) !== null) return;
        }
        // A spent quota or balance is explained by the usage notice, so only a provider that reports
        // usage can leave it out of the banner. Gemini's 429 reads as a spent quota, and it failed
        // with nothing on screen; Gemini keeps the banner, because an API key sign-in, a runtime
        // before 1.4.1 and a Claude or GPT model have no reading. Cursor keeps it too: an on-demand
        // budget and a team limit are not in its reading. OpenCode keeps it because only a Go key
        // has a reading, and the free models failed with nothing on screen. A plan window holds the
        // queue until its reset for every provider.
        if (
          error?.codexErrorInfo === "usageLimitExceeded" ||
          (isUsageLimitDiagnostic(message) &&
            ((source.provider !== "antigravity" &&
              source.provider !== "cursor" &&
              source.provider !== "opencode" &&
              agentProviderDescriptor(source.provider).reportsUsage) ||
              isPlanLimitDiagnostic(message))) ||
          (errorTurnId !== null && this.#limitedTurns.has(errorTurnId))
        ) {
          // Only a plan window resets by itself. A spent balance fails as before, with its reason.
          const planLimit =
            isPlanLimitDiagnostic(message) ||
            (error?.codexErrorInfo === "usageLimitExceeded" && !isBalanceDiagnostic(message));
          if (planLimit && notification.method === "error" && errorTurnId && this.#runningTurns.has(errorTurnId)) {
            this.#limitedTurns.set(errorTurnId, this.#limitedTurns.get(errorTurnId) ?? null);
          }
          this.#hooks.emitFailure?.({
            code: "agent_error",
            ...(agentId !== undefined ? { agentId } : {}),
            turnId: errorTurnId,
            provider: source.provider,
            model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
            causeCode: classifyFailure(error ?? message),
            severity: notification.method === "warning" ? "warning" : "error",
          });
          yield* this.#providers.refreshUsageAfterLimit(source);
          return;
        }
        const context = {
          causeCode: classifyFailure(error ?? message),
          provider: source.provider,
          model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
          turnId: errorTurnId,
          severity: notification.method === "warning" ? ("warning" as const) : ("error" as const),
        };
        // A provider error moves an agent set to switch without asking to its next backup model. The
        // error waits for the end of the turn: a turn that did nothing yet runs again there instead.
        if (
          notification.method === "error" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          FAILOVER_CAUSES.has(context.causeCode) &&
          this.#hooks.mayFailOver(agentId)
        ) {
          this.#failoverTurns.set(errorTurnId, { message, context });
          return;
        }
        const taskId =
          notification.method === "error" && agentId && threadId ? this.#taskForThread(agentId, threadId) : null;
        if (taskId !== null) {
          this.#hooks.emitFailure?.({ code: "agent_error", ...(agentId ? { agentId } : {}), ...context });
          this.#hooks.taskFailed(taskId, message);
        } else this.#hooks.emitError(`agent_${notification.method}`, message, agentId, context);
      }
    }
  }).bind(this);

  /**
   * Records a call to the no-update tool. `quiet` when the turn runs only quiet routine runs, so
   * its completion keeps the text answers as quiet answers; `shown` when a person waits for the answer, as in a Test
   * run; null when no routine run started the turn. The completion decides again, because a message
   * can join the turn after the call.
   */
  requestNoUpdate(agentId: string, threadId: string, turnId: string): "quiet" | "shown" | null {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!deliveries.some(({ delivery }) => delivery.sender.kind === "routine")) return null;
    this.#noUpdateTurns.add(turnId);
    // A failed run is never quiet, so its answer must still be written.
    if (this.#reportedFailures.has(turnId)) return "shown";
    return this.#quietRoutineTurn(threadId, deliveries) ? "quiet" : "shown";
  }

  /**
   * Records a call to the failure tool; the latest reason wins. False when no routine run started the
   * turn. A flow handoff counts: its call fails that step only, because a handoff has no run of its own.
   */
  reportRoutineFailure(agentId: string, turnId: string, reason: string): boolean {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!deliveries.some(({ delivery }) => delivery.sender.kind === "routine")) return false;
    this.#reportedFailures.set(turnId, reason);
    return true;
  }

  /** Only a turn that runs nothing but quiet routine runs, outside a channel or messaging thread. */
  #quietRoutineTurn(threadId: string | null, deliveries: readonly DeliveryContext[]): boolean {
    return (
      deliveries.length > 0 &&
      !this.#conversation.isExecutionThread(threadId) &&
      deliveries.every(
        ({ delivery }) => delivery.sender.kind === "routine" && this.#hooks.quietRoutineDelivery(delivery.id),
      )
    );
  }

  readonly #completeTurn = Effect.fn("TurnLifecycle.completeTurn")(
    function* (this: TurnLifecycle, agentId: string, threadId: string, turnId: string, status: string) {
      const running = this.#runningTurns.get(turnId);
      this.#runningTurns.delete(turnId);
      this.#markEnded(turnId);
      this.#completingTurns.add(turnId);
      // A turn that runs again below starts a new trace, so each path takes this one.
      const trace = this.#traces.take(turnId, new Date().toISOString());
      const noUpdateCalled = this.#noUpdateTurns.delete(turnId);
      const reportedFailure = this.#reportedFailures.get(turnId);
      this.#reportedFailures.delete(turnId);
      if (running) {
        // `waitMs` is OpenBot's part of a slow reply: the queue (a usage-limit hold included), the
        // provider start, the session and its settings. `firstOutputMs` is the provider's: the time
        // to its first text, thinking or tool step.
        logger.info("A turn finished.", {
          provider: running.client.provider,
          model: this.#hooks.turnModel(agentId, turnId),
          status,
          waitMs: running.sentAt === null ? null : Math.max(0, running.startedAt - running.sentAt),
          firstOutputMs: running.firstOutputAt === null ? null : running.firstOutputAt - running.startedAt,
          durationMs: Date.now() - running.startedAt,
        });
      }
      const reportedError = this.#turnErrors.get(turnId);
      this.#turnErrors.delete(turnId);
      // The error is kept only while the turn runs, so a refused turn always has its entry.
      const refusedFailure =
        running !== undefined && status === "failed" && reportedError !== undefined
          ? refusedSessionFailure(running.client.provider, reportedError)
          : null;
      const refused = running !== undefined && refusedFailure !== null;
      const limited = status === "failed" && this.#limitedTurns.has(turnId);
      const resetsAt = this.#limitedTurns.get(turnId) ?? null;
      this.#limitedTurns.delete(turnId);
      const failover = this.#failoverTurns.get(turnId);
      this.#failoverTurns.delete(turnId);
      this.#deltas.flushTurn(turnId);
      yield* this.#images.waitForOperations(threadId, turnId);
      const association = this.#turnAssociations.get(turnId);
      if (association) yield* Deferred.await(association).pipe(Effect.catch(() => Effect.void));
      const memoryChanges = this.#memories.finishTurn(turnId, status).get(agentId) ?? [];
      // A refused session is closed below, and a spent plan would refuse the summary turn too, so
      // neither is compacted.
      // A routine run's own session closes after this turn, so it is not compacted either. Nor is a
      // turn that a provider error ended before it did work: it can run again on a backup model.
      const routineSession = this.#conversation.isRoutineSession(threadId);
      const mayRunAgain =
        failover !== undefined && !limited && status === "failed" && running !== undefined && !running.acted;
      const shouldCompact =
        !refused && !limited && !mayRunAgain && !routineSession && this.#compaction.reserve(agentId, threadId);
      this.#browser.endControl(this.#conversation.publicThreadId(agentId, threadId), turnId);
      const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
      snapshot.activeTurnId = null;
      const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
      // A task turn ends as a turn of the agent's own chat does, in the task's own lane.
      const taskTurn = this.#conversation.isTaskThread(snapshot.threadId);
      // A channel task is not run again: an unfinished turn pauses it, and its Resume opens the new session.
      const retry =
        refused &&
        !running.produced &&
        deliveries.length > 0 &&
        (taskTurn || !this.#conversation.isExecutionThread(snapshot.threadId)) &&
        deliveries.every(({ delivery }) => !this.#refusedRetries.has(delivery.id));
      if (retry) {
        yield* this.#retryRefusedTurn(agentId, threadId, turnId, snapshot, deliveries);
        return;
      }
      const channelTurn = !taskTurn && this.#conversation.isExecutionThread(snapshot.threadId);
      // After work started, only a ready automatic backup continues it. A turn refused before
      // work still waits for the reset when no backup is ready. A continuation that a backup refused
      // before work keeps the earlier provider's work.
      const carriesWork =
        running !== undefined &&
        (running.acted || deliveries.some((context) => context.resumeAfterUsageLimit !== undefined));
      let continuing = limited && carriesWork && deliveries.length > 0 && this.#hooks.mayFailOver(agentId);
      if (continuing) {
        for (const { delivery, channelId } of deliveries) {
          if (channelId && !(yield* this.#hooks.requeueChannelDelivery(delivery.id, true))) {
            continuing = false;
            break;
          }
        }
      }
      const repeatable = limited && running !== undefined && (!running.acted || continuing) && deliveries.length > 0;
      const requeue = repeatable && (!channelTurn || continuing);
      // The limit belongs to the model the turn ran on, which the agent may have left since.
      const model = this.#hooks.turnModel(agentId, turnId);
      // The same for a provider error, when the agent moves to a backup model. Only the agent's own
      // chat moves it: a task or a channel task fails as before. A message runs again once for each
      // provider account and model that failed it, so a move that does not happen cannot run it on
      // the same one again.
      const failedKey = this.#usageLimits.failureKey(agentId, model);
      const failedOver =
        mayRunAgain &&
        failedKey !== null &&
        deliveries.length > 0 &&
        !taskTurn &&
        !channelTurn &&
        deliveries.every(({ delivery }) => !this.#failoverRetries.get(delivery.id)?.has(failedKey)) &&
        this.#hooks.mayFailOver(agentId);
      // A foreground subagent ends with its turn. A background one works on and reports later.
      const subagents = snapshot.messages.find((message) => message.id === `${turnId}:subagents`);
      stopRunningSubagents(subagents?.subagents, new Date().toISOString(), { background: false });
      for (const message of snapshot.messages) {
        if (this.#itemTurns.get(message.id) !== turnId || message.status !== "streaming") continue;
        message.status = normalizeCompletionStatus(repeatable || failedOver ? "interrupted" : status);
        markIncompleteImageGeneration(message, message.status);
      }
      // Only this loop reads the map, so the finished turn's items go, or it holds every item ever seen.
      for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
      if (requeue) {
        const workSteps =
          continuing && running
            ? yield* readCapturedSteps(running.client, threadId, turnId).pipe(
                Effect.timeout("2 seconds"),
                Effect.map((steps) => steps.get(turnId) ?? ""),
                Effect.catch((error) =>
                  Effect.sync(() => {
                    logger.warn("Could not read the interrupted turn's work steps.", { error });
                    return "";
                  }),
                ),
              )
            : "";
        if (continuing && trace) this.#attachTrace(snapshot.messages, agentId, turnId, trace);
        const traceSteps =
          continuing && trace
            ? trace.steps
                .filter((step) => step.kind === "tool")
                .map(
                  (step) =>
                    `${step.command ?? step.text ?? "tool"} (${step.endedAt === null ? "interrupted" : step.failed ? "failed" : "completed"})`,
                )
                .join("\n")
            : "";
        yield* this.#requeueTurn(
          agentId,
          threadId,
          turnId,
          snapshot,
          deliveries,
          continuing
            ? {
                turnId,
                previousTurnIds: [turnId],
                workSteps: this.#hooks.redactMcp(
                  workSteps ||
                    (traceSteps ? `Full tool results are unavailable. Verify the saved work.\n${traceSteps}` : ""),
                ),
              }
            : undefined,
        );
        // After the requeue, so a routine set to skip finds its run back in the queue.
        yield* this.#usageLimits.reached(agentId, resetsAt, model);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      if (failover && failedOver && failedKey !== null) {
        this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
        for (const { delivery } of deliveries) {
          const failed = this.#failoverRetries.get(delivery.id) ?? new Set<string>();
          this.#failoverRetries.set(delivery.id, failed.add(failedKey));
        }
        yield* this.#requeueTurn(agentId, threadId, turnId, snapshot, deliveries);
        this.#usageLimits.failed(agentId, model);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      // The turn did work, or nothing waits to run again: the error shows as it does with no backup.
      if (failover) this.#showFailoverError(agentId, threadId, failover);
      if (limited) yield* this.#usageLimits.reached(agentId, resetsAt, model);
      else if (status === "completed") yield* this.#usageLimits.completed(agentId, model);
      // After the limit is recorded, so the channel does not assign the task to this agent again
      // before the reset. A channel that took the task back ends this turn as interrupted.
      let requeued = repeatable && channelTurn;
      for (const { delivery } of requeued ? deliveries : []) {
        if (yield* this.#hooks.requeueChannelDelivery(delivery.id)) continue;
        requeued = false;
        break;
      }
      const outcome = requeued ? "interrupted" : status;
      // The failed turn of the agent's own chat only: a task shows its outcome in its own row.
      if (!taskTurn && outcome === "failed") this.#failedTurns.set(agentId, turnId);
      else if (!taskTurn) this.#failedTurns.delete(agentId);
      const failure = refusedFailure ?? reportedError;
      if (refused) {
        yield* this.#hooks.dropRefusedSession(agentId, threadId);
        const taskId = taskTurn ? this.#taskForThread(agentId, threadId) : null;
        if (taskId !== null && failure !== undefined) {
          this.#hooks.emitFailure?.({ code: "agent_error", agentId, causeCode: classifyFailure(failure) });
          this.#hooks.taskFailed(taskId, failure);
        } else this.#hooks.emitError("agent_error", failure, agentId);
      }
      if (deliveries.some((delivery) => delivery.delivery.sender.kind === "agent")) {
        dropPlaceholderAnswers(snapshot, turnId);
      }
      // Only a turn that ran nothing but scheduled, script or webhook runs: a person who wrote in the
      // same turn, or who started a Test run, waits for the answer. A failed run is never quiet.
      const quiet =
        outcome === "completed" &&
        reportedFailure === undefined &&
        this.#quietRoutineTurn(snapshot.threadId, deliveries) &&
        settleQuietRoutineTurn(snapshot, turnId, noUpdateCalled);
      const latestAssistant = latestTurnAnswer(snapshot.messages, turnId);
      // A routine run that answered only the no-update marker, also a Test run that shows it in the
      // chat, does not put the marker in the preview.
      const markerAnswer =
        latestAssistant !== undefined &&
        deliveries.some(({ delivery }) => delivery.sender.kind === "routine") &&
        isNoUpdateAnswer(latestAssistant.text);
      // Before the deliveries end: until then they hold the chat's lane, so no turn of the chat
      // starts before the digest is in its handoff.
      const routineDelivery = deliveries[0]?.delivery.id;
      if (routineSession && routineDelivery && outcome === "completed" && !quiet && !markerAnswer && latestAssistant)
        yield* this.#hooks.routineAnswered(agentId, routineDelivery, latestAssistant.text);
      const laneTaskId = taskTurn ? this.#taskForThread(agentId, threadId) : null;
      const planContinues =
        outcome === "completed" &&
        reportedFailure === undefined &&
        running !== undefined &&
        !channelTurn &&
        !routineSession &&
        (!taskTurn || laneTaskId !== null) &&
        this.#planContinues(agentId, laneTaskId, turnId, deliveries, latestAssistant?.text);
      const continuation = planContinues
        ? this.#planContinuation.consider({
            agentId,
            taskId: laneTaskId,
            deliveryIds: deliveries.map(({ delivery }) => delivery.id),
            plan: snapshot.messages.find((message) => message.id === `${turnId}:plan`)?.plan ?? null,
            earlierPlan:
              snapshot.messages.findLast(
                (message) => message.itemType === CONVERSATION_PLAN_ITEM_TYPE && message.turnId !== turnId,
              )?.plan ?? null,
          })
        : null;
      if (!continuation) this.#planContinuation.cancel(agentId, laneTaskId);
      if (deliveries.length > 0) {
        const terminal = outcome === "failed" ? "failed" : outcome === "interrupted" ? "interrupted" : "completed";
        for (const delivery of deliveries) {
          this.#refusedRetries.delete(delivery.delivery.id);
          this.#failoverRetries.delete(delivery.delivery.id);
          // A plan that continues keeps the deliveries for its next turn, which the drain starts.
          if (continuation) {
            yield* this.#mailbox.requeueForPlan(delivery.delivery.id, turnId).pipe(toTurnOperationFailed);
            continue;
          }
          // A reported failure leaves the delivery completed, since the agent did answer; its run ends failed.
          const reason =
            terminal === "failed" && failure
              ? this.#hooks.redactMcp(failure)
              : terminal === "completed" && reportedFailure !== undefined && delivery.delivery.sender.kind === "routine"
                ? this.#hooks.redactMcp(reportedFailure)
                : null;
          yield* this.#mailbox.markTerminal(delivery.delivery.id, terminal, reason).pipe(toTurnOperationFailed);
          this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.delivery.id);
        }
        // A turn can start with the answers of several teammates. `#relayAgentResult` skips each one
        // that wants no answer, so only a teammate that asked for a result gets one.
        if (
          !continuation &&
          !this.#conversation.isExecutionThread(snapshot.threadId) &&
          terminal === "completed" &&
          latestAssistant
        ) {
          for (const delivery of deliveries)
            yield* this.#relayAgentResult(agentId, turnId, delivery, latestAssistant.text);
        }
        // The requester holds the answers of the other teammates until each request has ended, so
        // this end can release them, also when this turn failed and sends no result.
        for (const { delivery } of deliveries) {
          if (delivery.sender.kind === "agent") this.#hooks.scheduleDrain(delivery.sender.agentId);
        }
      }
      // Each run start saved the earlier preview; a quiet turn puts back the oldest one, unless
      // something else changed the preview since. Every turn takes its entries, so none stays behind.
      const savedPreviews = deliveries.flatMap(({ delivery }) =>
        delivery.sender.kind === "routine" ? (this.#hooks.takeRoutinePreview(delivery.id) ?? []) : [],
      );
      if (latestAssistant && !markerAnswer && !this.#conversation.isExecutionThread(snapshot.threadId)) {
        yield* this.#store.updatePreview(agentId, latestAssistant.text).pipe(toTurnOperationFailed);
        this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
      } else if (quiet || (markerAnswer && !this.#conversation.isExecutionThread(snapshot.threadId))) {
        const saved = savedPreviews[0];
        const current = this.#store.list().find((entry) => entry.id === agentId)?.preview;
        if (saved && current === savedPreviews.at(-1)?.shown) {
          yield* this.#store.updatePreview(agentId, saved.previous).pipe(toTurnOperationFailed);
          this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
        }
      }
      if (outcome === "completed" && latestAssistant && !quiet && !markerAnswer) {
        const paths = answerFilePaths(latestAssistant.text);
        if (paths.length > 0) yield* this.#hooks.attachAnswerFiles(agentId, snapshot, latestAssistant, paths);
      }
      if (trace) this.#attachTrace(snapshot.messages, agentId, turnId, trace);
      const memoryLine = memoryChangesMessage(turnId, memoryChanges, (text) => this.#hooks.redactMcp(text));
      if (memoryLine) snapshot.messages.push(memoryLine);
      if (continuation) {
        // No `turnId`: inside the turn, a system row sorts before the answer. Alone, the line shows
        // after this turn's answer and before the continuation turn.
        snapshot.messages.push({
          id: `${turnId}:plan-continuation`,
          author: "system",
          source: "system",
          status: "completed",
          createdAt: new Date().toISOString(),
          itemType: PLAN_CONTINUATION_ITEM_TYPE,
          text: sourceText("status.agent.planContinues", {
            current: continuation.count,
            limit: this.#planContinuation.limit,
          }),
        });
      }
      this.#conversation.emitConversation(snapshot, "turn.completed", { turnId, status: outcome });
      if (deliveries.length > 0) {
        try {
          this.#mailboxSync.emitQueue(agentId);
        } catch (error) {
          this.#hooks.emitError("delivery_reconciliation_pending", error, agentId);
          this.#mailboxSync.retryDeliveryReconciliation(agentId);
        }
      }
      this.#hooks.emit({
        type: "turn-completed",
        agentId,
        threadId: this.#conversation.publicThreadId(agentId, threadId),
        turnId,
        status: outcome,
        origin: deliveries[0]?.delivery.sender.kind ?? "unknown",
        ...(quiet ? { quiet: true as const } : {}),
        ...(continuation ? { continues: true as const } : {}),
      });
      if (!channelTurn && !routineSession) {
        // An automatic continuation is part of the turn that the person started, so it counts once.
        const counts =
          outcome === "completed" &&
          !quiet &&
          !continuation &&
          deliveries.every(({ delivery }) => delivery.sender.kind !== "routine");
        const memoryCommitted = memoryChanges.some((change) => change.action !== "notChanged");
        const sideThreadId = taskTurn ? snapshot.threadId : null;
        yield* this.#hooks.conversationTurnEnded(agentId, sideThreadId, counts, memoryCommitted);
      }
      if (shouldCompact) yield* this.#compaction.request(agentId, threadId);
      else this.#hooks.scheduleDrain(agentId);
    },
    Effect.uninterruptible,
    (completion, agentId, threadId, turnId, status) =>
      // The turn is already out of `#runningTurns`, so a step above that fails must not leave its
      // deliveries running: nothing else would end them, and the agent's queue would wait (#2214).
      completion.pipe(
        Effect.onError((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : this.settleOrphanedTurn(agentId, threadId, turnId, status === "failed" ? "failed" : "interrupted"),
        ),
        Effect.ensuring(
          Effect.andThen(
            Effect.sync(() => this.#completingTurns.delete(turnId)),
            this.#hooks.closeRoutineSession(threadId),
          ),
        ),
      ),
  );

  /**
   * Ends a turn that its normal end did not settle: a completion that failed part way, or a Stop for a
   * turn that no provider runs any more (#2214). Each delivery of the turn that is still starting or
   * running ends as `terminal`, the cached and stored turn close, and the agent's queue drains again.
   * Each step reports its own failure, and the steps after it still run.
   */
  readonly settleOrphanedTurn = Effect.fn("TurnLifecycle.settleOrphanedTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string | null,
    turnId: string,
    terminal: "failed" | "interrupted",
  ) {
    const report = (cause: Cause.Cause<TurnOperationFailed>) =>
      reportOriginalFailure(cause, (failure) => this.#hooks.emitError("turn_completion_failed", failure, agentId));
    const runningThreadId = this.#runningTurns.get(turnId)?.threadId ?? threadId;
    this.#runningTurns.delete(turnId);
    this.#reportedFailures.delete(turnId);
    this.#markEnded(turnId);
    const trace = this.#traces.take(turnId, new Date().toISOString());
    const deliveries = yield* turnStep(() => this.#mailbox.findDeliveriesByTurn(agentId, turnId)).pipe(
      Effect.catchCause((cause) => report(cause).pipe(Effect.as([]))),
    );
    for (const { delivery } of deliveries) {
      yield* this.#mailbox
        .markTerminal(delivery.id, terminal, null)
        .pipe(toTurnOperationFailed, Effect.catchCause(report));
    }
    const owner = this.#conversation.snapshotWithTurn(agentId, turnId);
    yield* turnStep(() => {
      // With no open delivery and no snapshot on the turn, the turn is still open only when the normal
      // end failed after it settled the deliveries and before it saved the conversation.
      if (
        !owner &&
        deliveries.length === 0 &&
        (threadId === null ||
          this.#store.database.readActiveTurnId(agentId, this.#conversation.publicThreadId(agentId, threadId)) !==
            turnId)
      )
        return;
      const snapshot = owner ?? this.#conversation.ensureSnapshot(agentId, threadId);
      const publicThreadId = snapshot.threadId;
      if (!publicThreadId) return;
      const closed = structuredClone(snapshot);
      const changedIds = new Set<string>();
      const status = normalizeCompletionStatus(terminal);
      const now = new Date().toISOString();
      for (const message of closed.messages) {
        if (message.status !== "streaming") continue;
        if (message.turnId !== turnId && this.#itemTurns.get(message.id) !== turnId) continue;
        // As at the normal end, a foreground subagent ends with its turn.
        stopRunningSubagents(message.subagents, now, { background: false });
        message.status = status;
        markIncompleteImageGeneration(message, status);
        changedIds.add(message.id);
      }
      for (const { delivery } of deliveries) {
        this.#mailboxSync.syncDeliveryMessage(closed, delivery.id);
        changedIds.add(delivery.id);
      }
      const traced = trace && this.#attachTrace(closed.messages, agentId, turnId, trace);
      if (traced) changedIds.add(traced.id);
      if (closed.activeTurnId === turnId) closed.activeTurnId = null;
      closed.revision = this.#store.database.persistConversationChanges({
        agentId,
        threadId: publicThreadId,
        activeTurnId: closed.activeTurnId,
        changedMessages: closed.messages.filter((message) => changedIds.has(message.id)),
        eventType: "turn.completed",
        detail: { turnId, status: terminal },
      });
      // Clear the cached turn before queue listeners can read or change the agent.
      this.#conversation.setSnapshot(agentId, closed);
      this.#conversation.publishConversation(closed);
      this.#hooks.emit({
        type: "turn-completed",
        agentId,
        threadId: publicThreadId,
        turnId,
        status: terminal,
        origin: deliveries[0]?.delivery.sender.kind ?? "unknown",
      });
    }).pipe(Effect.catchCause(report));
    for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
    // A routine run's own session ends with its turn. A task or channel turn runs in another session.
    if (runningThreadId && this.#conversation.isRoutineSession(runningThreadId))
      yield* this.#hooks.closeRoutineSession(runningThreadId);
    yield* turnStep(() => this.#mailboxSync.emitQueue(agentId)).pipe(Effect.catchCause(report));
    yield* turnStep(() => {
      for (const { delivery } of deliveries) {
        if (delivery.sender.kind === "agent") this.#hooks.scheduleDrain(delivery.sender.agentId);
      }
      this.#hooks.scheduleDrain(agentId);
    }).pipe(Effect.catchCause(report));
  }, Effect.uninterruptible);

  #markEnded(turnId: string): void {
    this.#endedTurns.add(turnId);
    if (this.#endedTurns.size > ENDED_TURN_LIMIT) {
      const [oldest] = this.#endedTurns;
      if (oldest !== undefined) this.#endedTurns.delete(oldest);
    }
  }

  /**
   * Queues the deliveries of a turn once more, after the provider refused the session's history.
   * The refusal answers the first request of the turn, before the model did any work, so the new
   * session repeats nothing. The turn ends as interrupted, which no one is told of as a failure,
   * and the queued delivery starts again at once.
   */
  readonly #retryRefusedTurn = Effect.fn("TurnLifecycle.retryRefusedTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    snapshot: ConversationSnapshot,
    deliveries: readonly DeliveryContext[],
  ) {
    for (const { delivery } of deliveries) this.#refusedRetries.add(delivery.id);
    yield* this.#requeueTurn(agentId, threadId, turnId, snapshot, deliveries);
    yield* this.#hooks.dropRefusedSession(agentId, threadId);
    this.#hooks.scheduleDrain(agentId);
  }, Effect.uninterruptible);

  /** Queues refused or unfinished deliveries, retaining the continuation across provider switches and restarts. */
  readonly #requeueTurn = Effect.fn("TurnLifecycle.requeueTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    snapshot: ConversationSnapshot,
    deliveries: readonly DeliveryContext[],
    resumeAfterUsageLimit?: UsageLimitContinuation,
  ) {
    for (const context of deliveries) {
      const { delivery } = context;
      const continuation = resumeAfterUsageLimit
        ? {
            ...resumeAfterUsageLimit,
            previousTurnIds: [
              ...new Set([
                ...(context.resumeAfterUsageLimit?.previousTurnIds ?? []),
                ...resumeAfterUsageLimit.previousTurnIds,
              ]),
            ],
            workSteps: [context.resumeAfterUsageLimit?.workSteps, resumeAfterUsageLimit.workSteps]
              .filter(Boolean)
              .join("\n\n")
              .slice(-6000),
          }
        : undefined;
      yield* this.#mailbox.requeueRefused(delivery.id, continuation).pipe(toTurnOperationFailed);
      this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.id);
    }
    this.#conversation.emitConversation(snapshot, "turn.completed", { turnId, status: "interrupted" });
    try {
      this.#mailboxSync.emitQueue(agentId);
    } catch (error) {
      this.#hooks.emitError("delivery_reconciliation_pending", error, agentId);
      this.#mailboxSync.retryDeliveryReconciliation(agentId);
    }
    this.#hooks.emit({
      type: "turn-completed",
      agentId,
      threadId: this.#conversation.publicThreadId(agentId, threadId),
      turnId,
      status: "interrupted",
      origin: deliveries[0]?.delivery.sender.kind ?? "unknown",
    });
  }, Effect.uninterruptible);

  /** `streamed`: text, thinking or a tool step, which marks when the provider first answered. */
  #markProduced(turnId: string, acted: boolean, streamed = acted): void {
    const running = this.#runningTurns.get(turnId);
    if (!running) return;
    running.produced = true;
    if (acted) running.acted = true;
    if (streamed) running.firstOutputAt ??= Date.now();
  }

  readonly #associateStartedTurn = Effect.fn("TurnLifecycle.associateStartedTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    taskId: string | null,
    turnId: string,
    snapshot: ConversationSnapshot,
  ) {
    const deliveries = yield* turnStep(() => this.#mailbox.startingDeliveriesForAgent(agentId, taskId));
    if (deliveries.length === 0) return;
    yield* Effect.gen({ self: this }, function* () {
      for (const { delivery } of deliveries) {
        yield* this.#mailbox.markRunning(delivery.id, turnId).pipe(toTurnOperationFailed);
        yield* turnStep(() => this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.id));
      }
      yield* turnStep(() => this.#mailboxSync.emitQueue(agentId));
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => this.#hooks.emitError("delivery_turn_association_failed", failure.cause, agentId)),
      ),
    );
  }, Effect.uninterruptible);

  readonly #relayAgentResult = Effect.fn("TurnLifecycle.relayAgentResult")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    delivery: DeliveryContext,
    text: string,
  ) {
    if (delivery.delivery.sender.kind !== "agent") return;
    const messageId = delivery.delivery.messageId;
    const originAgentId = this.#mailbox.chainOriginAgentId(messageId);
    const recipientAgentId = delivery.delivery.sender.agentId;
    if (
      !originAgentId ||
      originAgentId === agentId ||
      // The sender said it wants no answer, so the turn's result stays with this agent. Without
      // this the sender is woken for an echo of work it only wanted to know about.
      !this.#mailbox.expectsReply(messageId) ||
      this.#mailbox.hasReplyFrom(agentId, messageId) ||
      this.#mailbox.hasAgentMessageFromTurnTo(agentId, turnId, recipientAgentId)
    )
      return;

    // A result for a request from a side thread runs in that thread, as an answer with send_message does.
    const answerTaskId = this.#mailbox.answerTaskId(agentId, messageId, [recipientAgentId]);
    const taskId = answerTaskId && this.#hooks.taskOpen(answerTaskId) ? answerTaskId : undefined;
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId },
        recipientAgentIds: [recipientAgentId],
        text,
        replyToMessageId: messageId,
        ...(taskId ? { taskId } : {}),
        // The requested result, not a new request. The chain-origin guard above already stops a
        // second relay; this is what tells the recipient it owes no acknowledgement for one.
        expectsReply: false,
        idempotencyKey: `auto-result:${turnId}:${messageId}`,
      })
      .pipe(toTurnOperationFailed);
    const senderSnapshot = this.#conversation.snapshotToUpdate(agentId);
    if (senderSnapshot) {
      this.#mailboxSync.syncMailboxMessages(senderSnapshot);
      this.#conversation.emitConversation(senderSnapshot);
    }
    for (const queued of receipt.deliveries) yield* this.#hooks.steerAgentMessage(recipientAgentId, queued.id);
    this.#mailboxSync.emitQueue(recipientAgentId);
    this.#hooks.scheduleDrain(recipientAgentId);
  }, Effect.uninterruptible);

  readonly #applyItem = Effect.fn("TurnLifecycle.applyItem")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    item: ThreadItem,
    completed: boolean,
  ) {
    const usage = completed ? toolUsage(item) : null;
    if (usage) this.#hooks.emitToolUsage({ ...usage, agentId, turnId });
    if (yield* this.#images.handleItem(agentId, threadId, turnId, item, completed)) return;
    const toolProgress = toolProgressText(item, completed);
    this.#observeTraceStep(turnId, item, completed, toolProgress);
    if (toolProgress) {
      const errorText = completed ? toolErrorText(item) : null;
      const redactedError = errorText ? this.#hooks.redactMcp(errorText) : undefined;
      this.#emitTurnProgress(
        agentId,
        this.#conversation.publicThreadId(agentId, threadId),
        turnId,
        toolProgress,
        redactedError,
      );
      return;
    }
    if (item.type !== "agentMessage" || !isString(item.id)) return;
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    let message = snapshot.messages.find((candidate) => candidate.id === item.id);
    if (!message) {
      message = newAssistantMessage(item.id, turnId);
      snapshot.messages.push(message);
    }
    if (isString(item.text)) message.text = item.text;
    if (isString(item.phase)) message.itemType = item.phase;
    message.status = completed ? "completed" : "streaming";
    this.#itemTurns.set(item.id, turnId);
    this.#conversation.emitConversation(snapshot);
  });

  /**
   * Shows a turn's plan as one message, which each update replaces. The first update places it in
   * the transcript; the later ones keep that place, so the list does not move while it fills.
   */
  #applyPlan(agentId: string, threadId: string, turnId: string, plan: ConversationPlan): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const id = `${turnId}:plan`;
    let message = snapshot.messages.find((candidate) => candidate.id === id);
    if (!message) {
      message = newAssistantMessage(id, turnId);
      snapshot.messages.push(message);
    }
    message.itemType = CONVERSATION_PLAN_ITEM_TYPE;
    message.text = conversationPlanText(plan);
    message.plan = plan;
    message.status = "streaming";
    this.#itemTurns.set(id, turnId);
    this.#conversation.emitConversation(snapshot);
  }

  /**
   * Shows a turn's subagents as one message, which each update replaces, as the plan is. Only a
   * running turn adds the message: a background subagent ends after its turn, and its update then
   * changes the list that its turn left. That list can be out of the bounded cache by then, so it is
   * read back from the database.
   */
  #applySubagents(agentId: string, threadId: string, turnId: string, subagents: ConversationSubagent[]): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const id = `${turnId}:subagents`;
    let message = snapshot.messages.find((candidate) => candidate.id === id);
    if (!message && !this.#runningTurns.has(turnId)) {
      message = this.#store.database.readConversationMessages(agentId, snapshot.threadId, [id])[0];
      if (!message) return;
      snapshot.messages.push(message);
    }
    if (!message) {
      message = newAssistantMessage(id, turnId);
      snapshot.messages.push(message);
      this.#itemTurns.set(id, turnId);
    }
    const previous = message.subagents;
    message.itemType = CONVERSATION_SUBAGENTS_ITEM_TYPE;
    message.text = conversationSubagentsText(subagents);
    message.subagents = subagents;
    // A new step replaces the last one in the event log, so a long run does not keep a copy of the
    // list for each step. A new subagent or a new state keeps its own event.
    if (previous && subagentStates(previous) === subagentStates(subagents))
      this.#conversation.emitReplacedMessage(snapshot, id, "turn.subagents-updated");
    else this.#conversation.emitConversation(snapshot);
  }

  /** Codex reports its subagents as tool items of the parent thread. */
  #applyCodexSubagents(agentId: string, threadId: string, turnId: string, item: DynamicRecord): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const current = snapshot.messages.find((candidate) => candidate.id === `${turnId}:subagents`)?.subagents ?? [];
    const subagents = foldCodexSubagentItem(current, item, new Date().toISOString());
    const clamped = subagents && clampConversationSubagents(subagents);
    if (clamped) this.#applySubagents(agentId, threadId, turnId, clamped);
  }

  #clearPlan(agentId: string, threadId: string, turnId: string): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const index = snapshot.messages.findIndex((candidate) => candidate.id === `${turnId}:plan`);
    if (index < 0) return;
    // The write rewrites the thread, which deletes the projection row of the removed message.
    snapshot.messages.splice(index, 1);
    this.#itemTurns.delete(`${turnId}:plan`);
    this.#conversation.emitConversation(snapshot);
  }

  /** Records a step for the trace: a tool step, a thought or an answer. Other items have no step. */
  #observeTraceStep(turnId: string, item: ThreadItem, completed: boolean, toolProgress: string | null): void {
    if (!isString(item.id)) return;
    if (isToolItem(item)) {
      const failed = completed && toolFailed(item);
      const errorText = failed ? toolErrorText(item) : null;
      const redactedError = errorText ? this.#hooks.redactMcp(errorText) : undefined;
      this.#traces.observe(turnId, item.id, "tool", {
        completed,
        failed,
        text: toolProgress,
        error: redactedError,
        ...toolTraceDetail(item),
      });
    } else if (item.type === "agentMessage")
      this.#traces.observe(turnId, item.id, item.phase === "commentary" ? "reasoning" : "message", { completed });
  }

  /**
   * Puts the trace of an ended turn on the message that holds it (`traceMessage`), with the tokens
   * and cost that the provider reported for the turn so far. A usage read that fails leaves them out;
   * it does not stop the end of the turn. Returns the message, or undefined when the turn has none.
   */
  #attachTrace(
    messages: ConversationMessage[],
    agentId: string,
    turnId: string,
    trace: ConversationTurnTrace,
  ): ConversationMessage | undefined {
    const message = traceMessage(messages, turnId);
    if (!message) return undefined;
    let usage: { tokens: number; costUsd: number | null } | null = null;
    try {
      const since = new Date(Date.parse(trace.startedAt) - TURN_USAGE_MARGIN_MS).toISOString();
      usage = this.#store.database.usage.readTurnTotals(agentId, turnId, since);
    } catch (error) {
      logger.warn("The usage of a turn could not be read for its trace.", { error });
    }
    message.trace = usage ? { ...trace, tokens: usage.tokens, costUsd: usage.costUsd } : trace;
    return message;
  }

  #emitTurnProgress(agentId: string, threadId: string, turnId: string, text: string, error?: string): void {
    this.#hooks.emit({
      type: "turn-progress",
      agentId,
      threadId,
      turnId,
      detail: text,
      ...(error ? { error } : {}),
    });
  }
}

/**
 * Remove a turn's answers that hold nothing for a reader.
 *
 * A teammate can start a turn whose work is all internal: the agent answers the teammate and has
 * nothing left to tell the user. A provider ends a turn with text, so a model in that position
 * writes a placeholder instead - "∅" was the one seen. That filler is not only a bubble: the turn
 * takes the last answer as the result it relays to the teammate who asked, and as the agent's
 * sidebar preview. A message with no letter and no digit carries neither, so it is dropped here.
 * The turn-completion write rewrites the whole thread, which deletes the projection row of a
 * message the snapshot no longer holds, so a placeholder already streamed to the database goes too.
 *
 * A message that carries an attachment or a generated image is kept whatever its text: the file is
 * what the user was given, and the text is only its caption.
 */
function dropPlaceholderAnswers(snapshot: ConversationSnapshot, turnId: string): void {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.author !== "assistant" || message.turnId !== turnId) continue;
    if (
      message.itemType === "commentary" ||
      message.itemType === "question_prompt" ||
      message.itemType === CONVERSATION_PLAN_ITEM_TYPE ||
      message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE
    )
      continue;
    if (message.attachments?.length || message.imageGeneration) continue;
    if (!message.text.trim() || /[\p{L}\p{N}]/u.test(message.text)) continue;
    snapshot.messages.splice(index, 1);
  }
}

export class TurnOperationFailed extends Schema.TaggedError<TurnOperationFailed>()("TurnOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: turnStep, rewrap: toTurnOperationFailed } = causeHelpers(TurnOperationFailed);

/**
 * Whether running the turn again would repeat this item: a tool step, or answer text. Thinking and
 * the provider's echo of the user's message are not repeated work.
 */
function isRepeatedWork(item: { type?: unknown; phase?: unknown; text?: unknown }): boolean {
  if (item.type === "userMessage" || item.type === "reasoning" || item.type === "contextCompaction") return false;
  if (item.type !== "agentMessage") return true;
  return item.phase !== "commentary" && isString(item.text) && item.text.trim() !== "";
}

/** Which subagents a list holds and the state of each, without their steps. */
function subagentStates(subagents: readonly ConversationSubagent[]): string {
  return subagents.map((subagent) => `${subagent.id}:${subagent.status}`).join("\n");
}
