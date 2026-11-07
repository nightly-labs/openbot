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
  /** `stopping`: the deadline asked Codex to stop the compaction turn, and the queue waits for its end. */
  phase: "idle" | "requested" | "running" | "stopping";
  compactionTurnId: string | null;
  lastCompactedTokens: number | null;
  /** Compactions in a row after which the session still filled `INEFFECTIVE_COMPACTION_SHARE` of its window. */
  ineffectiveCompactions: number;
  /** Compactions in a row that the provider ran or refused and that did not complete. */
  failedCompactions: number;
  /**
   * A compaction or a rotation ended and no usage came since, so the next usage tells whether it
   * helped. A new turn does not end the wait: a turn that fails after retries reports no usage (#4819).
   */
  awaitingUsage: boolean;
}

const logger = createOpenBotLogger("context-compaction");

const CONTEXT_COMPACTION_THRESHOLD = 0.8;
/**
 * A session that a compaction leaves at this share of its window holds mostly what no compaction
 * removes: tool schemas, instructions, and the newest messages. Codex compacted such a session five
 * times in five minutes, and each tool result was cut off (#3905). A session left at the threshold or
 * above compacts again after a small growth or a retry, so a share between the threshold and 90%
 * compacted it without end (#5150). A session left just below the threshold reached it again after
 * one turn: one chat compacted 25 times in 27 minutes.
 */
const INEFFECTIVE_COMPACTION_SHARE = CONTEXT_COMPACTION_THRESHOLD - 0.1;
/** After this many such compactions in a row, OpenBot stops asking for more and tells the user. */
const INEFFECTIVE_COMPACTION_LIMIT = 2;
/**
 * After this many failed compactions in a row, OpenBot stops asking for more and tells the user. A
 * failed compaction leaves the session full, and each one sends the whole session to the model: one
 * session compacted every 19 seconds for 7 hours and used up the plan limit.
 */
const FAILED_COMPACTION_LIMIT = 2;

/** Whether OpenBot asks for no more automatic compactions of this session. "Compact now" still works. */
function stopped(budget: ThreadContextBudget): boolean {
  return (
    budget.ineffectiveCompactions >= INEFFECTIVE_COMPACTION_LIMIT || budget.failedCompactions >= FAILED_COMPACTION_LIMIT
  );
}
/**
 * A provider that retries a request of a session at this share of its window can be refused for the
 * request size, and it sends the same request again until the turn fails (#4374). The next turn of
 * such a session compacts first.
 */
const RETRY_COMPACTION_SHARE = 0.5;
/** About four characters of text make one token. Only the compaction estimate uses it. */
const CHARACTERS_PER_TOKEN = 4;
const CONTEXT_COMPACTION_TIMEOUT_MS = 120_000;
/**
 * A started compaction of a long thread can take minutes (#3466). Its deadline is this many times
 * the start deadline, so it only ends a compaction that hangs.
 */
const CONTEXT_COMPACTION_RUN_FACTOR = 10;
/** Usage arrives after each model step; one runtime snapshot carries the latest value of a burst. */
export const USAGE_CHANGE_DELAY_MS = 250;

export interface ContextCompactionOptions {
  /**
   * How long the provider takes to start a compaction before OpenBot stops it. A started compaction
   * runs `CONTEXT_COMPACTION_RUN_FACTOR` times as long. Tests make it short.
   */
  timeoutMs?: number | undefined;
  store: AgentStore;
  providers: ProviderPort;
  emitError(code: string, error: unknown, agentId?: string): void;
  scheduleDrain(agentId: string): void;
  /** Replaces the session for a `handoff` compaction. The new session, or `null` when none replaced it. */
  rotateSession(
    agentId: string,
    client: AgentClient,
    threadId: string,
  ): Effect.Effect<string | null, ThreadOperationFailed>;
  /** Whether `rotateSession` can replace this session. See `ThreadLifecycle.rotatesSession`. */
  rotatesSession(agentId: string, threadId: string): boolean;
  /** The service stops: its database can close before a provider stops reporting usage. */
  isStopping(): boolean;
  changed?(): void;
  /** A provider session finished a compaction: its summary replaces what it read before. */
  compacted?(threadId: string): void;
}

/** Whether OpenBot can ask for a compaction of this client, automatically or for the user. */
export function compactsOnRequest(mode: AgentClient["contextCompaction"]): boolean {
  return mode === "events" || mode === "request" || mode === "handoff";
}

/** A queue that Codex refused because a compaction turn runs on the provider thread of its key. */
interface RefusalHold {
  agentId: string;
  client: AgentClient;
  timer: NodeJS.Timeout;
}

