import { randomUUID } from "node:crypto";
import type { AgentContextState } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { AgentStore } from "../agent-store";
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
 * by *external* provider thread id, `compactingAgents` by agent id, because an agent only ever compacts one
 * thread at a time and the drain guard asks the question by agent.
 */
export class ContextCompaction {
  readonly #store: AgentStore;
  readonly #providers: ProviderPort;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #scheduleDrain: (agentId: string) => void;
  readonly #budgets = new Map<string, ThreadContextBudget>();
  readonly #compactingAgents = new Set<string>();
  readonly #display = new Map<string, Omit<AgentContextState, "agentId" | "threadId">>();
  readonly #awaitingPostCompaction = new Set<string>();
  readonly #durations = new Map<string, number>();
  readonly #changed: () => void;
  readonly #timers = new Map<string, NodeJS.Timeout>();

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
    display.usage = { usedTokens, windowTokens, nativeManaged, autoCompactAt, estimated };
    if (display.compaction?.status === "completed" && this.#awaitingPostCompaction.delete(threadId))
      display.compaction.afterTokens = usedTokens;
    this.#display.set(threadId, display);
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
    this.#changed();
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
    return !this.#compactingAgents.has(agentId);
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
    if (!budget?.pending || budget.phase !== "idle" || this.#compactingAgents.has(agentId)) {
      return false;
    }
    budget.phase = "requested";
    this.#compactingAgents.add(agentId);
    this.observeCompaction(threadId, "running");
    return true;
  }

  readonly request = Effect.fn("ContextCompaction.request")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
  ) {
    const budget = this.#budgets.get(threadId);
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const client = agent ? this.#providers.clientForAgent(agent) : null;
    if (
      budget?.phase !== "requested" ||
      !client ||
      !["events", "request"].includes(client.contextCompaction ?? "unsupported") ||
      !this.#providers.isReady()
    ) {
      if (budget?.phase === "requested") this.observeCompaction(threadId, "failed");
      this.#release(agentId, threadId);
      return;
    }

    this.#clearTimer(threadId);
    const timer = setTimeout(() => {
      this.#emitError(
        "context_compaction_timeout",
        "Codex context compaction timed out; queued work will continue.",
        agentId,
      );
      this.observeCompaction(threadId, "failed");
      this.#release(agentId, threadId);
      this.#scheduleDrain(agentId);
    }, CONTEXT_COMPACTION_TIMEOUT_MS);
    timer.unref?.();
    this.#timers.set(threadId, timer);

    yield* client
      .request("thread/compact/start", { threadId }, decodeRecordResponse)
      .pipe(toContextCompactionFailed)
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (client.contextCompaction === "request" && budget.phase === "requested") {
              this.markCompacted(threadId);
              this.finish(agentId, threadId, "completed");
            }
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            budget.lastCompactedTokens = budget.usedTokens;
            this.#emitError("context_compaction_failed", failure.cause, agentId);
            this.observeCompaction(threadId, "failed");
            this.#release(agentId, threadId);
            this.#scheduleDrain(agentId);
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            this.observeCompaction(threadId, "failed");
            this.#release(agentId, threadId);
            this.#scheduleDrain(agentId);
          }),
        ),
      );
  });

  /**
   * Takes ownership of a `turn/started` that belongs to a compaction we asked for. True means the
   * router must stop: this turn is not the agent's, so it gets no active turn and no event.
   */
  claimTurn(agentId: string, threadId: string, turnId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (budget?.phase !== "requested" || !this.#compactingAgents.has(agentId)) return false;
    budget.phase = "running";
    budget.compactionTurnId = turnId;
    return true;
  }

  isCompactionTurn(threadId: string, turnId: string): boolean {
    return this.#budgets.get(threadId)?.compactionTurnId === turnId;
  }

  markCompacted(threadId: string): void {
    const budget = this.#budgets.get(threadId);
    if (!budget) return;
    budget.pending = false;
    budget.lastCompactedTokens = budget.usedTokens;
  }

  finish(agentId: string, threadId: string, status: string): void {
    const budget = this.#budgets.get(threadId);
    if (budget && status !== "completed") {
      budget.lastCompactedTokens = budget.usedTokens;
      this.#emitError("context_compaction_failed", `Codex context compaction ended with status ${status}.`, agentId);
    }
    this.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  /** Drops a retired provider thread's budget. The agent keeps compacting until `forgetAgent`. */
  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
    this.#display.delete(threadId);
    this.#durations.delete(threadId);
    this.#awaitingPostCompaction.delete(threadId);
    this.#changed();
    this.#clearTimer(threadId);
  }

  forgetAgent(agentId: string): void {
    this.#compactingAgents.delete(agentId);
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#compactingAgents.clear();
    this.#budgets.clear();
    this.#display.clear();
    this.#durations.clear();
    this.#awaitingPostCompaction.clear();
  }

  #release(agentId: string, threadId: string): void {
    this.#clearTimer(threadId);
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.pending = false;
      budget.phase = "idle";
      budget.compactionTurnId = null;
    }
    this.#compactingAgents.delete(agentId);
  }

  #clearTimer(threadId: string): void {
    const timer = this.#timers.get(threadId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(threadId);
  }
}

class ContextCompactionFailed extends Schema.TaggedError<ContextCompactionFailed>()("ContextCompactionFailed", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toContextCompactionFailed } = causeHelpers(ContextCompactionFailed);
