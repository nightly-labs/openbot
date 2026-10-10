import {
  type AgentEvent,
  type AgentSummary,
  agentProviderDescriptor,
  type BrowserControlState,
  type BrowserTab,
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationPlan,
  type ConversationSnapshot,
  conversationPlanText,
  latestTurnAnswer,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { classifyFailure } from "@openbot/telemetry";
import { Deferred, Effect, Exit, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { BrowserOperationError } from "../browser-effects";
import { newAssistantMessage, normalizeCompletionStatus } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import {
  type AppServerNotification,
  decodeAccountLoginCompletedResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type ThreadItem,
} from "../protocol";
import type { AgentMemories } from "./agent-memories";
import type { AttentionBrowserHost, AttentionRegistry } from "./attention-registry";
import type { BrowserUploadTarget } from "./browser-uploads";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import type { DeltaBuffer } from "./delta-buffer";
import type { FailureContext, FailureSignal } from "./failure-signal";
import type { ImageGenRuntime } from "./image-gen-runtime";
import { markIncompleteImageGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import { PLAN_UPDATED_METHOD, planFromNotification } from "./plan-updates";
import { isBalanceDiagnostic, isPlanLimitDiagnostic, isUsageLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import { isNoUpdateAnswer, settleQuietRoutineTurn } from "./routine-quiet-runs";
import { ThreadFileHistory } from "./thread-file-history";
import {
  isForeignReasoningError,
  isNonActionableCodexWarning,
  providerLabel,
  type ToolUsageSignal,
  toolProgressText,
  toolUsage,
  toThreadItem,
} from "./thread-items";
import { collectProviderUsage } from "./usage-collection";
import { USAGE_LIMIT_METHOD, type UsageLimitGate } from "./usage-limit-gate";

const logger = createOpenBotLogger("turn-lifecycle");

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
}

export interface TurnHooks {
  emitFailure?(failure: FailureSignal): void;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string, context?: FailureContext): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  /** Closes a provider session the provider refuses; the next turn opens a new one with the transcript. */
  dropRefusedSession(agentId: string, externalThreadId: string): Effect.Effect<void, TurnOperationFailed>;
  listAgents(): AgentSummary[];
  redactMcp(text: string): string;
  /** A finished tool step, for product analytics only. It never reaches a renderer or a remote client. */
  emitToolUsage(usage: ToolUsageSignal): void;
  /** The model this turn was started with, or null when the drain no longer knows it. */
  turnModel(agentId: string, turnId: string): string | null;
  /**
   * Gives a channel task back to its channel's queue after a spent plan refused its turn. False
   * when the delivery is not an active channel assignment that can go back.
   */
  requeueChannelDelivery(deliveryId: string): Effect.Effect<boolean>;
  /**
   * Whether this delivery is a routine run that may end without a message: a scheduled run whose
   * agent answers only the no-update marker or calls the no-update tool.
   */
  quietRoutineDelivery(deliveryId: string): boolean;
  /**
   * The agent preview before the routine run of this delivery showed its task, and that task, once.
   * Null after a restart or for any other delivery.
   */
  takeRoutinePreview(deliveryId: string): { previous: string; shown: string } | null;
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
  readonly #hooks: TurnHooks;
  readonly fileHistory = new ThreadFileHistory();
  readonly #failedTurns = new Map<string, string>();
  readonly #observedCompactions = new Map<string, string>();
  readonly #itemTurns = new Map<string, string>();
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
  /** The deliveries run again after a refused session history. Each one gets a single retry. */
  readonly #refusedRetries = new Set<string>();
  /** Running turns whose agent called the no-update tool. The completion of the turn takes the entry. */
  readonly #noUpdateTurns = new Set<string>();
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
    this.#runningTurns.clear();
    this.#noUpdateTurns.clear();
    this.#refusedRetries.clear();
    this.#lastEventAt.clear();
    this.#itemTurns.clear();
    this.#observedCompactions.clear();
  }).bind(this);

  /**
   * Ends each turn a client ran when the runtime stops it for a reason other than an exit: a
   * sign-out that an account refresh found, or a new client for the same provider. The stopped
   * process sends no `turn/completed` and `#handleExit` skips it, so without this its turns stay
   * active, and its deliveries running, until OpenBot restarts.
   */
  readonly interruptTurnsOf = Effect.fn("TurnLifecycle.interruptTurnsOf")(function* (
    this: TurnLifecycle,
    client: AgentClient,
  ) {
    for (const [turnId, turn] of this.#runningTurns) {
      if (turn.client !== client) continue;
      this.#runningTurns.delete(turnId);
      this.#attention.clearForTurn(turn.threadId, turnId);
      if (this.#observedCompactions.get(turn.threadId) === turnId) this.#observedCompactions.delete(turn.threadId);
      this.#compaction.abandonCompaction(turn.threadId);
      yield* this.#completeTurn(turn.agentId, turn.threadId, turnId, "interrupted").pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#hooks.emitError("turn_completion_failed", failure.cause, turn.agentId)),
        ),
      );
    }
  }).bind(this);

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
      const session = agent?.threadId
        ? this.#store.database
            .listProviderSessions(agent.threadId)
            .find((entry) => entry.externalSessionId === threadId && entry.provider === source.provider)
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
        const starting = this.#mailbox.startingDeliveryForAgent(agentId)?.delivery;
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
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        snapshot.activeTurnId = turnId;
        this.#failedTurns.delete(agentId);
        const origin = starting?.sender.kind ?? "unknown";
        const association = Deferred.makeUnsafe<void, TurnOperationFailed>();
        this.#turnAssociations.set(turnId, association);
        yield* Effect.gen({ self: this }, function* () {
          const exit = yield* Effect.exit(this.#associateStartedTurn(agentId, turnId, snapshot));
          yield* Deferred.done(association, exit);
          if (this.#turnAssociations.get(turnId) === association) this.#turnAssociations.delete(turnId);
        }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
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
        if (this.#compaction.isCompactionTurn(threadId, turnId)) {
          this.#compaction.finish(agentId, threadId, status);
          return;
        }
        yield* this.#completeTurn(agentId, threadId, turnId, status).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("turn_completion_failed", failure.cause, agentId)),
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
            source.contextCompaction === "events" || source.contextCompaction === "request" ? 0.8 : null,
            usage.estimated === true,
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
        yield* this.#providers.refreshCodexUsage();
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
        if (notification.method === "warning" && isNonActionableCodexWarning(message)) return;
        // Codex retries on its own and reports the final failure again without `willRetry`.
        if (isRecord(params) && params.willRetry === true) return;
        // A usage limit shows no banner, but the failed delivery still keeps it as the reason.
        const errorTurnId = getString(params, "turnId");
        if (notification.method === "error" && errorTurnId && this.#runningTurns.has(errorTurnId)) {
          this.#turnErrors.set(errorTurnId, message);
          // The turn's completion runs it again or reports it in words the user can act on.
          if (isForeignReasoningError(message)) return;
        }
        // A spent quota or balance is explained by the usage notice, so only a provider that reports
        // usage can leave it out of the banner. Gemini's 429 reads as a spent quota, and it failed
        // with nothing on screen. A plan window holds the queue until its reset for every provider.
        if (
          error?.codexErrorInfo === "usageLimitExceeded" ||
          (isUsageLimitDiagnostic(message) &&
            (agentProviderDescriptor(source.provider).reportsUsage || isPlanLimitDiagnostic(message))) ||
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
        this.#hooks.emitError(`agent_${notification.method}`, message, agentId, {
          causeCode: classifyFailure(error ?? message),
          provider: source.provider,
          model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
          turnId: errorTurnId,
          severity: notification.method === "warning" ? "warning" : "error",
        });
      }
    }
  }).bind(this);

  /**
   * Records a call to the no-update tool. `quiet` when the turn runs only scheduled routine runs, so
   * its completion drops the text answers; `shown` when a person waits for the answer, as in a Test
   * run; null when no routine run started the turn. The completion decides again, because a message
   * can join the turn after the call.
   */
  requestNoUpdate(agentId: string, threadId: string, turnId: string): "quiet" | "shown" | null {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!deliveries.some(({ delivery }) => delivery.sender.kind === "routine")) return null;
    this.#noUpdateTurns.add(turnId);
    return this.#quietRoutineTurn(threadId, deliveries) ? "quiet" : "shown";
  }

  /** Only a turn that runs nothing but scheduled routine runs, outside a channel or messaging thread. */
  #quietRoutineTurn(threadId: string | null, deliveries: readonly DeliveryContext[]): boolean {
    return (
      deliveries.length > 0 &&
      !this.#conversation.isExecutionThread(threadId) &&
      deliveries.every(
        ({ delivery }) => delivery.sender.kind === "routine" && this.#hooks.quietRoutineDelivery(delivery.id),
      )
    );
  }

  readonly #completeTurn = Effect.fn("TurnLifecycle.completeTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    status: string,
  ) {
    const running = this.#runningTurns.get(turnId);
    this.#runningTurns.delete(turnId);
    const noUpdateCalled = this.#noUpdateTurns.delete(turnId);
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
    const refused =
      running !== undefined &&
      status === "failed" &&
      reportedError !== undefined &&
      isForeignReasoningError(reportedError);
    const limited = status === "failed" && this.#limitedTurns.has(turnId);
    const resetsAt = this.#limitedTurns.get(turnId) ?? null;
    this.#limitedTurns.delete(turnId);
    this.#deltas.flushTurn(turnId);
    yield* this.#images.waitForOperations(threadId, turnId);
    const association = this.#turnAssociations.get(turnId);
    if (association) yield* Deferred.await(association).pipe(Effect.catch(() => Effect.void));
    this.#memories.finishTurn(turnId, status);
    // A refused session is closed below, and a spent plan would refuse the summary turn too, so
    // neither is compacted.
    const shouldCompact = !refused && !limited && this.#compaction.reserve(agentId, threadId);
    this.#browser.endControl(this.#conversation.publicThreadId(agentId, threadId), turnId);
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    snapshot.activeTurnId = null;
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    // A channel task is not run again: an unfinished turn pauses it, and its Resume opens the new session.
    const retry =
      refused &&
      !running.produced &&
      deliveries.length > 0 &&
      !this.#conversation.isExecutionThread(snapshot.threadId) &&
      deliveries.every(({ delivery }) => !this.#refusedRetries.has(delivery.id));
    if (retry) {
      yield* this.#retryRefusedTurn(agentId, threadId, turnId, snapshot, deliveries);
      return;
    }
    // The plan refused the turn before it did anything that a second run would repeat, so its
    // messages wait in the queue for the reset. A channel task goes back to its channel's queue
    // instead: an assignment that waited here would reserve the whole host until the reset.
    const repeatable = limited && running !== undefined && !running.acted && deliveries.length > 0;
    const channelTurn = this.#conversation.isExecutionThread(snapshot.threadId);
    const requeue = repeatable && !channelTurn;
    for (const message of snapshot.messages) {
      if (this.#itemTurns.get(message.id) !== turnId || message.status !== "streaming") continue;
      message.status = normalizeCompletionStatus(repeatable ? "interrupted" : status);
      markIncompleteImageGeneration(message, message.status);
    }
    // Only this loop reads the map, so the finished turn's items go, or it holds every item ever seen.
    for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
    // The limit belongs to the model the turn ran on, which the agent may have left since.
    const model = this.#hooks.turnModel(agentId, turnId);
    if (requeue) {
      yield* this.#requeueTurn(agentId, threadId, turnId, snapshot, deliveries);
      // After the requeue, so a routine set to skip finds its run back in the queue.
      yield* this.#usageLimits.reached(agentId, resetsAt, model);
      this.#hooks.scheduleDrain(agentId);
      return;
    }
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
    if (outcome === "failed") this.#failedTurns.set(agentId, turnId);
    else this.#failedTurns.delete(agentId);
    const failure = refused
      ? sourceText("error.provider.foreignReasoning", { provider: providerLabel(running.client.provider) })
      : reportedError;
    if (refused) {
      yield* this.#hooks.dropRefusedSession(agentId, threadId);
      this.#hooks.emitError("agent_error", failure, agentId);
    }
    if (deliveries.some((delivery) => delivery.delivery.sender.kind === "agent")) {
      dropPlaceholderAnswers(snapshot, turnId);
    }
    // Only a turn that ran nothing but scheduled routine runs: a person who wrote in the same turn,
    // or who started a Test, script or webhook run, waits for the answer.
    const quiet =
      outcome === "completed" &&
      this.#quietRoutineTurn(snapshot.threadId, deliveries) &&
      settleQuietRoutineTurn(snapshot, turnId, noUpdateCalled);
    const latestAssistant = latestTurnAnswer(snapshot.messages, turnId);
    if (deliveries.length > 0) {
      const terminal = outcome === "failed" ? "failed" : outcome === "interrupted" ? "interrupted" : "completed";
      for (const delivery of deliveries) {
        this.#refusedRetries.delete(delivery.delivery.id);
        const reason = terminal === "failed" && failure ? this.#hooks.redactMcp(failure) : null;
        yield* this.#mailbox.markTerminal(delivery.delivery.id, terminal, reason).pipe(toTurnOperationFailed);
        this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.delivery.id);
      }
      // A turn can start with the answers of several teammates. `#relayAgentResult` skips each one
      // that wants no answer, so only a teammate that asked for a result gets one.
      if (!this.#conversation.isExecutionThread(snapshot.threadId) && terminal === "completed" && latestAssistant) {
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
    // A routine run that answered only the no-update marker, also a Test run that shows it in the
    // chat, does not put the marker in the preview.
    const markerAnswer =
      latestAssistant !== undefined &&
      deliveries.some(({ delivery }) => delivery.sender.kind === "routine") &&
      isNoUpdateAnswer(latestAssistant.text);
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
    });
    if (shouldCompact) yield* this.#compaction.request(agentId, threadId);
    else this.#hooks.scheduleDrain(agentId);
  }, Effect.uninterruptible);

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

  /** Puts the deliveries of a turn the provider refused back at their place in the queue, and ends the turn as interrupted. */
  readonly #requeueTurn = Effect.fn("TurnLifecycle.requeueTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    snapshot: ConversationSnapshot,
    deliveries: readonly DeliveryContext[],
  ) {
    for (const { delivery } of deliveries) {
      yield* this.#mailbox.requeueRefused(delivery.id).pipe(toTurnOperationFailed);
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
    turnId: string,
    snapshot: ConversationSnapshot,
  ) {
    const deliveries = yield* turnStep(() => this.#mailbox.startingDeliveriesForAgent(agentId));
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

    yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId },
        recipientAgentIds: [recipientAgentId],
        text,
        replyToMessageId: messageId,
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
    if (toolProgress) {
      this.#emitTurnProgress(agentId, this.#conversation.publicThreadId(agentId, threadId), turnId, toolProgress);
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

  #clearPlan(agentId: string, threadId: string, turnId: string): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const index = snapshot.messages.findIndex((candidate) => candidate.id === `${turnId}:plan`);
    if (index < 0) return;
    // The write rewrites the thread, which deletes the projection row of the removed message.
    snapshot.messages.splice(index, 1);
    this.#itemTurns.delete(`${turnId}:plan`);
    this.#conversation.emitConversation(snapshot);
  }

  #emitTurnProgress(agentId: string, threadId: string, turnId: string, text: string): void {
    this.#hooks.emit({
      type: "turn-progress",
      agentId,
      threadId,
      turnId,
      detail: text,
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
      message.itemType === CONVERSATION_PLAN_ITEM_TYPE
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