/**
 * Decides when a provider thread is close enough to its context window to compact, and drives the
 * compaction turn.
 *
 * A compaction is a real provider turn, so it arrives on the same notification stream as the
 * agent's own work and has to be told apart from it: `claimTurn` swallows the `turn/started` that
 * belongs to the compaction, and `isCompactionTurn` recognizes its completion. The budget is keyed
 * by *external* provider thread id, and so are the compactions and refusals: the threads of one agent run
 * in parallel, so a compaction holds the lane of its own thread only (`heldThreads`).
 *
 * Codex refuses input while a compaction turn runs, so the hold lasts until that turn ends: the
 * deadline stops the turn instead of releasing the queue, and a refused `turn/start` puts its
 * messages back to wait for the end of the turn. A hold of a client that ended ends with it.
 */
export class ContextCompaction {
  readonly #store: AgentStore;
  readonly #providers: ProviderPort;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #scheduleDrain: (agentId: string) => void;
  readonly #rotateSession: ContextCompactionOptions["rotateSession"];
  readonly #rotatesSession: ContextCompactionOptions["rotatesSession"];
  readonly #isStopping: () => boolean;
  readonly #budgets = new Map<string, ThreadContextBudget>();
  /**
   * The agent of each provider thread that compacts, and the client that runs it once `request` sends it.
   * `turnId`: the turn whose end made the `reserve` hold, until `request` takes the hold.
   */
  readonly #compacting = new Map<string, { agentId: string; client: AgentClient | null; turnId: string | null }>();
  readonly #refusals = new Map<string, RefusalHold>();
  readonly #timeoutMs: number;
  /** How long a started compaction runs before OpenBot stops it. */
  readonly #runTimeoutMs: number;
  /** How long a stopped compaction, or a refused queue, waits for the turn to end. */
  readonly #graceMs: number;
  readonly #display = new Map<string, Omit<AgentContextState, "agentId" | "threadId">>();
  readonly #awaitingPostCompaction = new Set<string>();
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
    this.#rotatesSession = options.rotatesSession;
    this.#isStopping = options.isStopping;
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

