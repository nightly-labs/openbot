import { randomUUID } from "node:crypto";
import type { AgentContextState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { isCodexCompactionStartRejected } from "../app-server-client";
import { causeHelpers } from "../effect-boundary";
import { decodeRecordResponse, getRecord } from "../protocol";
import { finiteNumberOrNull } from "./account-usage";
import type { ProviderPort } from "./provider-runtime";

interface ThreadContextBudget {
  usedTokens: number;
  contextWindow: number;
  pending: boolean;
  phase: "idle" | "requested" | "running";
  compactionTurnId: string | null;
  lastCompactedTokens: number | null;
}

const CONTEXT_COMPACTION_THRESHOLD = 0.8;
const CONTEXT_COMPACTION_TIMEOUT_MS = 120_000;
/** Usage arrives after each model step; one runtime snapshot carries the latest value of a burst. */
const USAGE_CHANGE_DELAY_MS = 250;

interface CompactionOperation {
  agentId: string;
  threadId: string;
  budget: ThreadContextBudget;
  client: AgentClient | null;
  submitted: boolean;
  timer: NodeJS.Timeout | null;
  ended: boolean;
}

/** One prepared input batch. Its evidence cannot be reused by another submission. */
export interface CompactionInputAttempt {
  readonly agentId: string;
  readonly threadId: string;
  readonly client: AgentClient;
  readonly association: Deferred.Deferred<boolean>;
  operation: CompactionOperation | null;
  turnId: string | null;
  active: boolean;
  terminal: boolean;
  refused: boolean;
}

export interface ContextCompactionOptions {
  store: AgentStore;
  providers: ProviderPort;
  emitError(code: string, error: unknown, agentId?: string): void;
  scheduleDrain(agentId: string): void;
  changed?(): void;
}

/**
 * Decides when a provider thread is close enough to its context window to compact, and drives the
 * compaction turn.
 *
 * A compaction is a real provider turn, so it arrives on the same notification stream as the
 * agent's own work and has to be told apart from it: `claimTurn` swallows the `turn/started` that
 * belongs to the compaction, and `isCompactionTurn` recognizes its completion. The budget is keyed
 * by *external* provider thread id, operations by agent id, because an agent only ever compacts one
 * thread at a time and the drain guard asks the question by agent.
 */
export class ContextCompaction {
  readonly #store: AgentStore;
  readonly #providers: ProviderPort;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #scheduleDrain: (agentId: string) => void;
  readonly #budgets = new Map<string, ThreadContextBudget>();
  readonly #operations = new Map<string, CompactionOperation>();
  readonly #inputs = new Map<string, CompactionInputAttempt>();
  readonly #display = new Map<string, Omit<AgentContextState, "agentId" | "threadId">>();
  readonly #awaitingPostCompaction = new Set<string>();
  readonly #durations = new Map<string, number>();
  readonly #changed: () => void;
  #usageTimer: NodeJS.Timeout | null = null;

  constructor(options: ContextCompactionOptions) {
    this.#changed = options.changed ?? (() => {});
    this.#store = options.store;
    this.#providers = options.providers;
    this.#emitError = options.emitError;
    this.#scheduleDrain = options.scheduleDrain;
  }

  /** Only personal sessions appear in the desktop snapshot; execution threads remain separate. */
  snapshot(): AgentContextState[] {
    return this.#store.list().flatMap((agent) => {
      const session = agent.threadId
        ? this.#store.database.activeProviderSession(agent.threadId, agent.provider)
        : null;
      const display = session ? this.#display.get(session.externalSessionId) : null;
      return display && agent.threadId ? [{ agentId: agent.id, threadId: agent.threadId, ...display }] : [];
    });
  }

  observeUsage(
    threadId: string,
    usedTokens: number,
    windowTokens: number,
    nativeManaged: boolean,
    autoCompactAt: number | null,
    estimated = false,
  ): void {
    if (!Number.isFinite(usedTokens) || usedTokens < 0 || !Number.isFinite(windowTokens) || windowTokens <= 0) return;
    const display = this.#display.get(threadId) ?? { usage: null, compaction: null };
    const previous = display.usage;
    display.usage = { usedTokens, windowTokens, nativeManaged, autoCompactAt, estimated };
    const after = display.compaction?.status === "completed" && this.#awaitingPostCompaction.delete(threadId);
    if (after && display.compaction) display.compaction.afterTokens = usedTokens;
    this.#display.set(threadId, display);
    if (after || JSON.stringify(previous) !== JSON.stringify(display.usage)) this.#scheduleUsageChange();
  }

  #scheduleUsageChange(): void {
    this.#usageTimer ??= setTimeout(() => {
      this.#usageTimer = null;
      this.#changed();
    }, USAGE_CHANGE_DELAY_MS);
  }

  /** A snapshot sent now also carries any pending usage. */
  #emitChanged(): void {
    if (this.#usageTimer) clearTimeout(this.#usageTimer);
    this.#usageTimer = null;
    this.#changed();
  }

  observeCompaction(
    threadId: string,
    status: "running" | "completed" | "failed",
    tokenComparison: "context" | "none" = "context",
  ): void {
    const display = this.#display.get(threadId) ?? { usage: null, compaction: null };
    if (status === "running" && display.compaction?.status === "running") return;
    const previous =
      status === "running"
        ? display.compaction?.status === "running"
          ? display.compaction
          : null
        : display.compaction;
    const startedAt = previous ? previous.startedAt : Date.now();
    const expectedMs = this.#durations.get(threadId);
    const compaction: NonNullable<typeof display.compaction> = {
      id: previous ? previous.id : randomUUID(),
      startedAt,
      status,
      ...(expectedMs === undefined ? {} : { expectedMs }),
      ...(previous ?? {}),
    };
    compaction.status = status;
    display.compaction = compaction;
    const before = previous ? previous.beforeTokens : display.usage?.usedTokens;
    if (tokenComparison === "none") {
      delete compaction.beforeTokens;
      delete compaction.afterTokens;
    } else if (before !== undefined) compaction.beforeTokens = before;
    this.#awaitingPostCompaction.delete(threadId);
    if (tokenComparison === "context" && status === "completed" && compaction.afterTokens === undefined)
      this.#awaitingPostCompaction.add(threadId);
    if (status === "completed" && previous?.status === "running")
      this.#durations.set(threadId, Math.max(1, Date.now() - startedAt));
    this.#display.set(threadId, display);
    this.#emitChanged();
  }

  /** Ends a running compaction whose provider stopped before it reported the result. */
  abandonCompaction(threadId: string): void {
    if (this.#display.get(threadId)?.compaction?.status === "running") this.observeCompaction(threadId, "failed");
  }

  beginTurn(threadId: string): void {
    this.#awaitingPostCompaction.delete(threadId);
  }

  /** One clause of the drain guard the queue engine composes. False means "hold this agent's queue". */
  mayDrain(agentId: string): boolean {
    return !this.#operations.has(agentId) && !this.#inputs.get(agentId)?.refused;
  }

  updateBudget(threadId: string, params: unknown): void {
    const usage = getRecord(params, "tokenUsage");
    const last = getRecord(usage, "last");
    const usedTokens = finiteNumberOrNull(last?.totalTokens);
    const contextWindow = finiteNumberOrNull(usage?.modelContextWindow);
    if (usedTokens === null || usedTokens < 0 || contextWindow === null || contextWindow <= 0) return;

    const budget = this.#budgets.get(threadId) ?? {
      usedTokens,
      contextWindow,
      pending: false,
      phase: "idle" as const,
      compactionTurnId: null,
      lastCompactedTokens: null,
    };
    budget.usedTokens = usedTokens;
    budget.contextWindow = contextWindow;
    this.#budgets.set(threadId, budget);

    const pressured = usedTokens / contextWindow >= CONTEXT_COMPACTION_THRESHOLD;
    if (!pressured) {
      budget.pending = false;
      budget.lastCompactedTokens = null;
      return;
    }
    if (budget.phase !== "idle") return;

    const minimumGrowth = Math.max(1_024, Math.floor(contextWindow * 0.05));
    if (budget.lastCompactedTokens !== null && usedTokens < budget.lastCompactedTokens + minimumGrowth) {
      return;
    }
    budget.pending = true;
  }

  contextInputCharacters(threadId: string): number {
    const budget = this.#budgets.get(threadId);
    return budget ? Math.min(120_000, Math.floor(budget.contextWindow * 2)) : 120_000;
  }

  reserve(agentId: string, threadId: string): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    if (mode !== "events" && mode !== "request") return false;
    const budget = this.#budgets.get(threadId);
    if (!budget?.pending || budget.phase !== "idle" || this.#operations.has(agentId)) {
      return false;
    }
    budget.phase = "requested";
    this.#operations.set(agentId, {
      agentId,
      threadId,
      budget,
      client: null,
      submitted: false,
      timer: null,
      ended: false,
    });
    this.observeCompaction(threadId, "running");
    return true;
  }

  readonly request = Effect.fn("ContextCompaction.request")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
  ) {
    const operation = this.#operations.get(agentId);
    if (!operation || operation.threadId !== threadId || operation.submitted) return;
    const { budget } = operation;
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const client = agent ? this.#providers.clientForAgent(agent) : null;
    if (
      budget.phase !== "requested" ||
      !client ||
      !client.running ||
      !["events", "request"].includes(client.contextCompaction ?? "unsupported") ||
      !this.#providers.isReady()
    ) {
      if (budget.phase === "requested") this.observeCompaction(threadId, "failed");
      this.#release(operation);
      return;
    }
    operation.client = client;
    operation.submitted = true;
    const input = this.#inputFor(agentId, threadId, client);
    if (input) input.operation = operation;
    const timer = setTimeout(() => {
      if (this.#operations.get(agentId) !== operation) return;
      operation.timer = null;
      this.#emitError("context_compaction_timeout", sourceText("error.agent.compactionStillRunning"), agentId);
    }, CONTEXT_COMPACTION_TIMEOUT_MS);
    timer.unref?.();
    operation.timer = timer;

    yield* client
      .request("thread/compact/start", { threadId }, decodeRecordResponse)
      .pipe(toContextCompactionFailed)
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (this.#operations.get(agentId) !== operation) return;
            if (client.contextCompaction === "request" && budget.phase === "requested") {
              budget.pending = false;
              budget.lastCompactedTokens = budget.usedTokens;
              this.observeCompaction(threadId, "completed");
              this.#release(operation, true);
              this.#scheduleDrain(agentId);
            }
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (this.#operations.get(agentId) !== operation) return;
            budget.lastCompactedTokens = budget.usedTokens;
            // Only a definite method/parameter rejection, without an observed turn,
            // proves this operation never started. Unknown delivery keeps its owned hold.
            const error = failure.cause;
            if (
              budget.compactionTurnId === null &&
              client.provider === "codex" &&
              isCodexCompactionStartRejected(error)
            ) {
              this.#emitError("context_compaction_failed", error, agentId);
              this.observeCompaction(threadId, "failed");
              this.#release(operation);
              this.#scheduleDrain(agentId);
              return;
            }
            this.#emitError("context_compaction_unconfirmed", sourceText("error.agent.compactionUnconfirmed"), agentId);
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (this.#operations.get(agentId) !== operation) return;
            this.#emitError("context_compaction_unconfirmed", sourceText("error.agent.compactionUnconfirmed"), agentId);
          }),
        ),
      );
  });

  /**
   * Takes ownership of a `turn/started` that belongs to a compaction we asked for. True means the
   * router must stop: this turn is not the agent's, so it gets no active turn and no event.
   */
  claimTurn(agentId: string, threadId: string, turnId: string, client: AgentClient): boolean {
    const operation = this.#operations.get(agentId);
    if (!operation || operation.threadId !== threadId || operation.client !== client || !operation.submitted)
      return false;
    const { budget } = operation;
    if (budget.phase !== "requested") return false;
    budget.phase = "running";
    budget.compactionTurnId = turnId;
    return true;
  }

  isCompactionTurn(threadId: string, turnId: string, client: AgentClient): boolean {
    return [...this.#operations.values()].some(
      (operation) =>
        operation.threadId === threadId && operation.client === client && operation.budget.compactionTurnId === turnId,
    );
  }

  markCompacted(threadId: string, turnId: string, client: AgentClient): void {
    const operation = [...this.#operations.values()].find((candidate) => candidate.threadId === threadId);
    // A provider-managed compaction still updates its pressure budget. It cannot finish or
    // change the budget of a different owned operation on this thread.
    if (operation && !this.isCompactionTurn(threadId, turnId, client)) return;
    const budget = operation?.budget ?? this.#budgets.get(threadId);
    if (!budget) return;
    budget.pending = false;
    budget.lastCompactedTokens = budget.usedTokens;
  }

  finish(agentId: string, threadId: string, turnId: string, status: string, client: AgentClient): void {
    const operation = this.#operations.get(agentId);
    if (
      !operation ||
      operation.threadId !== threadId ||
      operation.client !== client ||
      operation.budget.compactionTurnId !== turnId
    )
      return;
    const { budget } = operation;
    if (status !== "completed") {
      budget.lastCompactedTokens = budget.usedTokens;
      this.#emitError("context_compaction_failed", `Codex context compaction ended with status ${status}.`, agentId);
    }
    this.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
    this.#release(operation, true);
    this.#scheduleDrain(agentId);
  }

  /** Drops a retired thread's budget, but keeps its live operation until it ends. */
  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
    const displayed = this.#display.delete(threadId);
    this.#durations.delete(threadId);
    this.#awaitingPostCompaction.delete(threadId);
    if (displayed) this.#emitChanged();
  }

  forgetAgent(agentId: string): void {
    const input = this.#inputs.get(agentId);
    if (input) this.settleInput(input, false);
    this.#inputs.delete(agentId);
    const operation = this.#operations.get(agentId);
    if (operation) this.#release(operation);
  }

  /** Called after this exact provider process has exited or its stop has completed. */
  clientEnded(client: AgentClient): void {
    for (const input of this.#inputs.values()) {
      if (input.client !== client) continue;
      input.terminal = true;
      this.#wakeInput(input);
    }
    for (const operation of this.#operations.values()) {
      if (operation.client !== client) continue;
      this.abandonCompaction(operation.threadId);
      this.#release(operation, true);
      this.#scheduleDrain(operation.agentId);
    }
  }

  beginInput(agentId: string, threadId: string, client: AgentClient): CompactionInputAttempt {
    const previous = this.#inputFor(agentId, threadId, client);
    if (previous && !previous.refused) return previous;
    const operation = this.#operations.get(agentId);
    const input: CompactionInputAttempt = {
      agentId,
      threadId,
      client,
      association: Deferred.makeUnsafe<boolean>(),
      operation: operation?.threadId === threadId && operation.client === client ? operation : null,
      turnId: null,
      active: false,
      terminal: false,
      refused: false,
    };
    this.#inputs.set(agentId, input);
    return input;
  }

  /** Delay mailbox association until this exact request has a known result. */
  inputAssociation(agentId: string, threadId: string, client: AgentClient): Effect.Effect<boolean> {
    const input = this.#inputFor(agentId, threadId, client);
    // A late Codex start after an uncertain RPC has no input receipt. Its activity cannot claim pending input.
    return input ? Deferred.await(input.association) : Effect.succeed(client.provider !== "codex");
  }

  settleInput(input: CompactionInputAttempt, mayHaveAccepted: boolean): void {
    Deferred.doneUnsafe(input.association, Effect.succeed(mayHaveAccepted));
    if (!input.refused && this.#inputs.get(input.agentId) === input) this.#inputs.delete(input.agentId);
  }

  refuseInput(input: CompactionInputAttempt): void {
    if (this.#inputs.get(input.agentId) !== input) return;
    input.refused = true;
    // A completed captured owner remains evidence after it leaves the current-operation map.
    if (input.operation?.ended) input.terminal = true;
    this.settleInput(input, false);
    this.#wakeInput(input);
  }

  observeStarted(agentId: string, threadId: string, turnId: string, client: AgentClient): void {
    const input = this.#inputFor(agentId, threadId, client);
    if (!input) return;
    input.turnId = turnId;
    input.active = true;
    input.terminal = false;
  }

  observeCompleted(agentId: string, threadId: string, turnId: string, client: AgentClient): void {
    const input = this.#inputFor(agentId, threadId, client);
    if (!input || input.turnId !== turnId) return;
    input.active = false;
    input.terminal = true;
    this.#wakeInput(input);
  }

  /** Pinned Codex publishes Active before turn/started and Idle before turn/completed. */
  observeStatus(agentId: string, threadId: string, status: "active" | "idle", client: AgentClient): void {
    const input = this.#inputFor(agentId, threadId, client);
    if (!input) return;
    if (status === "active") {
      input.active = true;
      input.terminal = false;
    } else if (input.active) {
      input.active = false;
      input.terminal = true;
      this.#wakeInput(input);
    }
  }

  #inputFor(agentId: string, threadId: string, client: AgentClient): CompactionInputAttempt | undefined {
    const input = this.#inputs.get(agentId);
    return input?.threadId === threadId && input.client === client ? input : undefined;
  }

  #wakeInput(input: CompactionInputAttempt): void {
    if (!input.refused || !input.terminal || this.#inputs.get(input.agentId) !== input) return;
    this.#inputs.delete(input.agentId);
    this.#scheduleDrain(input.agentId);
  }

  dispose(): void {
    if (this.#usageTimer) clearTimeout(this.#usageTimer);
    this.#usageTimer = null;
    for (const operation of this.#operations.values()) this.#release(operation);
    for (const input of this.#inputs.values()) Deferred.doneUnsafe(input.association, Effect.succeed(false));
    this.#inputs.clear();
    this.#budgets.clear();
    this.#display.clear();
    this.#durations.clear();
    this.#awaitingPostCompaction.clear();
  }

  #release(operation: CompactionOperation, ended = false): void {
    if (this.#operations.get(operation.agentId) !== operation) return;
    if (operation.timer) clearTimeout(operation.timer);
    operation.timer = null;
    operation.budget.pending = false;
    operation.budget.phase = "idle";
    operation.budget.compactionTurnId = null;
    operation.ended = ended;
    this.#operations.delete(operation.agentId);
    const input = operation.client
      ? this.#inputFor(operation.agentId, operation.threadId, operation.client)
      : undefined;
    if (ended && input?.operation === operation) {
      input.terminal = true;
      this.#wakeInput(input);
    }
  }
}

class ContextCompactionFailed extends Schema.TaggedError<ContextCompactionFailed>()("ContextCompactionFailed", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toContextCompactionFailed } = causeHelpers(ContextCompactionFailed);
