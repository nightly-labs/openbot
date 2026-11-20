import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentContextCategoryUsage, AgentContextState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import { decodeRecordResponse, getRecord } from "../protocol";
import { finiteNumberOrNull } from "./account-usage";
import type { ProviderPort } from "./provider-runtime";
import type { ThreadOperationFailed } from "./thread-lifecycle";

interface ThreadContextBudget {
  usedTokens: number;
  contextWindow: number;
  pending: boolean;
  phase: "idle" | "requested" | "running" | "stopping";
  compactionTurnId: string | null;
  lastCompactedTokens: number | null;
  ineffectiveCompactions: number;
  failedCompactions: number;
  awaitingUsage: boolean;
  compactionResultTokens: number | null;
  repeatedCompactions: number;
}

const logger = createOpenBotLogger("context-compaction");

const CONTEXT_COMPACTION_THRESHOLD = 0.8;
const INEFFECTIVE_COMPACTION_SHARE = CONTEXT_COMPACTION_THRESHOLD - 0.1;
const INEFFECTIVE_COMPACTION_LIMIT = 2;
const FAILED_COMPACTION_LIMIT = 2;
const REPEATED_COMPACTION_LIMIT = 2;

function minimumGrowth(contextWindow: number): number {
  return Math.max(1_024, Math.floor(contextWindow * 0.05));
}

function unknownBudget(): ThreadContextBudget {
  return {
    usedTokens: 0,
    contextWindow: 1,
    pending: false,
    phase: "idle",
    compactionTurnId: null,
    lastCompactedTokens: null,
    ineffectiveCompactions: 0,
    failedCompactions: 0,
    awaitingUsage: false,
    compactionResultTokens: null,
    repeatedCompactions: 0,
  };
}

function stopped(budget: ThreadContextBudget): boolean {
  return (
    budget.ineffectiveCompactions >= INEFFECTIVE_COMPACTION_LIMIT || budget.failedCompactions >= FAILED_COMPACTION_LIMIT
  );
}
const RETRY_COMPACTION_SHARE = 0.5;
const CHARACTERS_PER_TOKEN = 4;
const CONTEXT_COMPACTION_TIMEOUT_MS = 120_000;
const CONTEXT_COMPACTION_RUN_FACTOR = 10;
export const USAGE_CHANGE_DELAY_MS = 250;

export interface ContextCompactionOptions {
  timeoutMs?: number | undefined;
  store: AgentStore;
  providers: ProviderPort;
  emitError(code: string, error: unknown, agentId?: string): void;
  scheduleDrain(agentId: string): void;
  rotateSession(
    agentId: string,
    client: AgentClient,
    threadId: string,
  ): Effect.Effect<string | null, ThreadOperationFailed>;
  loadSession(agentId: string, client: AgentClient, threadId: string): Effect.Effect<boolean, ThreadOperationFailed>;
  rotatesSession(agentId: string, threadId: string): boolean;
  isStopping(): boolean;
  changed?(): void;
  compacted?(threadId: string): void;
}

export function compactsOnRequest(mode: AgentClient["contextCompaction"]): boolean {
  return mode === "events" || mode === "request" || mode === "handoff";
}

interface CompactionHold {
  agentId: string;
  client: AgentClient | null;
  turnId: string | null;
}

interface RefusalHold {
  agentId: string;
  client: AgentClient;
  timer: NodeJS.Timeout;
}

export class ContextCompaction {
  readonly #store: AgentStore;
  readonly #providers: ProviderPort;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #scheduleDrain: (agentId: string) => void;
  readonly #rotateSession: ContextCompactionOptions["rotateSession"];
  readonly #loadSession: ContextCompactionOptions["loadSession"];
  readonly #rotatesSession: ContextCompactionOptions["rotatesSession"];
  readonly #isStopping: () => boolean;
  readonly #budgets = new Map<string, ThreadContextBudget>();
  readonly #compacting = new Map<string, CompactionHold>();
  readonly #refusals = new Map<string, RefusalHold>();
  readonly #timeoutMs: number;
  readonly #runTimeoutMs: number;
  readonly #graceMs: number;
  readonly #display = new Map<string, Omit<AgentContextState, "agentId" | "threadId">>();
  readonly #awaitingPostCompaction = new Set<string>();
  readonly #estimating = new Set<string>();
  readonly #durations = new Map<string, number>();
  readonly #changed: () => void;
  readonly #compacted: (threadId: string) => void;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  #usageTimer: NodeJS.Timeout | null = null;