  /** The side threads of `threads` (`id` is the agent) that reported their context, keyed by thread id. */
  threadSnapshot(threads: Array<{ id: string; threadId: string }>): AgentContextState[] {
    if (this.#display.size === 0) return [];
    const agents = new Map(this.#store.list().map((agent) => [agent.id, agent]));
    return threads
      .flatMap(({ id: agentId, threadId }) => {
        const agent = agents.get(agentId);
        const session = agent ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        const display = session ? this.#display.get(session.externalSessionId) : null;
        if (!agent || !display) return [];
        // A `handoff` provider compacts only a session it can replace, which a side thread never is, so
        // nothing compacts the thread on its own.
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
    // While the service stops: a timer could read the snapshot after the database closes (#3808).
    if (this.#isStopping()) return;
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
    if (status === "completed") this.#compacted(threadId);
  }

  /** Ends a running compaction whose provider stopped before it reported the result. */
  abandonCompaction(threadId: string): void {
    if (this.#display.get(threadId)?.compaction?.status === "running") this.observeCompaction(threadId, "failed");
  }

  beginTurn(threadId: string): void {
    this.#awaitingPostCompaction.delete(threadId);
  }

  /** False while any provider thread of the agent compacts, or waits after a refused start. */
  mayDrain(agentId: string): boolean {
    return this.heldThreads(agentId).length === 0;
  }

  /** The provider threads of this agent that compact or wait after a refused start. Their lanes wait. */
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
    };
    budget.usedTokens = usedTokens;
    budget.contextWindow = contextWindow;
    this.#budgets.set(threadId, budget);
    // The display mark also covers a compaction that ended in this turn before the session had a
    // budget. `observeUsage` runs next and takes that mark, so it is read here first.
    const afterCompaction = budget.awaitingUsage || this.#awaitingPostCompaction.has(threadId);
    budget.awaitingUsage = false;
    if (afterCompaction) this.#checkCompaction(budget, agentId);

    const pressured = usedTokens / contextWindow >= CONTEXT_COMPACTION_THRESHOLD;
    if (!pressured) {
      budget.pending = false;
      budget.lastCompactedTokens = null;
      budget.failedCompactions = 0;
      // A session that a compaction left just below the threshold keeps its count. One that became
      // smaller in another way, such as with fewer tools, compacts again.
      if (usedTokens / contextWindow < INEFFECTIVE_COMPACTION_SHARE) budget.ineffectiveCompactions = 0;
      return;
    }
    if (budget.phase !== "idle") return;
    // Another compaction leaves the same fixed part, or fails again, so it costs a turn and removes nothing.
    if (stopped(budget)) {
      budget.pending = false;
      return;
    }

    const minimumGrowth = Math.max(1_024, Math.floor(contextWindow * 0.05));
    if (budget.lastCompactedTokens !== null && usedTokens < budget.lastCompactedTokens + minimumGrowth) {
      return;
    }
    budget.pending = true;
  }

  /**
   * The provider retries a failed request of this session. A large session compacts before its next
   * turn, below the usual threshold too. True when it will.
   */
  retrying(threadId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (
      !budget ||
      budget.contextWindow <= 1 ||
      budget.usedTokens / budget.contextWindow < RETRY_COMPACTION_SHARE ||
      stopped(budget) ||
      // Nothing tells yet whether the last compaction helped. Each turn compacted again (#4819).
      budget.awaitingUsage
    )
      return false;
    if (budget.phase === "idle") budget.pending = true;
    return true;
  }

  /**
   * The next turn of this session sends `characters` of new input. When the last usage and that
   * input fill the session over the threshold, it compacts before the turn. A large pasted message
   * went to a session below the threshold, and the provider refused the request again and again
   * (#4374). Usage includes the last answer, so only the new input is added.
   */
  expectInput(threadId: string, characters: number): void {
    const budget = this.#budgets.get(threadId);
    if (
      !budget ||
      budget.pending ||
      budget.phase !== "idle" ||
      budget.contextWindow <= 1 ||
      stopped(budget) ||
      // The usage is from before the last compaction: the provider reports the new size later.
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

  /** The share of its window that the last request of this session used, in percent, or null. */
  usedPercent(threadId: string): number | null {
    const budget = this.#budgets.get(threadId);
    return budget && budget.contextWindow > 1 ? Math.round((budget.usedTokens / budget.contextWindow) * 100) : null;
  }

  /** Counts a compaction that left the session almost full, and tells the user once the count reaches the limit. */
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

  /** Counts a compaction that did not complete, and tells the user once the count reaches the limit. */
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
    // A session that `#rotate` started holds a window of 1 until its first usage report: no window is
    // known yet, and a budget of 2 characters would summarize the channel one character at a time.
    return budget && budget.contextWindow > 1 ? Math.min(120_000, Math.floor(budget.contextWindow * 2)) : 120_000;
  }

  /**
   * `manual`: the user asked, so the thread compacts below the threshold too.
   * `turnId`: the turn whose end reserves, so that only that turn can drop the hold.
   */
  reserve(agentId: string, threadId: string, manual = false, turnId: string | null = null): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    if (!agent || !compactsOnRequest(mode)) return false;
    if (mode === "handoff" && !this.#rotatesSession(agentId, threadId)) return false;
    const budget = this.#budgets.get(threadId);
    if (!(budget?.pending || (manual && budget)) || budget.phase !== "idle" || this.#compacting.has(threadId)) {
      return false;
    }
    budget.phase = "requested";
    this.#compacting.set(threadId, { agentId, client: null, turnId });
    this.observeCompaction(threadId, "running");
    return true;
  }

  /**
   * Ends a hold that `reserve` made at the end of this turn and that `request` did not take: the work
   * between them failed. Only `request` arms a deadline, so the hold stayed until a restart (#4960).
   */
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

    this.#compacting.set(threadId, { agentId, client, turnId: null });
    // A `request` compaction runs inside the request, so it starts now and the request waits as long.
    const runsInRequest = client.contextCompaction === "request";
    this.#armDeadline(agentId, threadId, client, runsInRequest ? this.#runTimeoutMs : this.#timeoutMs);

    yield* client
      .request(
        "thread/compact/start",
        { threadId },
        decodeRecordResponse,
        runsInRequest ? this.#runTimeoutMs : undefined,
      )
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
            // Codex reported the compaction turn, so it runs whatever the answer was. Its end, or
            // the deadline, releases the queue.
            if (budget.phase === "running" || budget.phase === "stopping") return;
            budget.lastCompactedTokens = budget.usedTokens;
            this.#emitError("context_compaction_failed", failure.cause, agentId);
            // After the deadline abandoned it, the phase is idle and the deadline counted it.
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

  /**
   * Takes ownership of a `turn/started` that belongs to a compaction we asked for. True means the
   * router must stop: this turn is not the agent's, so it gets no active turn and no event.
   */
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
    // Not in `markCompacted`: Codex can complete the compaction item and still fail the turn.
    if (budget && status === "completed") budget.failedCompactions = 0;
    if (budget && status !== "completed") {
      budget.lastCompactedTokens = budget.usedTokens;
      // A compaction that the deadline stopped was already reported as timed out, and counted.
      if (budget.phase !== "stopping") {
        this.#emitError("context_compaction_failed", `Codex context compaction ended with status ${status}.`, agentId);
        this.#countFailure(threadId, agentId);
      }
    }
    this.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  /** Drops a retired provider thread's budget. The agent keeps compacting until `forgetAgent`. */
  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
    const displayed = this.#display.delete(threadId);
    this.#durations.delete(threadId);
    this.#awaitingPostCompaction.delete(threadId);
    if (displayed) this.#emitChanged();
    this.#clearTimer(threadId);
  }

  /**
   * The thread was deleted, so no turn of it ends its compaction or a refusal hold. Its hold stayed
   * until a restart, and the agent's own chat, to which a deleted session maps, waited behind it.
   */
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

  /**
   * Codex refused input because a compaction turn runs on `threadId`, such as one that outlived its
   * deadline. The lane of that thread waits for a turn of it to end, for `graceMs` at most: a
   * refusal proves that nothing ran, so the next start can only be refused again.
   */
  holdForRefusal(agentId: string, threadId: string, client: AgentClient): void {
    this.#endRefusal(threadId, false);
    const timer = setTimeout(() => this.#endRefusal(threadId), this.#graceMs);
    timer.unref?.();
    this.#refusals.set(threadId, { agentId, client, timer });
  }

  /** A turn of this provider thread ended, so a queue that Codex refused for it can start again. */
  threadTurnEnded(threadId: string): void {
    this.#endRefusal(threadId);
  }

  /** The client stopped or exited, so the compactions and refusals it held end with it. */
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
  }

  /**
   * The deadline came while Codex runs the compaction turn. Codex refuses input until that turn
   * ends, so the queue waits for its `turn/completed`, and for `graceMs` at most.
   */
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
            // After `dispose`, a new compaction of this thread has its own budget.
            const current = this.#budgets.get(threadId) === budget;
            if (current && budget.phase === "stopping" && budget.compactionTurnId === turnId) {
              this.#abandon(agentId, threadId);
            }
          }),
        ),
      ),
    );
  }

  /**
   * A `handoff` compaction. The display moves to the new session: its first model call reports the
   * new usage, and until then the ring has no value to show.
   */
  readonly #rotate = Effect.fn("ContextCompaction.rotate")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
    client: AgentClient,
  ) {
    // The hold keeps no client: `clientEnded` must not release the queue while the rotation runs.
    // The rotation ends the hold itself, also when the client exits.
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
    // No token comparison: the new session reports its usage during its first turn.
    if (next && compaction) {
      const { id, startedAt, expectedMs } = compaction;
      this.#display.set(next, {
        usage: null,
        compaction: { id, startedAt, status: "completed", ...(expectedMs === undefined ? {} : { expectedMs }) },
      });
    }
    // The growth rule moves to the new session, as it stays on a Codex thread: a session that starts
    // above the threshold does not rotate again at each turn.
    if (next)
      this.#budgets.set(next, {
        usedTokens: 0,
        contextWindow: 1,
        pending: false,
        phase: "idle",
        compactionTurnId: null,
        lastCompactedTokens: compactedTokens,
        ineffectiveCompactions: this.#budgets.get(threadId)?.ineffectiveCompactions ?? 0,
        failedCompactions: 0,
        awaitingUsage: true,
      });
    // A session that was not replaced keeps its budget; the growth rule stops an immediate retry.
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.lastCompactedTokens = budget.usedTokens;
      this.observeCompaction(threadId, "failed");
    }
    this.#release(agentId, threadId);
    this.#emitChanged();
    this.#scheduleDrain(agentId);
  });

  /** Stops the compaction of `threadId` after `ms`, in place of an earlier deadline. */
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
      // As after the other failures, the growth rule stops an immediate retry. Without it, the next
      // message asked for a new compaction while Codex still ran the one that ignored the stop.
      if (budget) budget.lastCompactedTokens = budget.usedTokens;
      const turnId = budget?.compactionTurnId;
      if (budget?.phase === "running" && turnId) this.#stop(agentId, threadId, client, turnId);
      else this.#abandon(agentId, threadId);
    }, ms);
    timer.unref?.();
    this.#timers.set(threadId, timer);
  }

  /** Ends a compaction that did not end by itself, and lets the queue continue. */
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
