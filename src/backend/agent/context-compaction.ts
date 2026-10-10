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

  constructor(options: ContextCompactionOptions) {
    this.#store = options.store;
    this.#providers = options.providers;
    this.#emitError = options.emitError;
    this.#scheduleDrain = options.scheduleDrain;
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
    if (usedTokens === null || contextWindow === null || contextWindow <= 0) return;

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
    if (budget.phase !== "requested" || !client || !client.running || !this.#providers.isReady()) {
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
            // The host's Claude and ACP adapters acknowledge this method as a no-op. They manage
            // compaction themselves and send no owned compaction lifecycle for this request.
            if (client.provider === "codex" || this.#operations.get(agentId) !== operation) return;
            budget.lastCompactedTokens = budget.usedTokens;
            this.#release(operation);
            this.#scheduleDrain(agentId);
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (this.#operations.get(agentId) !== operation) return;
            budget.lastCompactedTokens = budget.usedTokens;
            // A JSON-RPC method/parameter rejection confirms that this request did not start a
            // turn. An unanswered request or transport failure does not. A lifecycle start already
            // associated with this operation also wins over a late error response.
            const error = failure.cause;
            if (
              budget.compactionTurnId === null &&
              client.provider === "codex" &&
              isCodexCompactionStartRejected(error)
            ) {
              this.#emitError("context_compaction_failed", error, agentId);
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
    this.#release(operation, true);
    this.#scheduleDrain(agentId);
  }

  /** Drops a retired thread's budget, but keeps its live operation until it ends. */
  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
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
    for (const operation of this.#operations.values()) this.#release(operation);
    for (const input of this.#inputs.values()) Deferred.doneUnsafe(input.association, Effect.succeed(false));
    this.#inputs.clear();
    this.#budgets.clear();
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