  constructor(options: ContextCompactionOptions) {
    this.#changed = options.changed ?? (() => {});
    this.#compacted = options.compacted ?? (() => {});
    this.#timeoutMs = options.timeoutMs ?? CONTEXT_COMPACTION_TIMEOUT_MS;
    this.#runTimeoutMs = this.#timeoutMs * CONTEXT_COMPACTION_RUN_FACTOR;
    this.#graceMs = Math.ceil(this.#timeoutMs / 4);
    this.#store = options.store;
    this.#providers = options.providers;
    this.#emitError = options.emitError;
    this.#scheduleDrain = options.scheduleDrain;
    this.#rotateSession = options.rotateSession;
    this.#loadSession = options.loadSession;
    this.#rotatesSession = options.rotatesSession;
    this.#isStopping = options.isStopping;
  }

  get runTimeoutMs(): number {
    return this.#runTimeoutMs;
  }

  snapshot(): AgentContextState[] {
    return this.#store.list().flatMap((agent) => {
      const session = agent.threadId
        ? this.#store.database.activeProviderSession(agent.threadId, agent.provider)
        : null;
      const display = session ? this.#display.get(session.externalSessionId) : null;
      return display && agent.threadId ? [{ agentId: agent.id, threadId: agent.threadId, ...display }] : [];
    });
  }

  threadSnapshot(threads: Array<{ id: string; threadId: string }>): AgentContextState[] {
    if (this.#display.size === 0) return [];
    const agents = new Map(this.#store.list().map((agent) => [agent.id, agent]));
    return threads
      .flatMap(({ id: agentId, threadId }) => {
        const agent = agents.get(agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        const display = session ? this.#display.get(session.externalSessionId) : null;
        if (!agent || !display) return [];
        const handoff = this.#providers.clientForAgent(agent)?.contextCompaction === "handoff";
        const usage = display.usage && handoff ? { ...display.usage, autoCompactAt: null } : display.usage;
        return [{ agentId, threadId, usage, compaction: display.compaction }];
      })
      .slice(0, INPUT_LIMITS.agents * INPUT_LIMITS.agentTasks);
  }

  observeUsage(
    threadId: string,
    usedTokens: number,
    windowTokens: number,
    nativeManaged: boolean,
    autoCompactAt: number | null,
    estimated = false,
    categories?: AgentContextCategoryUsage[],
  ): void {
    if (!Number.isFinite(usedTokens) || usedTokens < 0 || !Number.isFinite(windowTokens) || windowTokens <= 0) return;
    const display = this.#display.get(threadId) ?? { usage: null, compaction: null };
    const previous = display.usage;
    display.usage = {
      usedTokens,
      windowTokens,
      nativeManaged,
      autoCompactAt,
      estimated,
      ...(categories ? { categories } : {}),
    };
    const after = display.compaction?.status === "completed" && this.#awaitingPostCompaction.delete(threadId);
    if (after && display.compaction) display.compaction.afterTokens = usedTokens;
    this.#display.set(threadId, display);
    if (after || JSON.stringify(previous) !== JSON.stringify(display.usage)) this.#scheduleUsageChange();
  }

  #scheduleUsageChange(): void {
    if (this.#isStopping()) return;
    this.#usageTimer ??= setTimeout(() => {
      this.#usageTimer = null;
      this.#changed();
    }, USAGE_CHANGE_DELAY_MS);
  }

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
    if (tokenComparison === "context" && status === "running") this.#estimating.add(threadId);
    else this.#estimating.delete(threadId);
    if (tokenComparison === "context" && status === "completed" && compaction.afterTokens === undefined)
      this.#awaitingPostCompaction.add(threadId);
    if (status === "completed" && previous?.status === "running")
      this.#durations.set(threadId, Math.max(1, Date.now() - startedAt));
    this.#display.set(threadId, display);
    this.#emitChanged();
    if (status === "completed") this.#compacted(threadId);
  }

  abandonCompaction(threadId: string): void {
    if (this.#display.get(threadId)?.compaction?.status === "running") this.observeCompaction(threadId, "failed");
  }

  beginTurn(threadId: string): void {
    this.#awaitingPostCompaction.delete(threadId);
  }

  mayDrain(agentId: string): boolean {
    return this.heldThreads(agentId).length === 0;
  }

  heldThreads(agentId: string): string[] {
    const held = new Set<string>();
    for (const [threadId, compaction] of this.#compacting) if (compaction.agentId === agentId) held.add(threadId);
    for (const [threadId, hold] of this.#refusals) if (hold.agentId === agentId) held.add(threadId);
    return [...held];
  }

  updateBudget(threadId: string, params: unknown, agentId?: string): void {
    const usage = getRecord(params, "tokenUsage");
    const last = getRecord(usage, "last");
    const usedTokens = finiteNumberOrNull(last?.totalTokens);
    const contextWindow = finiteNumberOrNull(usage?.modelContextWindow);
    if (usedTokens === null || usedTokens < 0 || contextWindow === null || contextWindow <= 0) return;

    if (this.#estimating.has(threadId)) return;

    const budget = this.#budgets.get(threadId) ?? {
      usedTokens,
      contextWindow,
      pending: false,
      phase: "idle" as const,
      compactionTurnId: null,
      lastCompactedTokens: null,
      ineffectiveCompactions: 0,
      failedCompactions: 0,
      awaitingUsage: false,
      compactionResultTokens: null,
      repeatedCompactions: 0,
    };
    budget.usedTokens = usedTokens;
    budget.contextWindow = contextWindow;
    this.#budgets.set(threadId, budget);
    const afterCompaction = budget.awaitingUsage || this.#awaitingPostCompaction.has(threadId);
    budget.awaitingUsage = false;
    if (afterCompaction) {
      budget.compactionResultTokens = usedTokens;
      this.#checkCompaction(budget, agentId);
    }

    const pressured = usedTokens / contextWindow >= CONTEXT_COMPACTION_THRESHOLD;
    if (!pressured) {
      budget.pending = false;
      budget.lastCompactedTokens = null;
      budget.failedCompactions = 0;
      if (usedTokens / contextWindow < INEFFECTIVE_COMPACTION_SHARE) budget.ineffectiveCompactions = 0;
      return;
    }
    if (budget.phase !== "idle") return;
    if (stopped(budget)) {
      budget.pending = false;
      return;
    }

    if (budget.lastCompactedTokens !== null && usedTokens < budget.lastCompactedTokens + minimumGrowth(contextWindow)) {
      return;
    }
    budget.pending = true;
  }

  retrying(threadId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (
      !budget ||
      budget.contextWindow <= 1 ||
      budget.usedTokens / budget.contextWindow < RETRY_COMPACTION_SHARE ||
      stopped(budget) ||
      budget.awaitingUsage
    )
      return false;
    if (budget.phase === "idle") budget.pending = true;
    return true;
  }

  expectInput(threadId: string, characters: number): void {
    const budget = this.#budgets.get(threadId);
    if (
      !budget ||
      budget.pending ||
      budget.phase !== "idle" ||
      budget.contextWindow <= 1 ||
      stopped(budget) ||
      (budget.lastCompactedTokens !== null && budget.usedTokens <= budget.lastCompactedTokens)
    )
      return;
    const estimated = budget.usedTokens + Math.ceil(characters / CHARACTERS_PER_TOKEN);
    if (estimated / budget.contextWindow < CONTEXT_COMPACTION_THRESHOLD) return;
    budget.pending = true;
    logger.info("The next input fills the session, so it compacts first.", {
      usedPercent: Math.round((budget.usedTokens / budget.contextWindow) * 100),
      estimatedPercent: Math.round((estimated / budget.contextWindow) * 100),
    });
  }

  repeatsCompaction(threadId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (!budget || budget.compactionResultTokens === null || budget.contextWindow <= 1) return false;
    const grown = budget.usedTokens - budget.compactionResultTokens >= minimumGrowth(budget.contextWindow);
    budget.compactionResultTokens = null;
    budget.repeatedCompactions = grown ? 0 : budget.repeatedCompactions + 1;
    if (!grown)
      logger.warn("The provider compacted again with no growth since the last compaction.", {
        usedPercent: Math.round((budget.usedTokens / budget.contextWindow) * 100),
        repeatedCompactions: budget.repeatedCompactions,
      });
    return budget.repeatedCompactions >= REPEATED_COMPACTION_LIMIT;
  }

  usedPercent(threadId: string): number | null {
    const budget = this.#budgets.get(threadId);
    return budget && budget.contextWindow > 1 ? Math.round((budget.usedTokens / budget.contextWindow) * 100) : null;
  }

  #checkCompaction(budget: ThreadContextBudget, agentId: string | undefined): void {
    const share = budget.usedTokens / budget.contextWindow;
    if (share < INEFFECTIVE_COMPACTION_SHARE) {
      budget.ineffectiveCompactions = 0;
      return;
    }
    budget.ineffectiveCompactions += 1;
    const percent = Math.round(share * 100);
    logger.warn("A compaction left the session almost full.", {
      usedPercent: percent,
      contextWindow: budget.contextWindow,
      ineffectiveCompactions: budget.ineffectiveCompactions,
    });
    if (budget.ineffectiveCompactions === INEFFECTIVE_COMPACTION_LIMIT)
      this.#emitError(
        "context_compaction_ineffective",
        sourceText("error.backend.contextCompactionIneffective", { percent: String(percent) }),
        agentId,
      );
  }

  #countFailure(threadId: string, agentId: string): void {
    const budget = this.#budgets.get(threadId);
    if (!budget) return;
    budget.failedCompactions += 1;
    logger.warn("A compaction failed.", { failedCompactions: budget.failedCompactions });
    if (budget.failedCompactions === FAILED_COMPACTION_LIMIT)
      this.#emitError("context_compaction_stopped", sourceText("error.backend.contextCompactionStopped"), agentId);
  }

  contextInputCharacters(threadId: string): number {
    const budget = this.#budgets.get(threadId);
    return budget && budget.contextWindow > 1 ? Math.min(120_000, Math.floor(budget.contextWindow * 2)) : 120_000;
  }

  reserve(agentId: string, threadId: string, manual = false, turnId: string | null = null): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    if (!agent || !compactsOnRequest(mode)) return false;
    if (mode === "handoff" && !this.#rotatesSession(agentId, threadId)) return false;
    const budget = this.#budgets.get(threadId) ?? (manual ? unknownBudget() : undefined);
    if (!(budget?.pending || (manual && budget)) || budget.phase !== "idle" || this.#compacting.has(threadId)) {
      return false;
    }
    this.#budgets.set(threadId, budget);
    budget.phase = "requested";
    this.#compacting.set(threadId, { agentId, client: null, turnId });
    this.observeCompaction(threadId, "running");
    return true;
  }

  dropReservation(agentId: string, threadId: string, turnId: string): void {
    const compaction = this.#compacting.get(threadId);
    if (compaction?.turnId === turnId && compaction.agentId === agentId) this.#abandon(agentId, threadId);
  }

  readonly request = Effect.fn("ContextCompaction.request")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
  ) {
    const reservation = this.#compacting.get(threadId);
    if (reservation) reservation.turnId = null;
    const budget = this.#budgets.get(threadId);
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const client = agent ? this.#providers.clientForAgent(agent) : null;
    if (
      budget?.phase !== "requested" ||
      !agent ||
      !client ||
      !compactsOnRequest(client.contextCompaction) ||
      !this.#providers.isReady()
    ) {
      if (budget?.phase === "requested") this.observeCompaction(threadId, "failed");
      this.#release(agentId, threadId);
      return;
    }
    if (client.contextCompaction === "handoff") {
      yield* this.#rotate(agentId, threadId, client);
      return;
    }

    const hold: CompactionHold = { agentId, client, turnId: null };
    this.#compacting.set(threadId, hold);
    const runsInRequest = client.contextCompaction === "request";

    yield* this.#loadSession(agentId, client, threadId)
      .pipe(
        Effect.flatMap((loaded) => {
          if (this.#compacting.get(threadId) !== hold || this.#budgets.get(threadId) !== budget)
            return Effect.succeed(false);
          if (!loaded) {
            budget.lastCompactedTokens = budget.usedTokens;
            this.observeCompaction(threadId, "failed");
            this.#release(agentId, threadId);
            this.#scheduleDrain(agentId);
            return Effect.succeed(false);
          }
          this.#armDeadline(agentId, threadId, client, runsInRequest ? this.#runTimeoutMs : this.#timeoutMs);
          return client
            .request(
              "thread/compact/start",
              runsInRequest ? { threadId, cwd: agent.workspacePath } : { threadId },
              decodeRecordResponse,
              runsInRequest ? this.#runTimeoutMs : undefined,
            )
            .pipe(Effect.as(true));
        }),
      )
      .pipe(toContextCompactionFailed)
      .pipe(
        Effect.tap((started) =>
          Effect.sync(() => {
            if (started && client.contextCompaction === "request" && budget.phase === "requested") {
              this.markCompacted(threadId);
              this.finish(agentId, threadId, "completed");
            }
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            if (budget.phase === "running" || budget.phase === "stopping") return;
            const current = this.#compacting.get(threadId);
            if (current && current !== hold) return;
            budget.lastCompactedTokens = budget.usedTokens;
            this.#emitError("context_compaction_failed", failure.cause, agentId);
            if (budget.phase === "requested") this.#countFailure(threadId, agentId);
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

  claimTurn(agentId: string, threadId: string, turnId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (budget?.phase !== "requested" || this.#compacting.get(threadId)?.agentId !== agentId) return false;
    budget.phase = "running";
    budget.compactionTurnId = turnId;
    const client = this.#compacting.get(threadId)?.client;
    if (client) this.#armDeadline(agentId, threadId, client, this.#runTimeoutMs);
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
    budget.awaitingUsage = true;
  }

  finish(agentId: string, threadId: string, status: string): void {
    const budget = this.#budgets.get(threadId);
    if (budget && status === "completed") budget.failedCompactions = 0;
    if (budget && status !== "completed") {
      budget.lastCompactedTokens = budget.usedTokens;
      if (budget.phase !== "stopping") {
        this.#emitError("context_compaction_failed", `Codex context compaction ended with status ${status}.`, agentId);
        this.#countFailure(threadId, agentId);
      }
    }
    this.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
    const displayed = this.#display.delete(threadId);
    this.#durations.delete(threadId);
    this.#awaitingPostCompaction.delete(threadId);
    this.#estimating.delete(threadId);
    if (displayed) this.#emitChanged();
    this.#clearTimer(threadId);
  }

  endThread(threadId: string): void {
    const compaction = this.#compacting.get(threadId);
    this.#compacting.delete(threadId);
    this.forgetThread(threadId);
    this.#endRefusal(threadId);
    if (compaction) this.#scheduleDrain(compaction.agentId);
  }

  forgetAgent(agentId: string): void {
    for (const [threadId, compaction] of this.#compacting)
      if (compaction.agentId === agentId) this.#compacting.delete(threadId);
    for (const [threadId, hold] of this.#refusals) if (hold.agentId === agentId) this.#endRefusal(threadId, false);
  }

  holdForRefusal(agentId: string, threadId: string, client: AgentClient): void {
    this.#endRefusal(threadId, false);
    const timer = setTimeout(() => this.#endRefusal(threadId), this.#graceMs);
    timer.unref?.();
    this.#refusals.set(threadId, { agentId, client, timer });
  }

  threadTurnEnded(threadId: string): void {
    this.#endRefusal(threadId);
  }

  clientEnded(client: AgentClient): void {
    for (const [threadId, compaction] of this.#compacting) {
      if (compaction.client !== client) continue;
      this.observeCompaction(threadId, "failed");
      this.#release(compaction.agentId, threadId);
      this.#scheduleDrain(compaction.agentId);
    }
    for (const [threadId, hold] of this.#refusals) if (hold.client === client) this.#endRefusal(threadId);
  }

  dispose(): void {
    if (this.#usageTimer) clearTimeout(this.#usageTimer);
    this.#usageTimer = null;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#compacting.clear();
    for (const hold of this.#refusals.values()) clearTimeout(hold.timer);
    this.#refusals.clear();
    this.#budgets.clear();
    this.#display.clear();
    this.#durations.clear();
    this.#awaitingPostCompaction.clear();
    this.#estimating.clear();
  }

  #stop(agentId: string, threadId: string, client: AgentClient, turnId: string): void {
    const budget = this.#budgets.get(threadId);
    if (!budget) return;
    budget.phase = "stopping";
    const timer = setTimeout(() => this.#abandon(agentId, threadId), this.#graceMs);
    timer.unref?.();
    this.#timers.set(threadId, timer);
    Effect.runFork(
      client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            const current = this.#budgets.get(threadId) === budget;
            if (current && budget.phase === "stopping" && budget.compactionTurnId === turnId) {
              this.#abandon(agentId, threadId);
            }
          }),
        ),
      ),
    );
  }

  readonly #rotate = Effect.fn("ContextCompaction.rotate")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
    client: AgentClient,
  ) {
    const compaction = this.#display.get(threadId)?.compaction;
    const compactedTokens = this.#budgets.get(threadId)?.usedTokens ?? null;
    const next = yield* this.#rotateSession(agentId, client, threadId).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#emitError("context_compaction_failed", failure.cause, agentId);
          this.#countFailure(threadId, agentId);
          return undefined;
        }),
      ),
    );
    if (next && compaction) {
      const { id, startedAt, expectedMs } = compaction;
      this.#display.set(next, {
        usage: null,
        compaction: { id, startedAt, status: "completed", ...(expectedMs === undefined ? {} : { expectedMs }) },
      });
    }
    if (next)
      this.#budgets.set(next, {
        ...unknownBudget(),
        lastCompactedTokens: compactedTokens,
        ineffectiveCompactions: this.#budgets.get(threadId)?.ineffectiveCompactions ?? 0,
        awaitingUsage: true,
      });
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.lastCompactedTokens = budget.usedTokens;
      this.observeCompaction(threadId, "failed");
    }
    this.#release(agentId, threadId);
    this.#emitChanged();
    this.#scheduleDrain(agentId);
  });

  #armDeadline(agentId: string, threadId: string, client: AgentClient, ms: number): void {
    this.#clearTimer(threadId);
    const timer = setTimeout(() => {
      this.#emitError(
        "context_compaction_timeout",
        "Codex context compaction timed out; queued work will continue.",
        agentId,
      );
      this.#countFailure(threadId, agentId);
      const budget = this.#budgets.get(threadId);
      if (budget) budget.lastCompactedTokens = budget.usedTokens;
      const turnId = budget?.compactionTurnId;
      if (budget?.phase === "running" && turnId) this.#stop(agentId, threadId, client, turnId);
      else this.#abandon(agentId, threadId);
    }, ms);
    timer.unref?.();
    this.#timers.set(threadId, timer);
  }

  #abandon(agentId: string, threadId: string): void {
    this.observeCompaction(threadId, "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  #endRefusal(threadId: string, drain = true): void {
    const hold = this.#refusals.get(threadId);
    if (!hold) return;
    clearTimeout(hold.timer);
    this.#refusals.delete(threadId);
    if (drain) this.#scheduleDrain(hold.agentId);
  }

  #release(agentId: string, threadId: string): void {
    this.#clearTimer(threadId);
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.pending = false;
      budget.phase = "idle";
      budget.compactionTurnId = null;
    }
    if (this.#compacting.get(threadId)?.agentId === agentId) this.#compacting.delete(threadId);
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
