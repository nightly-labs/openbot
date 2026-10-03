import {
  type AgentEvent,
  type AgentSummary,
  type BrowserControlState,
  type BrowserTab,
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationPlan,
  type ConversationSnapshot,
  conversationPlanText,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { BrowserOperationError } from "../browser-effects";
import { newAssistantMessage, normalizeCompletionStatus } from "../conversation-snapshots";
import type { DeliveryContext, MailboxStore } from "../mailbox-store";
import {
  type AppServerNotification,
  decodeAccountLoginCompletedResult,
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
import type { ImageGenRuntime } from "./image-gen-runtime";
import { markIncompleteImageGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import { PLAN_UPDATED_METHOD, planFromNotification } from "./plan-updates";
import { isUsageLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
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
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  /** Closes a provider session the provider refuses; the next turn opens a new one with the transcript. */
  dropRefusedSession(agentId: string, externalThreadId: string): Effect.Effect<void, TurnOperationFailed>;
  listAgents(): AgentSummary[];
  redactMcp(text: string): string;
  /** A finished tool step, for product analytics only. It never reaches a renderer or a remote client. */
  emitToolUsage(usage: ToolUsageSignal): void;
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
  readonly #hooks: TurnHooks;
  readonly #failedTurns = new Map<string, string>();
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
   */
  readonly #runningTurns = new Map<
    string,
    { client: AgentClient; agentId: string; threadId: string; startedAt: number; produced: boolean }
  >();
  /** The deliveries run again after a refused session history. Each one gets a single retry. */
  readonly #refusedRetries = new Set<string>();
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
    this.#hooks = options.hooks;
  }

  failedTurns(): ReadonlyMap<string, string> {
    return this.#failedTurns;
  }

  forgetAgent(agentId: string): void {
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
    this.#failedTurns.clear();
    this.#turnAssociations.clear();
    this.#turnErrors.clear();
    this.#runningTurns.clear();
    this.#refusedRetries.clear();
    this.#lastEventAt.clear();
    this.#itemTurns.clear();
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
        this.#runningTurns.set(turnId, { client: source, agentId, threadId, startedAt: Date.now(), produced: false });
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        snapshot.activeTurnId = turnId;
        this.#failedTurns.delete(agentId);
        const origin = this.#mailbox.startingDeliveryForAgent(agentId)?.delivery.sender.kind ?? "unknown";
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
        const itemId = getString(item, "id");
        if (itemId) this.#itemTurns.set(itemId, turnId);
        this.#markProduced(turnId);
        if (item.type === "contextCompaction") {
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
        this.#markProduced(turnId);
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        let message = snapshot.messages.find((candidate) => candidate.id === itemId);
        if (!message) {
          message = newAssistantMessage(itemId, turnId);
          snapshot.messages.push(message);
        }
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
        this.#attention.clearForTurn(threadId, turnId);
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
        this.#compaction.updateBudget(threadId, params);
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
        if (notification.method === "error" && message && errorTurnId && this.#runningTurns.has(errorTurnId)) {
          this.#turnErrors.set(errorTurnId, message);
          // The turn's completion runs it again or reports it in words the user can act on.
          if (isForeignReasoningError(message)) return;
        }
        if (error?.codexErrorInfo === "usageLimitExceeded" || isUsageLimitDiagnostic(message)) {
          yield* this.#providers.refreshUsageAfterLimit(source);
          return;
        }
        this.#hooks.emitError(`agent_${notification.method}`, message, agentId);
      }
    }
  }).bind(this);

  readonly #completeTurn = Effect.fn("TurnLifecycle.completeTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    status: string,
  ) {
    const running = this.#runningTurns.get(turnId);
    this.#runningTurns.delete(turnId);
    const reportedError = this.#turnErrors.get(turnId);
    this.#turnErrors.delete(turnId);
    // The error is kept only while the turn runs, so a refused turn always has its entry.
    const refused =
      running !== undefined &&
      status === "failed" &&
      reportedError !== undefined &&
      isForeignReasoningError(reportedError);
    this.#deltas.flushTurn(turnId);
    yield* this.#images.waitForOperations(threadId, turnId);
    const association = this.#turnAssociations.get(turnId);
    if (association) yield* Deferred.await(association).pipe(Effect.catch(() => Effect.void));
    this.#memories.finishTurn(turnId, status);
    // A refused session is closed below, so it is not compacted.
    const shouldCompact = !refused && this.#compaction.reserve(agentId, threadId);
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
    if (status === "failed") this.#failedTurns.set(agentId, turnId);
    else this.#failedTurns.delete(agentId);
    for (const message of snapshot.messages) {
      if (this.#itemTurns.get(message.id) !== turnId || message.status !== "streaming") continue;
      message.status = normalizeCompletionStatus(status);
      markIncompleteImageGeneration(message, message.status);
    }
    // Only this loop reads the map, so the finished turn's items go, or it holds every item ever seen.
    for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
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
    const latestAssistant = [...snapshot.messages]
      .reverse()
      .find(
        (message) =>
          message.author === "assistant" &&
          message.turnId === turnId &&
          message.itemType !== "commentary" &&
          message.itemType !== "question_prompt" &&
          message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
          message.text.trim(),
      );
    if (deliveries.length > 0) {
      const terminal = status === "failed" ? "failed" : status === "interrupted" ? "interrupted" : "completed";
      for (const delivery of deliveries) {
        this.#refusedRetries.delete(delivery.delivery.id);
        const reason = terminal === "failed" && failure ? this.#hooks.redactMcp(failure) : null;
        yield* this.#mailbox
          .markTerminal(delivery.delivery.id, terminal, reason)
          .pipe(Effect.mapError((failure) => new TurnOperationFailed({ cause: failure.cause })));
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
    if (latestAssistant && !this.#conversation.isExecutionThread(snapshot.threadId)) {
      yield* this.#store
        .updatePreview(agentId, latestAssistant.text)
        .pipe(Effect.mapError((failure) => new TurnOperationFailed({ cause: failure.cause })));
      this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
    }
    this.#conversation.emitConversation(snapshot, "turn.completed", { turnId, status });
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
      status,
      origin: deliveries[0]?.delivery.sender.kind ?? "unknown",
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
    for (const { delivery } of deliveries) {
      this.#refusedRetries.add(delivery.id);
      yield* this.#mailbox
        .requeueRefused(delivery.id)
        .pipe(Effect.mapError((failure) => new TurnOperationFailed({ cause: failure.cause })));
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
    yield* this.#hooks.dropRefusedSession(agentId, threadId);
    this.#hooks.scheduleDrain(agentId);
  }, Effect.uninterruptible);

  #markProduced(turnId: string): void {
    const running = this.#runningTurns.get(turnId);
    if (running) running.produced = true;
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
        yield* this.#mailbox
          .markRunning(delivery.id, turnId)
          .pipe(Effect.mapError((failure) => new TurnOperationFailed({ cause: failure.cause })));
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
      .pipe(Effect.mapError((failure) => new TurnOperationFailed({ cause: failure.cause })));
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

function turnStep<A>(run: () => A): Effect.Effect<A, TurnOperationFailed> {
  return Effect.try({ try: run, catch: (cause) => new TurnOperationFailed({ cause }) });
}
