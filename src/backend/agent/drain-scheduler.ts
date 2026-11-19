import { randomUUID } from "node:crypto";
import {
  AGENT_EXCHANGE_ITEM_TYPE,
  AGENT_PROVIDERS,
  AGENT_WELCOME_ITEM_TYPE,
  type AgentModelOption,
  type AgentSummary,
  CHANNEL_RESUME_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { isFixedSourceText, matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { classifyUserError } from "@openbot/user-errors";
import { Deferred, Effect, Result, Schema } from "effect";
import {
  type AgentProvider,
  ProviderModelNotOfferedError,
  ProviderSessionBusyError,
  ProviderStoppedError,
  ProviderTurnActiveError,
} from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { ChannelService } from "../channel-service";
import { incomingAgentExchange } from "../conversation-snapshots";
import { causeHelpers } from "../effect-boundary";
import { channelLane, type DeliveryContext, laneChannelId, type MailboxStore, MESSAGING_LANE } from "../mailbox-store";
import type { MessagingThreads } from "../messaging/messaging-threads";
import { decodeTurnResponse } from "../protocol";
import { ProviderSignInError } from "../provider-client-effects";
import type { ContextCompaction } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import {
  type AnsweredRoutine,
  agentNamesById,
  CURRENT_MESSAGE_SEPARATOR,
  combinedPromptInput,
  deliveryPromptInput,
  restartedResultInput,
  restatedContinuationInput,
  type TagReferenceSource,
} from "./delivery-content";
import type { DuplicationGate } from "./duplication-gate";
import { handoffHasHistory } from "./handoff-history";
import type { MailboxSync } from "./mailbox-sync";
import type { MemoryHold } from "./memory-hold";
import type { PlanContinuation } from "./plan-continuation";
import type { ProfileSave } from "./profile-save";
import { isPlanLimitDiagnostic } from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import type { RoutineScheduler } from "./routine-scheduler";
import { RoutineStartRetry } from "./routine-start-retry";
import { sessionSettingsOverrides } from "./session-settings";
import {
  isCodexCompactionRefusal,
  isCodexThreadInUse,
  isMissingProviderSessionError,
  isRequestTimeout,
  providerForAgent,
  providerLabel,
} from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";
import type { DeliveryStart } from "./turn-lifecycle";
import { TurnSlots } from "./turn-slots";
import type { UsageLimitGate } from "./usage-limit-gate";
import { checkAgentFolders, codexSandboxPolicy, workspaceWritableRoots } from "./workspace-sandbox";

/** Shown to the user when a message names a model of an endpoint that was taken out. */
export const REMOVED_ENDPOINT_MESSAGE = sourceText("error.agent.endpointRemoved");

const logger = createOpenBotLogger("drain-scheduler");
const CHANNEL_START_FAILED = "The provider could not start this assignment. Resume to try again.";
/**
 * The catalog keys of a start that found its provider not downloaded (`cli.ts`). They hold no detail:
 * the one placeholder, in `nativeMissing`, is OpenBot's own provider name.
 */
const PROVIDER_MISSING_KEYS: ReadonlySet<string> = new Set([
  "error.provider.codexMissing",
  "error.provider.claudeMissing",
  "error.provider.grokMissing",
  "error.provider.opencodeMissing",
  "error.provider.antigravityMissing",
  "error.provider.cursorMissing",
  "error.provider.clineMissing",
  "error.provider.kimiMissing",
  "error.provider.hermesMissing",
  "error.provider.nativeMissing",
]);
/** How long messages wait for their turn after the provider did not confirm `turn/start` in time. */
const TURN_START_GRACE_MS = 5 * 60_000;
/**
 * How long messages wait before they try again a session that the provider refused as busy. The wait
 * doubles after each refusal in a row, up to the longest wait.
 */
const PROVIDER_SESSION_BUSY_RETRY_MS = 15_000;
const PROVIDER_SESSION_BUSY_RETRY_MAX_MS = 2 * 60_000;
/** How many times in a row a session that did not open in time tries again before its message fails. */
const SESSION_RESUME_TIMEOUT_RETRIES = 3;

/**
 * The retries of an agent whose provider could not open a session: the busy refusals in a row, whether
 * a retry waits, and, for each lane, the starts in a row that did not open in time (#11607) or that the
 * stopped provider did not get (#11843). The lanes of one agent fail together when the provider stops,
 * so each lane counts its own tries.
 */
interface SessionRetry {
  refusals: number;
  waiting: boolean;
  resumeTimeouts: Map<string, number>;
}

export interface DrainHooks {
  emitError(code: string, error: unknown, agentId?: string): void;
  isStopping(): boolean;
  /** Whether this agent is being deleted. Its queued messages are deleted with it and never start. */
  isDeleting(agentId: string): boolean;
  /**
   * Whether the catalogue still serves this model. A removed endpoint's models stay in the running
   * OpenCode process until it restarts, and the restart waits for a busy agent, so this is what
   * keeps a delivery off an endpoint the user has taken out.
   */
  servesModel(model: string, provider: AgentProvider): boolean;
  /**
   * One piece of provider text with the MCP credentials taken out of it. The queue keeps a failed
   * delivery's reason in the database and shows it again, and `MailboxStore` can only apply the
   * generic redaction: it does not know which values this machine's MCP servers were given.
   */
  redactMcp(text: string): string;
  /** The tabs and threads of this agent, as the tags of a delivered message name them. */
  /** `threadId` is the public thread that gets the prompt. */
  tagReferences(agentId: string, threadId: string | null): TagReferenceSource;
  /**
   * Gives a channel task back to its channel after a spent plan refused it; false when it cannot go
   * back. `continueWork` keeps the assignment for a ready backup instead.
   */
  requeueChannelDelivery(deliveryId: string, continueWork?: boolean): Effect.Effect<boolean>;
  /**
   * Whether a ready backup in the agent's order, or the ready model the agent left, continues work that a
   * usage limit stopped after it started.
   */
  mayContinueOnBackup(agentId: string): boolean;
  /** Whether a provider error moves this agent to a backup model: it switches without asking and has a ready one. */
  mayFailOver(agentId: string): boolean;
  /**
   * Starts the move of this agent to another model for a usage limit, if one is due: back to its own
   * model, or to a backup model during a hold. True when a move started; the move schedules the drain
   * again when it ends. Each path that starts a queue comes here, so no message runs on the wrong model.
   */
  followUsageLimit(agentId: string): boolean;
  /**
   * Starts the provider change that waits for the next turn, if the agent is idle. True when it
   * started; it schedules the drain again when it ends.
   */
  followPendingRuntime(agentId: string): boolean;
  /** Whether this turn already ended. A provider can end a turn before its `turn/start` answer is read. */
  turnEnded(turnId: string): boolean;
  /** Forgets the end of an earlier turn with this id: a requeued delivery starts again under the same turn id. */
  turnRestarting(turnId: string): void;
  /**
   * When the drain took these deliveries from the queue, and how long their provider process took to
   * start (null when it was already running). Before `turn/start`, so the turn's start can read it.
   */
  deliveriesStarting(deliveryIds: readonly string[], start: DeliveryStart): void;
  /**
   * Starts the new chat that the agent asked for, if it did. The agent's own chat has nothing to start,
   * or only the `queuedRuns`: routine runs in their own session, which start in the new chat.
   */
  startRequestedNewChat(agentId: string, queuedRuns?: readonly string[]): Effect.Effect<void>;
  /** Drops that request: a turn in the agent's own chat starts first, so the agent's notes do not cover it. */
  dropRequestedNewChat(agentId: string): void;
}

/** The tasks of the agents, as the drain reads them. */
export interface TaskLanes {
  /** The thread of an open task, or null when the task is closed or gone. */
  threadId(taskId: string): string | null;
  /** The open tasks of this agent. */
  openTaskIds(agentId: string): readonly string[];
  /** How many tasks of this agent may run a turn at the same time. */
  limit(agentId: string): number;
  /** Whether the agent's provider runs one turn at a time, across its own chat and its tasks. */
  oneTurnAtATime(agentId: string): boolean;
  /** Whether this task is the side thread of a routine, whose runs each get their own session. */
  isRoutineThread(taskId: string): boolean;
}

/**
 * One queue that runs one turn at a time: the agent's own chat (`taskId` null), its external
 * conversations, one of its tasks, or the thread of one channel. `taskId` is the lane id of the
 * mailbox: a task id, `MESSAGING_LANE`, or `channelLane(channelId)` for a channel.
 */
interface Lane {
  readonly agentId: string;
  readonly taskId: string | null;
}

/** The task of a task lane, or null for the agent's own chat, its external conversations or a channel lane. */
function laneTaskId(lane: Lane): string | null {
  return lane.taskId !== null && lane.taskId !== MESSAGING_LANE && laneChannelId(lane.taskId) === null
    ? lane.taskId
    : null;
}

/** The key of a lane. The agent's own chat keeps the agent id, so its maps read as before tasks. */
function laneKey(lane: Lane): string {
  return lane.taskId === null ? lane.agentId : `${lane.agentId}\u0000${lane.taskId}`;
}

function laneOf(key: string): Lane {
  const separator = key.indexOf("\u0000");
  return separator < 0
    ? { agentId: key, taskId: null }
    : { agentId: key.slice(0, separator), taskId: key.slice(separator + 1) };
}

const mainLane = (agentId: string): Lane => ({ agentId, taskId: null });
const messagingLane = (agentId: string): Lane => ({ agentId, taskId: MESSAGING_LANE });

export interface DrainSchedulerOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  duplication: DuplicationGate;
  profileSave: ProfileSave;
  compaction: ContextCompaction;
  routines: RoutineScheduler;
  threads: ThreadLifecycle;
  memory: MemoryHold;
  usageLimits: UsageLimitGate;
  planContinuation: PlanContinuation;
  tasks: TaskLanes;
  hooks: DrainHooks;
  channels?: ChannelService;
  messaging?: MessagingThreads;
}

/**
 * The queue drain: takes the next queued delivery per lane and starts a
 * provider turn for it. Each agent has one lane for its own chat and one for
 * each task, so a task turn runs while the agent's chat or another task runs.
 * The lanes of one agent share every hold of the agent; a task lane also waits
 * for the task limit, and for the agent's own process when it must restart.
 *
 * Every controller that can hold an agent back owns one `#mayDrain` clause
 * (profile creation, duplication, compaction, routines); this class only composes them, and
 * `#drainLane` repeats the guard because a drain scheduled a microtask ago
 * may have been muted since. Owns the draining/scheduled/task maps. Takes
 * `ThreadLifecycle` directly — thread recovery is a dependency, not a hook.
 */
export class DrainScheduler {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #mailboxSync: MailboxSync;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #duplication: DuplicationGate;
  readonly #profileSave: ProfileSave;
  readonly #compaction: ContextCompaction;
  readonly #routines: RoutineScheduler;
  readonly #threads: ThreadLifecycle;
  readonly #memory: MemoryHold;
  readonly #usageLimits: UsageLimitGate;
  readonly #planContinuation: PlanContinuation;
  readonly #tasks: TaskLanes;
  readonly #slots: TurnSlots;
  /** Lanes that a full set of turn slots held back. A drain that may free a slot tries them again. */
  readonly #slotWaiters = new Set<string>();
  #wakingSlotWaiters = false;
  readonly #hooks: DrainHooks;
  readonly #channels: ChannelService | undefined;
  readonly #messaging: MessagingThreads | undefined;
  readonly #drainingLanes = new Set<string>();
  /**
   * Agents whose channel task a spent plan refused and gave back to its channel. Their queue can be
   * empty, so the end of the drain schedules them once: the schedule moves to a backup model.
   */
  readonly #requeuedAtLimit = new Set<string>();
  readonly #settingsHolds = new Map<string, number>();
  /**
   * Lanes whose last start found the provider in a turn of its own, by lane key. OpenBot's snapshot
   * can show no turn then, so without this the drain asked again at once, with no end. The next
   * `scheduleDrain` of the agent, which the end of any of its turns calls, lets the lane try again.
   */
  readonly #providerTurnHolds = new Set<string>();
  /**
   * Agents whose provider refused to open a session because a stopped prompt still runs in it, with
   * the refusals in a row and whether a retry waits. No event tells when that prompt ends (#9938).
   * A session that did not open in time waits here too (#11607).
   */
  readonly #busyRetries = new Map<string, SessionRetry>();
  /**
   * The `scheduleDrain` calls of each agent. A start that a call overtook is not held: the call can
   * be the end of the provider's turn, and no later one would come.
   */
  readonly #drainCalls = new Map<string, number>();
  /** The last hold `#reportHold` logged per lane, so a waiting queue logs once per reason. */
  readonly #reportedHolds = new Map<string, string>();
  /**
   * The model each lane's running turn was started with, by lane key. The agent record can be moved
   * to another model while that turn runs, but the CLI keeps the session it opened, so this is the
   * endpoint a message steered into the turn would reach.
   */
  readonly #turnModels = new Map<string, { turnId: string; model: string }>();
  /**
   * How many deliveries are on their way to a turn, per provider.
   *
   * A delivery is claimed before its first await and released when it has an active turn or has
   * failed. Between the two it holds no turn id, and only this count stops a CLI update from
   * replacing the client it is about to prompt.
   */
  readonly #startingDeliveries = new Map<AgentProvider, number>();
  readonly #scheduledDrains = new Set<string>();
  readonly #drainTasks = new Map<string, Deferred.Deferred<void, DeliveryStartFailed>>();
  /** The routine runs whose provider did not start, and that wait to start again (#6751). */
  readonly #startRetry = new RoutineStartRetry({
    retry: (deliveryId, agentId, provider) => Effect.runFork(this.#retryRoutineStart(deliveryId, agentId, provider)),
  });

  constructor(options: DrainSchedulerOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#duplication = options.duplication;
    this.#profileSave = options.profileSave;
    this.#compaction = options.compaction;
    this.#routines = options.routines;
    this.#threads = options.threads;
    this.#memory = options.memory;
    this.#usageLimits = options.usageLimits;
    this.#planContinuation = options.planContinuation;
    this.#tasks = options.tasks;
    this.#hooks = options.hooks;
    this.#channels = options.channels;
    this.#messaging = options.messaging;
    this.#slots = new TurnSlots({
      limit: () => this.#memory.turnLimit(),
      lanes: () =>
        this.#store
          .list()
          .flatMap((agent) => this.#lanesOf(agent.id))
          .map(laneKey),
      isRunning: (key) => {
        const lane = laneOf(key);
        // A compaction is a provider turn of the lane whose thread it compacts, so it uses that slot.
        return this.#laneRunning(lane) || this.#compactionHolds(lane);
      },
      isWaiting: (key) => {
        const lane = laneOf(key);
        return (
          this.#mayStartNow(lane) &&
          this.#memory.mayDrain(lane.agentId) &&
          this.#mailbox.nextQueued(lane.agentId, lane.taskId) !== null
        );
      },
      head: (key) => {
        const lane = laneOf(key);
        return this.#mailbox.nextQueued(lane.agentId, lane.taskId)?.delivery ?? null;
      },
    });
  }

  /** The clauses of this agent's own state. `#heldByMachine` adds the memory and the turn slots. */
  mayDrain(agentId: string): boolean {
    return this.#heldBy(mainLane(agentId)) === null;
  }

  /**
   * The agent's own chat, its external conversations, its open tasks, and the channels that have work
   * for it or run its turn.
   */
  #lanesOf(agentId: string): Lane[] {
    const channels = new Set(this.#mailbox.channelLanes(agentId));
    for (const snapshot of this.#conversation.workingChannelSnapshots(agentId)) {
      const channelId = this.#conversation.channelForThread(snapshot.threadId);
      if (channelId) channels.add(channelLane(channelId));
    }
    return [
      mainLane(agentId),
      messagingLane(agentId),
      ...this.#tasks.openTaskIds(agentId).map((taskId) => ({ agentId, taskId })),
      ...[...channels].map((taskId) => ({ agentId, taskId })),
    ];
  }

  /**
   * Whether this lane runs a turn or starts one. A start whose `turn/start` timed out stays "starting"
   * with no turn ID, and its turn can still run.
   */
  #laneRunning(lane: Lane): boolean {
    return (
      this.#drainingLanes.has(laneKey(lane)) ||
      this.#laneTurnActive(lane) ||
      this.#mailbox.laneActive(lane.agentId, lane.taskId)
    );
  }

  #laneTurnActive(lane: Lane): boolean {
    if (lane.taskId === null || lane.taskId === MESSAGING_LANE)
      return this.#ownThreadTurnActive(lane.agentId, lane.taskId === MESSAGING_LANE);
    const channelId = laneChannelId(lane.taskId);
    if (channelId !== null)
      return this.#conversation
        .workingChannelSnapshots(lane.agentId)
        .some((snapshot) => this.#conversation.channelForThread(snapshot.threadId) === channelId);
    const threadId = this.#tasks.threadId(lane.taskId);
    return this.#conversation
      .workingTaskSnapshots(lane.agentId)
      .some((snapshot) => snapshot.threadId === threadId && snapshot.activeTurnId);
  }

  /**
   * Whether a turn runs in the agent's own chat (`messaging` false) or in the thread of one of its
   * external conversations. The agent's own chat is no execution thread, so it needs no link query.
   */
  #ownThreadTurnActive(agentId: string, messaging: boolean): boolean {
    return [...this.#conversation.activeSnapshots()].some(
      ([id, snapshot]) =>
        id === agentId &&
        Boolean(snapshot.activeTurnId) &&
        !this.#conversation.isSideThread(snapshot.threadId) &&
        messaging ===
          (snapshot.threadId !== null &&
            this.#conversation.isExecutionThread(snapshot.threadId) &&
            this.#messaging?.inMessagingLane(agentId, snapshot.threadId) === true),
    );
  }

  /**
   * Whether a compaction holds this lane. A task, a channel or the external conversations wait for a
   * compaction of their own threads only, and the agent's own chat for one of its chat, so threads
   * that run in parallel do not wait for each other.
   */
  #compactionHolds(lane: Lane): boolean {
    const taskId = laneTaskId(lane);
    const channelId = laneChannelId(lane.taskId);
    const taskThreadId = taskId === null ? null : this.#tasks.threadId(taskId);
    return this.#compaction.heldThreads(lane.agentId).some((externalThreadId) => {
      const publicThreadId = this.#conversation.publicThreadId(lane.agentId, externalThreadId);
      const threadChannelId = this.#conversation.channelForThread(publicThreadId);
      if (threadChannelId !== null) return threadChannelId === channelId;
      if (this.#messaging?.inMessagingLane(lane.agentId, publicThreadId)) return lane.taskId === MESSAGING_LANE;
      if (!this.#conversation.isTaskThread(publicThreadId)) return lane.taskId === null;
      return taskThreadId !== null && publicThreadId === taskThreadId;
    });
  }

  /** The first clause of `mayDrain` that holds this lane, or null when none does. */
  #heldBy(lane: Lane): string | null {
    const { agentId, taskId } = lane;
    if (this.#hooks.isDeleting(agentId)) return "deleting";
    if (this.#settingsHolds.has(agentId)) return "session-settings";
    if (this.#laneTurnActive(lane)) return "active-turn";
    if (this.#providerTurnHolds.has(laneKey(lane))) return "provider-turn";
    // The provider has one turn of the agent at a time, so each lane waits for the turn of any other.
    if (
      this.#tasks.oneTurnAtATime(agentId) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "one-turn";
    const channelId = laneChannelId(taskId);
    // One channel turn of the agent at a time, across its channels.
    if (
      channelId !== null &&
      this.#lanesOf(agentId).some(
        (other) => other.taskId !== taskId && laneChannelId(other.taskId) !== null && this.#laneRunning(other),
      )
    )
      return "channel-turn";
    const ownTaskId = laneTaskId(lane);
    if (ownTaskId !== null) {
      if (this.#tasks.threadId(ownTaskId) === null) return "task-closed";
      const running = this.#tasks
        .openTaskIds(agentId)
        .filter((other) => other !== ownTaskId && this.#laneRunning({ agentId, taskId: other })).length;
      if (running >= this.#tasks.limit(agentId)) return "task-limit";
    }
    // The agent's own process restarts when its access or account changed. A turn of another lane
    // runs on it, so this lane waits for that turn to end.
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (
      agent &&
      !this.#providers.agentClientCurrent(agent) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "agent-client-changing";
    // A routine run whose provider did not start waits for its next start, and the routine runs
    // behind it wait with it. A message that comes in the meantime, or a move of the agent to another
    // provider, ends the wait: the lane starts again, as it did before the run waited.
    if (agent && this.#startRetry.agentWaits(agentId)) {
      const head = this.#mailbox.nextQueued(agentId, taskId)?.delivery;
      if (
        head &&
        this.#startRetry.waiting(head.id, providerForAgent(agent)) &&
        this.#onlyRoutineRunsQueued(agentId, taskId)
      )
        return "provider-start";
    }
    // No turn starts on a provider that waits for a sign-in, so its messages wait for the sign-in
    // rather than fail (#4326). The provider runtime schedules the drain again when it is signed in.
    if (
      agent &&
      this.#providers.signInRequired(providerForAgent(agent)) &&
      this.#waitsForSignIn(this.#mailbox.nextQueued(agentId, taskId)?.delivery)
    )
      return "sign-in";
    // A channel turn runs in its own lane, beside the agent's own chat. A provider that runs one turn
    // at a time also holds the own chat for a channel assignment that has not started yet.
    if (taskId === null && this.#tasks.oneTurnAtATime(agentId) && !(this.#channels?.mayDrain(agentId) ?? true))
      return "channel";
    if (!this.#profileSave.mayDrain(agentId)) return "profile-save";
    if (!this.#duplication.mayDrain(agentId)) return "duplication";
    if (this.#compactionHolds(lane)) return "compaction";
    if (!this.#routines.mayDrain(agentId)) return "routine";
    if (!this.#usageLimits.mayDrain(agentId) && !this.#usageLimits.mayTry(agentId)) return "usage-limit";
    return null;
  }

  /**
   * Logs once why a queued message of this lane waits, and again only when the reason changes. A
   * queue that never starts again then names the clause that holds it.
   */
  #reportHold(lane: Lane, reason: string): void {
    const key = laneKey(lane);
    if (this.#reportedHolds.get(key) === reason || !this.#mailbox.nextQueued(lane.agentId, lane.taskId)) return;
    this.#reportedHolds.set(key, reason);
    const working =
      reason === "active-turn" && lane.taskId === null ? this.#conversation.workingSnapshot(lane.agentId) : undefined;
    const channelId = laneChannelId(lane.taskId);
    logger.info("A queued message waits.", {
      agentId: lane.agentId,
      ...(lane.taskId === null
        ? {}
        : lane.taskId === MESSAGING_LANE
          ? { lane: "messaging" }
          : channelId !== null
            ? { channelId }
            : { taskId: lane.taskId }),
      reason,
      ...(working ? { threadId: working.threadId, turnId: working.activeTurnId } : {}),
    });
  }

  /** Whether a turn runs in an external conversation of the messaging lane, also one with no delivery. */
  messagingTurnActive(agentId: string): boolean {
    return this.#ownThreadTurnActive(agentId, true);
  }

  /** Why a new message in the agent's own chat waits now, or null when it can start at once. */
  ownChatHold(agentId: string): string | null {
    return this.#heldBy({ agentId, taskId: null });
  }

  /** Why the next message of this task waits, or null when it can start or nothing waits. */
  taskHold(agentId: string, taskId: string): string | null {
    const lane = { agentId, taskId };
    if (!this.#mailbox.nextQueued(agentId, taskId)) return null;
    // In the order of the drain. `#heldByMachine` is not called here: it records the lane as waiting.
    const heldByMachine = !this.#memory.mayDrain(agentId) || this.#slotWaiters.has(laneKey(lane));
    return this.#heldBy(lane) ?? this.#providerHold(agentId) ?? (heldByMachine ? "machine" : null);
  }

  /**
   * The provider checks of the drain: the providers have started, and no CLI of the agent's
   * deliveries is replaced. The drain and `taskHold` both read this, so a thread names the hold
   * that keeps it from starting (#8915).
   */
  #providerHold(agentId: string): "providers-not-ready" | "provider-cli-replaced" | null {
    if (!this.#providers.isReady()) return "providers-not-ready";
    if (this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider)))
      return "provider-cli-replaced";
    return null;
  }

  /** `followUsageLimit` is false after a move that failed, so that the drain does not try it again. */
  scheduleDrain(agentId: string, followUsageLimit = true): void {
    this.#drainCalls.set(agentId, (this.#drainCalls.get(agentId) ?? 0) + 1);
    for (const key of [...this.#providerTurnHolds])
      if (laneOf(key).agentId === agentId) this.#providerTurnHolds.delete(key);
    this.#scheduleDrain(agentId, followUsageLimit);
    this.retrySlotWaiters();
  }

  /**
   * Schedules each agent with one read of each lane. Each `scheduleDrain` alone reads all lanes of all
   * agents again, also for the slot retry that it starts (#11710).
   */
  scheduleDrains(agentIds: Iterable<string>): void {
    this.#slots.round(() => {
      for (const agentId of agentIds) this.scheduleDrain(agentId);
    });
  }

  /**
   * Drains the agent again after a wait, once for all its lanes that the busy session refused or
   * whose session did not open in time. A turn that starts, `forgetAgent` and `dispose` end the retry.
   */
  #retryBusySession(agentId: string): Effect.Effect<void> {
    const entry = this.#busyRetryEntry(agentId);
    if (entry.waiting) return Effect.void;
    entry.waiting = true;
    entry.refusals += 1;
    const delay = Math.min(
      PROVIDER_SESSION_BUSY_RETRY_MS * 2 ** (entry.refusals - 1),
      PROVIDER_SESSION_BUSY_RETRY_MAX_MS,
    );
    const retry = Effect.sync(() => {
      if (this.#busyRetries.get(agentId) !== entry) return;
      entry.waiting = false;
      this.scheduleDrain(agentId);
    });
    return Effect.asVoid(Effect.forkDetach(retry.pipe(Effect.delay(delay))));
  }

  /**
   * Counts one start of this lane that did not open in time, or that the stopped provider did not get.
   * False after the last try: that message fails, and the next message gets all its tries and, when no
   * other lane waits, the shortest wait again, as after a turn that starts.
   */
  #mayRetryResume(agentId: string, lane: string): boolean {
    const entry = this.#busyRetryEntry(agentId);
    const tries = entry.resumeTimeouts.get(lane) ?? 0;
    if (tries >= SESSION_RESUME_TIMEOUT_RETRIES) {
      entry.resumeTimeouts.delete(lane);
      if (entry.resumeTimeouts.size === 0 && !entry.waiting) this.#busyRetries.delete(agentId);
      return false;
    }
    entry.resumeTimeouts.set(lane, tries + 1);
    return true;
  }

  #busyRetryEntry(agentId: string): SessionRetry {
    const entry = this.#busyRetries.get(agentId) ?? { refusals: 0, waiting: false, resumeTimeouts: new Map() };
    this.#busyRetries.set(agentId, entry);
    return entry;
  }

  /**
   * Tries the agents that wait for a turn slot again. Each drain that ends can free a slot, and the
   * memory sample calls this too, for a turn that ended on a path that schedules no drain.
   */
  retrySlotWaiters(): void {
    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;
    this.#wakingSlotWaiters = true;
    try {
      const waiters = [...this.#slotWaiters];
      this.#slotWaiters.clear();
      // Each lane schedules its drain in a microtask, so no lane starts during this loop.
      this.#slots.round(() => {
        for (const key of waiters) this.#scheduleLane(laneOf(key));
      });
    } finally {
      this.#wakingSlotWaiters = false;
    }
  }

  /**
   * Schedules the agent's own chat, then each task, channel and the external conversations with a
   * message that can start.
   */
  #scheduleDrain(agentId: string, followUsageLimit = true): void {
    if (this.#scheduleLane(mainLane(agentId), followUsageLimit)) return;
    this.#scheduleSideLanes(agentId);
  }

  /**
   * Schedules each task and channel lane whose next message can start. A lane with a start that is
   * still "starting" has none, so its drain would find nothing and schedule the lane again with no end.
   */
  #scheduleSideLanes(agentId: string): void {
    for (const taskId of [...this.#mailbox.queuedTaskIds(agentId), ...this.#mailbox.sideLanes(agentId, true)])
      if (this.#mailbox.nextQueued(agentId, taskId)) this.#scheduleLane({ agentId, taskId }, false);
  }

  /** True when a move for a usage limit started: the move schedules the agent again when it ends. */
  #scheduleLane(lane: Lane, followUsageLimit = true): boolean {
    const key = laneKey(lane);
    if (this.#hooks.isStopping() || this.#scheduledDrains.has(key)) return false;
    const hold =
      (!this.#providers.isReady() && "providers-not-ready") ||
      (this.#drainingLanes.has(key) && "drain-running") ||
      this.#heldBy(lane) ||
      (this.#heldByMachine(lane) && "machine");
    if (hold) this.#reportHold(lane, hold);
    // The sign-in hold reads the provider the agent has now. A provider change that waits for the
    // next turn applies first, and the drain that follows reads the new provider (#6862).
    if (followUsageLimit && hold === "sign-in" && this.#hooks.followPendingRuntime(lane.agentId)) return true;
    if (followUsageLimit && (!hold || hold === "usage-limit") && this.#hooks.followUsageLimit(lane.agentId))
      return true;
    if (hold) return false;
    this.#scheduledDrains.add(key);
    const completion = Deferred.makeUnsafe<void, DeliveryStartFailed>();
    // Publish the scheduled work before its microtask, so deletion must wait for the attempt.
    this.#drainTasks.set(key, completion);
    queueMicrotask(() => {
      Effect.runFork(
        Effect.gen({ self: this }, function* () {
          this.#scheduledDrains.delete(key);
          const exit = yield* Effect.exit(this.#hooks.isStopping() ? Effect.void : this.#drainLane(lane));
          yield* Deferred.done(completion, exit);
          if (this.#drainTasks.get(key) === completion) this.#drainTasks.delete(key);
        }),
      );
    });
    return false;
  }

  holdSessionSettings(agentId: string): () => void {
    return this.#hold(this.#settingsHolds, agentId);
  }

  /** True while a read or a change of this agent's session settings runs. */
  holdsSessionSettings(agentId: string): boolean {
    return this.#settingsHolds.has(agentId);
  }

  #hold(holds: Map<string, number>, agentId: string): () => void {
    holds.set(agentId, (holds.get(agentId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (holds.get(agentId) ?? 1) - 1;
      if (remaining > 0) holds.set(agentId, remaining);
      else holds.delete(agentId);
      this.scheduleDrain(agentId);
    };
  }

  pendingTasks(): Effect.Effect<void, DeliveryStartFailed>[] {
    return [...this.#drainTasks.values()].map(Deferred.await);
  }

  /** The drains of every lane of this agent that are scheduled or run, or undefined when none is. */
  taskFor(agentId: string): Effect.Effect<void, DeliveryStartFailed> | undefined {
    const completions = [...this.#drainTasks].flatMap(([key, completion]) =>
      laneOf(key).agentId === agentId ? [Deferred.await(completion)] : [],
    );
    return completions.length > 0 ? Effect.all(completions, { discard: true }) : undefined;
  }

  forgetAgent(agentId: string): void {
    const ofAgent = (key: string) => laneOf(key).agentId === agentId;
    for (const keys of [this.#drainingLanes, this.#scheduledDrains, this.#slotWaiters, this.#providerTurnHolds])
      for (const key of [...keys]) if (ofAgent(key)) keys.delete(key);
    for (const key of [...this.#reportedHolds.keys()]) if (ofAgent(key)) this.#reportedHolds.delete(key);
    for (const key of [...this.#turnModels.keys()]) if (ofAgent(key)) this.#turnModels.delete(key);
    this.#requeuedAtLimit.delete(agentId);
    this.#drainCalls.delete(agentId);
    this.#startRetry.forgetAgent(agentId);
    this.#busyRetries.delete(agentId);
    this.retrySlotWaiters();
  }

  dispose(): void {
    this.#startRetry.dispose();
    this.#busyRetries.clear();
    this.#drainingLanes.clear();
    this.#scheduledDrains.clear();
    this.#slotWaiters.clear();
    this.#reportedHolds.clear();
    this.#requeuedAtLimit.clear();
  }

  /**
   * Whether the memory or the turn slots of the machine hold this lane back. A held agent is told
   * about the memory, and a lane held by the slots waits for the next free slot.
   */
  #heldByMachine(lane: Lane): boolean {
    if (!this.#memory.mayDrain(lane.agentId)) {
      if (this.#mailbox.nextQueued(lane.agentId, lane.taskId)) this.#memory.held(lane.agentId);
      return true;
    }
    const key = laneKey(lane);
    if (this.#slots.mayStart(key)) return false;
    this.#slotWaiters.add(key);
    return true;
  }

  /** The checks of `drainAgent` other than the clauses: the service runs and the provider can start. */
  #mayStartNow(lane: Lane): boolean {
    return (
      !this.#hooks.isStopping() &&
      !this.#drainingLanes.has(laneKey(lane)) &&
      this.#providerHold(lane.agentId) === null &&
      this.#heldBy(lane) === null
    );
  }

  /** Drains the agent's own chat. */
  drainAgent(agentId: string) {
    return this.#drainLane(mainLane(agentId));
  }

  readonly #drainLane = Effect.fn("DrainScheduler.drainLane")(function* (this: DrainScheduler, lane: Lane) {
    if (this.#hooks.isStopping()) return;
    const { agentId, taskId } = lane;
    const key = laneKey(lane);
    const hold =
      (this.#drainingLanes.has(key) && "drain-running") ||
      this.#heldBy(lane) ||
      // Before the try, so the delivery is not rescheduled in a loop while the CLI is replaced.
      // ProviderRuntime schedules this agent again once the new client is ready.
      this.#providerHold(agentId) ||
      // Last, because it records the lane as waiting. Another drain can take the last slot
      // between the schedule and this start.
      (this.#heldByMachine(lane) && "machine");
    if (hold) {
      this.#reportHold(lane, hold);
      return;
    }
    this.#reportedHolds.delete(key);
    this.#drainingLanes.add(key);
    yield* Effect.gen({ self: this }, function* () {
      if (this.#laneTurnActive(lane)) return;
      const context = this.#mailbox.nextQueued(agentId, taskId);
      if (!context) {
        // Here, so that a message that arrives during the new chat waits for this drain to end.
        if (taskId === null) yield* this.#hooks.startRequestedNewChat(agentId);
        return;
      }
      // An automatic plan continuation runs only when nothing else waits in the lane and its chain
      // is still in memory. Otherwise its deliveries end as their last turn did, and the drain runs again.
      const planNote = context.planContinuation?.queued
        ? this.#planContinuation.claim(
            agentId,
            taskId,
            context.delivery.id,
            this.#mailbox.laneQueuedIds(agentId, taskId).length > 0,
          )
        : null;
      if (context.planContinuation?.queued && planNote === null) {
        yield* this.endPlanContinuation(agentId, taskId);
        return;
      }
      // A task compacts at the end of its own turns (`TurnLifecycle`), and that compaction holds its
      // own lane only. Here the agent's own chat compacts its chat or the thread of the messaging
      // work it serves, and a channel lane compacts the channel's thread.
      if (laneTaskId(lane) === null) {
        const agent = this.#store.list().find((candidate) => candidate.id === agentId);
        const assignment = this.#channels?.store.assignmentForDelivery(context.delivery.id);
        const publicThreadId = assignment
          ? this.#channels?.store.context(assignment.channelId, assignment.agentId).threadId
          : (this.#messaging?.threadForDelivery(context.delivery.id) ?? agent?.threadId);
        // Before the compaction: it holds the lane whose thread it compacts.
        if (assignment && publicThreadId)
          this.#conversation.registerChannelThread(agentId, publicThreadId, assignment.channelId);
        // A routine run in its own session leaves the chat session as it is.
        const ownSession = this.#runsInOwnSession(context);
        if (agent && publicThreadId === agent.threadId) {
          // When only such runs wait, the new chat that the agent asked for starts before them, so they do
          // not cancel it (#7129). Their queued messages keep them above the new chat's marker: like each
          // message above it, the agent does not see their answers. Another message ends the request.
          const queued = this.#mailbox.laneQueuedIds(agentId, null);
          if (
            ownSession &&
            queued.every((id) => {
              const queuedContext = this.#mailbox.getDelivery(id);
              return queuedContext !== null && this.#runsInOwnSession(queuedContext);
            })
          )
            yield* this.#hooks.startRequestedNewChat(agentId, queued);
          this.#hooks.dropRequestedNewChat(agentId);
        }
        const session =
          agent && publicThreadId && !ownSession
            ? this.#store.database.activeProviderSession(publicThreadId, agent.provider)
            : null;
        if (session) this.#compaction.expectInput(session.externalSessionId, context.delivery.text.length);
        if (session && this.#compaction.reserve(agentId, session.externalSessionId)) {
          yield* this.#compaction.request(agentId, session.externalSessionId);
          return;
        }
      }
      // One message from the user lets one turn try a limit, so the other lanes stay held.
      this.#usageLimits.tryStarted(agentId);
      yield* this.startDelivery(context, planNote ?? undefined);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#drainingLanes.delete(key);
          if (this.#requeuedAtLimit.delete(agentId) || this.#mailbox.nextQueued(agentId))
            this.#scheduleLane(mainLane(agentId));
          // Every task and channel too: this lane can have held another one for the task limit or
          // the process.
          this.#scheduleSideLanes(agentId);
          this.retrySlotWaiters();
        }),
      ),
    );
  }, Effect.uninterruptible);

  /**
   * Ends the automatic plan continuation of one lane, the agent's own chat when `taskId` is null:
   * after a Stop, a new chat, a new message, or a restart. The waiting deliveries end as
   * completed, as their last turn did.
   */
  readonly endPlanContinuation = Effect.fn("DrainScheduler.endPlanContinuation")(
    function* (this: DrainScheduler, agentId: string, taskId: string | null) {
      this.#planContinuation.cancel(agentId, taskId);
      const settled = yield* this.#mailbox.settlePlanContinuations(agentId, taskId);
      if (settled.length === 0) return;
      for (const deliveryId of settled) {
        const deliveryTaskId = this.#mailbox.taskIdForDelivery(deliveryId);
        const taskThreadId = deliveryTaskId === null ? null : this.#tasks.threadId(deliveryTaskId);
        const snapshot =
          deliveryTaskId === null
            ? this.#conversation.loadedSnapshot(agentId)
            : taskThreadId
              ? this.#conversation.loadedExecutionSnapshot(taskThreadId)
              : undefined;
        if (!snapshot) continue;
        this.#mailboxSync.syncDeliveryMessage(snapshot, deliveryId);
        this.#conversation.emitConversation(snapshot);
      }
      this.#mailboxSync.emitQueue(agentId);
    },
    (settle, agentId) =>
      settle.pipe(
        Effect.catch((failure) =>
          Effect.sync(() => this.#hooks.emitError("delivery_reconciliation_pending", failure, agentId)),
        ),
      ),
  );

  readonly startDelivery = Effect.fn("DrainScheduler.startDelivery")(function* (
    this: DrainScheduler,
    context: DeliveryContext,
    planNote?: string,
  ) {
    const { delivery } = context;
    const channelDelivery = this.#channels ? this.#channels.store.assignmentForDelivery(delivery.id) !== null : false;
    const messagingDelivery = this.#messaging?.ownsDelivery(delivery.id) ?? false;
    const taskId = this.#mailbox.taskIdForDelivery(delivery.id);
    const laneId = this.#mailbox.laneIdForDelivery(delivery.id);
    const drainCallsAtStart = this.#drainCalls.get(delivery.recipientAgentId) ?? 0;
    const ownSession = this.#runsInOwnSession(context);
    // The teammate answers that start in this turn too: only a teammate's answer takes the other
    // answers to the same request, also in an external conversation. A channel task, an external
    // message and a routine run in its own session always run alone. The person's message takes no
    // answers, so the tools that only a person's request can start work in its turn (#6525), and the
    // person's later queued messages follow it in queue order.
    // A plan continuation runs again the deliveries of the turn it continues, and no others.
    const replies =
      planNote !== undefined || channelDelivery || ownSession || delivery.sender.kind !== "agent"
        ? []
        : this.#mailbox.repliesToStartWith(delivery.id);
    const laterMessages =
      planNote !== undefined
        ? this.#mailbox.planContinuationsToStartWith(delivery.id)
        : channelDelivery || ownSession || messagingDelivery
          ? []
          : this.#mailbox.userMessagesToStartWith(delivery.id);
    const companions = [...replies, ...laterMessages];
    let batch =
      planNote !== undefined || delivery.sender.kind === "user" ? [context, ...laterMessages] : [context, ...replies];
    let confirmedTurnId: string | null = null;
    // The session of a routine run in its own session. Closed here when no turn starts on it.
    let routineThreadId: string | null = null;
    const claimed = this.#deliveryProviders(delivery.recipientAgentId);
    for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) + 1);
    // Held from the refresh below until this start ends, because everything between them awaits the
    // provider: the session is resumed or started, and then the turn is sent on it. A refresh that
    // lands in that wait closes the session and drops the routing to it, and the turn that arrives
    // afterwards runs where no completion can be delivered, holding the queue of this agent.
    let releaseRuntimeRefresh: () => void = () => {};
    // Synchronously, before the first await, so the next drain already counts this turn's memory.
    // Released in the `finally` when no turn starts: a start that fails uses no provider memory.
    const releaseReservation = this.#memory.reserveTurn();
    let turnMayRun = false;
    // The provider process, or its account check, did not start. Nothing reached the model.
    let providerStartFailed = false;
    // The model this start asks for. The agent can move to another one while `turn/start` waits, and
    // a plan limit belongs to the model the provider refused.
    let requestedModel: string | null = null;
    const pickedAt = Date.now();
    yield* Effect.gen({ self: this }, function* () {
      for (const item of batch) yield* this.#mailbox.markStarting(item.delivery.id).pipe(toDeliveryStartFailed);
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      yield* this.#mailbox.verifyDeliveryAttachments(delivery.id).pipe(toDeliveryStartFailed);
      // An answer whose attachment changed fails alone. The message that starts the turn still runs.
      const failedCompanions = new Set<string>();
      for (const { delivery: companion } of companions) {
        const verified = yield* Effect.result(
          this.#mailbox.verifyDeliveryAttachments(companion.id).pipe(toDeliveryStartFailed),
        );
        if (Result.isFailure(verified)) {
          const error = verified.failure.cause;
          const reason = this.#hooks.redactMcp(error instanceof Error ? error.message : String(error));
          yield* this.#mailbox.markTerminal(companion.id, "failed", reason).pipe(toDeliveryStartFailed);
          failedCompanions.add(companion.id);
        }
      }
      if (failedCompanions.size > 0) {
        batch = batch.filter((item) => !failedCompanions.has(item.delivery.id));
        this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      }
      const agent = yield* this.#store.getOrCreate(delivery.recipientAgentId).pipe(toDeliveryStartFailed);
      // Once for the turn: its process, its session and its sandbox roots read the result.
      yield* checkAgentFolders(agent);
      requestedModel = agent.model;
      // The endpoint was removed while this agent was busy, so no other model could be given to it
      // then. The old process would still answer on the removed endpoint, with the credentials it
      // started with, until it restarts. Thrown rather than failed here: the catch below also ends
      // the channel assignment, and an assignment left active holds back every other agent.
      const requireServedModel = () => {
        if (!this.#hooks.servesModel(agent.model, providerForAgent(agent))) throw new Error(REMOVED_ENDPOINT_MESSAGE);
      };
      yield* drainStep(requireServedModel);
      yield* this.#threads.applyPendingRuntimeRefresh(agent, new Set(batch.map((item) => item.delivery.id)));
      // External conversation work holds a refresh of the own chat as it did in the own chat's lane.
      releaseRuntimeRefresh = this.#threads.holdRuntimeRefresh(agent.id, laneId !== null && laneId !== MESSAGING_LANE);
      const providerRunning = this.#providers.agentClientRunning(agent);
      const providerStartedAt = Date.now();
      const client = yield* this.#providers.ensureAgentClient(agent).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            providerStartFailed = true;
          }),
        ),
        toDeliveryStartFailed,
      );
      this.#hooks.deliveriesStarting(
        batch.map((item) => item.delivery.id),
        { pickedAt, providerStartMs: providerRunning ? null : Date.now() - providerStartedAt },
      );
      const messaging = this.#messaging;
      const channels = this.#channels;
      const taskThreadId = taskId === null ? null : this.#tasks.threadId(taskId);
      const execution: { threadId: string; text?: string } | null | undefined =
        taskId !== null
          ? taskThreadId
            ? { threadId: taskThreadId }
            : null
          : messagingDelivery
            ? messaging
              ? yield* messaging.prepare(context).pipe(toDeliveryStartFailed)
              : undefined
            : channels
              ? yield* channels.prepare(context).pipe(toDeliveryStartFailed)
              : null;
      if ((channelDelivery || messagingDelivery || taskId !== null) && !execution) {
        // Every delivery of the batch, so no later message stays `starting` in a removed lane.
        for (const item of batch) {
          const current = this.#mailbox.getDelivery(item.delivery.id)?.delivery;
          if (current?.status === "starting")
            yield* this.#mailbox
              .markTerminal(
                item.delivery.id,
                "interrupted",
                taskId !== null
                  ? sourceText("error.backend.threadArchived")
                  : channelDelivery
                    ? "The channel was deleted before starting."
                    : "The messaging thread was removed before starting.",
              )
              .pipe(toDeliveryStartFailed);
        }
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }
      if (taskThreadId) this.#conversation.registerTaskThread(agent.id, taskThreadId);
      const channelId = laneChannelId(laneId);
      if (channelDelivery && channelId !== null && execution)
        this.#conversation.registerChannelThread(agent.id, execution.threadId, channelId);
      if (ownSession) {
        // The routine's side thread, or the agent's own chat.
        const publicThreadId =
          execution?.threadId ?? (yield* this.#store.ensureThreadId(agent.id).pipe(toDeliveryStartFailed));
        // Checked again below. Here, so a busy thread does not start a session for nothing.
        if (this.#conversation.ensureSnapshot(agent.id, publicThreadId).activeTurnId) {
          for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
          this.#mailboxSync.emitQueue(agent.id);
          return;
        }
        routineThreadId = yield* this.#threads
          .startRoutineThread(agent, client, execution?.threadId)
          .pipe(toDeliveryStartFailed);
      }
      let threadId =
        routineThreadId ??
        (yield* this.#threads.ensureThread(agent, client, execution?.threadId).pipe(toDeliveryStartFailed));
      // After the session opens, not after the provider starts: a run whose session does not open
      // keeps its count, so its waits end (#12480).
      this.#startRetry.forget(delivery.id);
      const snapshot = this.#conversation.ensureSnapshot(agent.id, threadId);
      // A turn started on this thread while the provider and the thread were prepared. The user
      // cannot see that race, so the delivery goes back to the head of the queue rather than
      // failing: a message to a busy agent always waits. `drainAgent` reschedules it in its
      // `finally`, and `mayDrain` holds it there until the turn ends.
      if (snapshot.activeTurnId) {
        for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }

      const agentNames = agentNamesById(this.#store.list());
      // `threadId` is the provider session; a tab owner is a public thread.
      const tags = this.#hooks.tagReferences(agent.id, this.#conversation.publicThreadId(agent.id, threadId));
      const requestIds = new Set(
        batch.flatMap(({ delivery: item }) =>
          item.sender.kind === "agent" && item.replyToMessageId ? [item.replyToMessageId] : [],
        ),
      );
      const promptInput = (executionText: string | undefined) => {
        // The deliveries of one interrupted turn share its continuation, so the prompt states it once.
        const continued = new Set<string>();
        const input = combinedPromptInput(
          batch.map((item) => {
            const { resumeAfterUsageLimit, ...rest } = item;
            const repeated = resumeAfterUsageLimit !== undefined && continued.has(resumeAfterUsageLimit.turnId);
            if (resumeAfterUsageLimit) continued.add(resumeAfterUsageLimit.turnId);
            return deliveryPromptInput(repeated ? rest : item, {
              agentNames,
              snapshot,
              routineRun:
                item.delivery.sender.kind === "routine" ? this.#routines.runForDelivery(item.delivery.id) : null,
              workflowRunSource:
                item.delivery.sender.kind === "routine" ? this.#routines.workflowRunSource(item.delivery.id) : null,
              wokenWaits: item.delivery.sender.kind === "routine" ? this.#routines.wokenWaits(item.delivery.id) : [],
              routineTimezone:
                item.delivery.sender.kind === "routine"
                  ? this.#routines.timezoneForDelivery(item.delivery.id)
                  : undefined,
              answeredRoutine: this.answeredRoutine(item.delivery),
              tags,
              ...(executionText === undefined ? {} : { executionText }),
            });
          }),
          [...requestIds].flatMap((requestId) => this.#mailbox.unansweredRecipients(requestId)),
          agentNames,
        );
        return batch.some((item) => item.restartedResult) ? restartedResultInput(input) : input;
      };
      // The request is already in the session, so a plan continuation sends only its note. A new
      // session, which gets the history handoff, gets the request again before the note (#8779).
      const completeInput =
        planNote === undefined ? promptInput(execution?.text) : [{ type: "text" as const, text: planNote }];
      // A channel packet with only unread messages, or an external message without the guidance, goes
      // only to the session that read the rest. The session can change from here to the retry below,
      // as when the provider cannot resume it.
      const shortened = channelDelivery ? channels : messagingDelivery ? messaging : undefined;
      const delta = shortened?.delta(delivery.id);
      const deltaInput = delta ? promptInput(delta.text) : null;
      // The handoff that each start sent: the cleanup after the turn removes only that part.
      const sentHandoffs = new Map<string, string>();
      const inputForThread = (providerThreadId: string) => {
        const handoff = this.#threads.consumePendingHandoff(providerThreadId);
        const input =
          deltaInput && shortened?.sendsDelta(delivery.id, providerThreadId)
            ? deltaInput
            : planNote !== undefined && handoff && handoffHasHistory(handoff)
              ? restatedContinuationInput(promptInput(execution?.text), planNote)
              : completeInput;
        if (!handoff) return input;
        sentHandoffs.set(providerThreadId, handoff);
        return input.map((item, index) =>
          index === 0 && item.type === "text"
            ? { ...item, text: `${handoff}${CURRENT_MESSAGE_SEPARATOR}${item.text}` }
            : item,
        );
      };

      for (const { delivery: item, senderTaskId } of batch) {
        if (snapshot.messages.some((message) => message.id === item.id)) continue;
        snapshot.messages.push({
          id: item.id,
          author: item.sender.kind === "agent" ? "agent" : "user",
          source: item.sender.kind === "agent" ? "agent" : "user",
          ...(item.sender.kind === "agent" ? { senderAgentId: item.sender.agentId } : {}),
          replyToMessageId: item.replyToMessageId,
          attachments: item.attachments,
          delivery: { id: item.id, status: "starting", position: null },
          text: item.text,
          createdAt: item.createdAt,
          status: "completed",
          // Marked as the mailbox marks it, so no client shows the setup message, and a message
          // between agents does not make a side thread unread (#5794) and shows as one (#5812).
          ...(item.sender.kind === "agent"
            ? {
                itemType: AGENT_EXCHANGE_ITEM_TYPE,
                exchange: incomingAgentExchange(item, item.sender.agentId, senderTaskId),
              }
            : this.#mailbox.isWelcomeDelivery(item.id)
              ? { itemType: AGENT_WELCOME_ITEM_TYPE }
              : // The continuation of a channel request is not a new message from the person (#8812).
                channelDelivery && this.#channels?.resumesAfterSubtasks(item.id)
                ? { itemType: CHANNEL_RESUME_ITEM_TYPE }
                : {}),
        });
      }
      this.#conversation.emitConversation(snapshot);

      const startTurn = (providerThreadId: string) =>
        Effect.gen({ self: this }, function* () {
          // Read again here, not only above: the provider, the thread and the channel are prepared in
          // between, and an endpoint removed during that wait finds the process still running. The
          // retry below calls this as well, so the recovered thread is checked too.
          yield* drainStep(requireServedModel);
          return yield* this.#threads
            .requestWithArchivedThreadRecovery(
              agent,
              client,
              "turn/start",
              {
                threadId: providerThreadId,
                model: agent.model,
                effort: agent.reasoningEffort,
                sessionSettings: sessionSettingsOverrides(
                  this.#store.list().find((current) => current.id === agent.id) ?? agent,
                ),
                clientUserMessageId: delivery.id,
                // The delivery stays the same; a continuation must not overwrite the first turn's items.
                ...((context.resumeAfterUsageLimit || planNote !== undefined) && client.provider !== "codex"
                  ? { clientTurnId: randomUUID() }
                  : {}),
                // A teammate message that wants no answer tells the model to write nothing, so an empty
                // turn is the expected result and not a provider that swallowed its error.
                answerOptional:
                  delivery.sender.kind === "agent" && delivery.expectsReply === false && !delivery.replyToMessageId,
                input: inputForThread(providerThreadId),
                cwd: agent.workspacePath,
                runtimeWorkspaceRoots: workspaceWritableRoots(agent, this.#store.sharedRoot),
                approvalPolicy: "on-request",
                approvalsReviewer: "user",
                sandboxPolicy: codexSandboxPolicy(agent, this.#store.sharedRoot),
                ...(client.provider === "codex" || client.provider === "claude"
                  ? this.#serviceTier(agent, client.provider)
                  : {}),
              },
              decodeTurnResponse,
            )
            .pipe(toDeliveryStartFailed);
        });
      // Claude, ACP and Pi take the delivery id as the turn id. A delivery that a refused turn put back
      // in the queue keeps its id, and the end of that turn must not end this new run (#2468).
      this.#hooks.turnRestarting(delivery.id);
      const firstStart = yield* Effect.result(startTurn(threadId));
      let response: Effect.Success<ReturnType<typeof startTurn>>;
      if (Result.isSuccess(firstStart)) response = firstStart.success;
      else {
        // Codex compacts this thread, so the input did not reach it. The messages keep their place
        // and wait for the compaction turn to end.
        if (!routineThreadId && isCodexCompactionRefusal(firstStart.failure.cause)) {
          for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
          this.#compaction.holdForRefusal(agent.id, threadId, client);
          this.#mailboxSync.emitQueue(agent.id);
          return;
        }
        // A routine session started just now. When it is gone, the provider failed, and the run fails.
        if (routineThreadId || !isMissingProviderSessionError(firstStart.failure.cause, client.provider))
          return yield* firstStart.failure;
        const unavailableThreadId = threadId;
        if (this.#conversation.loadedClientFor(unavailableThreadId) === client) {
          this.#conversation.unloadThread(unavailableThreadId);
        }
        threadId = yield* this.#threads.ensureThread(agent, client, execution?.threadId).pipe(toDeliveryStartFailed);
        response = yield* startTurn(threadId);
        if (threadId === unavailableThreadId) {
          this.#threads.logRecovery(agent.id, client.provider, "resumed");
        }
      }
      // The provider has accepted the turn. Publish the active turn before the first mailbox write
      // can yield: queue reconciliation may run while delivery rows change, and an idle cached
      // snapshot with a running delivery is a stale state for clients.
      // A provider can end the turn before this answer is read, as when an ACP process exits during
      // `turn/start`. Its end already cleared the turn, so it is not marked active again: no later
      // event would end it, and it would hold every message of this agent.
      if (!this.#hooks.turnEnded(response.turn.id)) snapshot.activeTurnId = response.turn.id;
      confirmedTurnId = response.turn.id;
      this.#busyRetries.delete(agent.id);
      this.#turnModels.set(laneKey({ agentId: agent.id, taskId: laneId }), {
        turnId: response.turn.id,
        model: agent.model,
      });
      for (const item of batch)
        yield* this.#mailbox.markRunning(item.delivery.id, response.turn.id).pipe(toDeliveryStartFailed);
      if (this.#channels)
        yield* this.#channels.accepted(delivery.id, threadId, response.turn.id).pipe(toDeliveryStartFailed);
      if (messagingDelivery) this.#messaging?.accepted(delivery.id, threadId);
      if (this.#hooks.turnEnded(response.turn.id)) {
        // The end found these messages before they ran, or while the writes above waited, so it
        // left them running. Nothing else settles them.
        for (const item of batch) {
          const current = this.#mailbox.getDelivery(item.delivery.id)?.delivery;
          if (current?.status !== "running" || current.turnId !== response.turn.id) continue;
          yield* this.#mailbox.markTerminal(item.delivery.id, "interrupted", null).pipe(toDeliveryStartFailed);
          if (channelDelivery && this.#channels)
            yield* this.#channels.deliveryFailed(item.delivery.id, CHANNEL_START_FAILED).pipe(toDeliveryStartFailed);
          this.#messaging?.deliverySettled(item.delivery.id, "interrupted");
        }
        const live = this.#conversation.ensureSnapshot(agent.id, threadId);
        for (const held of new Set([snapshot, live])) {
          if (held.activeTurnId === response.turn.id) held.activeTurnId = null;
        }
        for (const item of batch) this.#mailboxSync.syncDeliveryMessage(live, item.delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        this.#conversation.emitConversation(live);
      } else {
        const currentDelivery = this.#mailbox.getDelivery(delivery.id)?.delivery;
        if (currentDelivery?.status === "running" && currentDelivery.turnId === response.turn.id) {
          for (const item of batch) this.#mailboxSync.syncDeliveryMessage(snapshot, item.delivery.id);
          this.#mailboxSync.emitQueue(agent.id);
          this.#conversation.emitConversation(snapshot);
        }
      }
      yield* this.#threads.deletePendingHandoff(threadId, sentHandoffs.get(threadId)).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            this.#hooks.emitError("history_handoff_cleanup_failed", failure.cause, agent.id);
          }),
        ),
      );
    }).pipe(
      // Synchronous store/event failures used the same reconciliation path before migration.
      Effect.catchDefect((cause) => Effect.fail(new DeliveryStartFailed({ cause }))),
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          const error = failure.cause;
          // The provider accepted the turn. Keep its active reservation even when a mailbox write
          // failed: restoring or replaying any delivery could submit the same provider turn twice.
          // The lifecycle association and the targeted mailbox retry finish rows left in starting.
          if (confirmedTurnId) {
            this.#hooks.emitError("delivery_reconciliation_pending", error, delivery.recipientAgentId);
            this.#mailboxSync.retryDeliveryReconciliation(
              delivery.recipientAgentId,
              confirmedTurnId,
              batch.map(({ delivery: item }) => item.id),
            );
            return;
          }
          // The provider started a turn of its own after the check above, or the start found the
          // agent's provider signed out. Nothing ran, and `mayDrain` holds the messages until that turn
          // ends or the provider is signed in again.
          const recipient = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
          // The session did not open in time. Codex opens the sessions of all its agents one at a time,
          // so when many agents start together, the last ones wait behind the others past the request
          // timeout (#11607). The provider can also stop, or not answer, before the turn is sent, as when
          // it restarts (#11843). Nothing ran, so the messages wait and try again, a limited number of times.
          const providerStopped = error instanceof ProviderStoppedError;
          const resumeTimedOut =
            (providerStopped || isRequestTimeout(error, "thread/resume")) &&
            this.#mayRetryResume(
              delivery.recipientAgentId,
              laneKey({ agentId: delivery.recipientAgentId, taskId: laneId }),
            );
          if (
            error instanceof ProviderTurnActiveError ||
            resumeTimedOut ||
            (recipient && this.#providers.signInRequired(providerForAgent(recipient)) && this.#waitsForSignIn(delivery))
          ) {
            if (
              (error instanceof ProviderTurnActiveError || resumeTimedOut) &&
              (this.#drainCalls.get(delivery.recipientAgentId) ?? 0) === drainCallsAtStart
            )
              this.#providerTurnHolds.add(laneKey({ agentId: delivery.recipientAgentId, taskId: laneId }));
            for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
            this.#mailboxSync.emitQueue(delivery.recipientAgentId);
            if (resumeTimedOut)
              logger.warn(
                providerStopped
                  ? "The provider stopped before the turn was sent. Its messages try again."
                  : "A session did not open in time. Its messages try again.",
                { agentId: delivery.recipientAgentId, provider: error.providerName },
              );
            if (error instanceof ProviderSessionBusyError || resumeTimedOut)
              yield* this.#retryBusySession(delivery.recipientAgentId);
            return;
          }
          // The session does not offer the agent's model, so nothing ran. An agent that moves to a backup
          // model on a provider error passes over this model, and the messages run on the backup (#11797).
          if (
            error instanceof ProviderModelNotOfferedError &&
            !channelDelivery &&
            !messagingDelivery &&
            this.#hooks.mayFailOver(delivery.recipientAgentId)
          ) {
            logger.warn("A session does not offer the agent's model. The agent moves to its backup model.", {
              agentId: delivery.recipientAgentId,
              model: requestedModel,
            });
            this.#usageLimits.failed(delivery.recipientAgentId, requestedModel);
            for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
            this.#mailboxSync.emitQueue(delivery.recipientAgentId);
            // The move drains the agent again when it ends. A turn of the agent that still runs holds the
            // move, and the lane waits for the drain at that turn's end: a start now fails the same way.
            if (!this.#hooks.followUsageLimit(delivery.recipientAgentId))
              this.#providerTurnHolds.add(laneKey({ agentId: delivery.recipientAgentId, taskId: laneId }));
            return;
          }
          // The provider of a routine run did not start, such as with no internet connection. Nothing
          // ran, so the run waits in the queue and starts again later, instead of failing until its
          // next occurrence (#6751). A message behind it ends the wait, and the run fails as before.
          // A session that did not open in time is the same: Codex can stop answering new sessions
          // while its open chats still answer (#12480).
          const sessionStartTimedOut = isRequestTimeout(error, "thread/start");
          if (
            (providerStartFailed || sessionStartTimedOut) &&
            recipient &&
            batch.length === 1 &&
            this.#mayRetryStart(context, error, laneId)
          ) {
            const provider = providerForAgent(recipient);
            if (this.#startRetry.schedule(delivery.id, delivery.recipientAgentId, provider)) {
              for (const item of batch)
                yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              logger.warn("A routine run waits for its provider to start.", {
                agentId: delivery.recipientAgentId,
                provider,
                reason: this.#hooks.redactMcp(error instanceof Error ? error.message : String(error)),
              });
              return;
            }
          }
          this.#startRetry.forget(delivery.id);
          if (isRequestTimeout(error, "turn/start")) {
            turnMayRun = true;
            this.#channels?.deliveryUncertain(delivery.id);
            this.#hooks.emitError(
              "delivery_start_unconfirmed",
              `${error.providerName} did not confirm the turn start in time. OpenBot will wait for lifecycle events instead of retrying potentially duplicated work.`,
              delivery.recipientAgentId,
            );
            // The wait has a limit: a turn that never starts would keep these messages starting, and
            // the agent's queue would stop with no notice.
            const ids = batch.map(({ delivery: item }) => item.id);
            yield* Effect.forkDetach(
              this.#settleUnstarted(delivery.recipientAgentId, ids, releaseReservation, routineThreadId).pipe(
                Effect.delay(TURN_START_GRACE_MS),
              ),
            );
            return;
          }
          const detail = this.#hooks.redactMcp(error instanceof Error ? error.message : String(error));
          // Another Codex app holds the thread. The user reads what to do, and the log keeps the detail.
          const threadInUse = isCodexThreadInUse(error);
          // After its last try, a message that the stopped provider did not start says what to do.
          const stoppedReason =
            providerStopped && recipient
              ? sourceText("error.provider.stoppedBeforeStart", {
                  provider: providerLabel(providerForAgent(recipient)),
                })
              : sessionStartTimedOut && recipient
                ? sourceText("error.provider.sessionStartTimedOut", {
                    provider: providerLabel(providerForAgent(recipient)),
                  })
                : null;
          const reason = threadInUse ? sourceText("error.provider.codexThreadInUse") : (stoppedReason ?? detail);
          // A spent plan window refused the start, so nothing ran. The messages wait for the reset, and
          // a channel task goes back to its channel, so that its assignment does not reserve the host.
          if (!messagingDelivery && isPlanLimitDiagnostic(reason)) {
            if (!channelDelivery) {
              for (const item of batch)
                yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              // After the restore, so a routine set to skip finds its run back in the queue.
              yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
              return;
            }
            // Before the requeue, so the channel does not assign the task to this agent again at once.
            yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
            // A ready backup continues earlier work in the same assignment, so the work is not lost.
            if (
              context.resumeAfterUsageLimit &&
              this.#hooks.mayContinueOnBackup(delivery.recipientAgentId) &&
              (yield* this.#hooks.requeueChannelDelivery(delivery.id, true))
            ) {
              yield* this.#mailbox.restoreQueued(delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              this.#requeuedAtLimit.add(delivery.recipientAgentId);
              return;
            }
            if (yield* this.#hooks.requeueChannelDelivery(delivery.id)) {
              yield* this.#mailbox.markTerminal(delivery.id, "interrupted", null).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              this.#requeuedAtLimit.add(delivery.recipientAgentId);
              return;
            }
          }
          yield* this.#mailbox.markTerminal(delivery.id, "failed", reason).pipe(toDeliveryStartFailed);
          // The provider did not read the answers that were to start with it, so they wait for the next turn.
          for (const { delivery: companion } of batch) {
            if (companion.id !== delivery.id)
              yield* this.#mailbox.restoreQueued(companion.id).pipe(toDeliveryStartFailed);
          }
          this.#mailboxSync.emitQueue(delivery.recipientAgentId);
          // The agent that asked gets the failure as its answer; the drain of the sender below starts it.
          yield* this.#answerFailedRequest(delivery.id, delivery.recipientAgentId);
          const startReason = this.#startReason(recipient, error);
          if (this.#channels)
            yield* this.#channels
              .deliveryFailed(delivery.id, startReason ?? CHANNEL_START_FAILED)
              .pipe(toDeliveryStartFailed);
          this.#messaging?.deliveryFailed(delivery.id, startReason);
          // The provider refused the session or the turn, so no turn line records the failure.
          logger.warn("A message did not start.", {
            agentId: delivery.recipientAgentId,
            model: requestedModel,
            reason: detail,
          });
          this.#hooks.emitError(
            "delivery_start_failed",
            threadInUse || stoppedReason ? reason : error,
            delivery.recipientAgentId,
          );
          this.scheduleDrain(delivery.recipientAgentId);
          // The requester may hold the other answers until this request ends.
          if (delivery.sender.kind === "agent") this.scheduleDrain(delivery.sender.agentId);
        }),
      ),
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          // A turn that started, or that may still start, closes the session when it ends.
          if (routineThreadId && !confirmedTurnId && !turnMayRun)
            yield* this.#threads.closeRoutineThread(routineThreadId);
          releaseRuntimeRefresh();
          if (!confirmedTurnId && !turnMayRun) releaseReservation();
          for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) - 1);
        }),
      ),
    );
  }, Effect.uninterruptible);

  /** Sends the agent that asked the note that its request failed. A failed note does not stop the drain. */
  #answerFailedRequest(deliveryId: string, agentId: string): Effect.Effect<void> {
    return this.#mailbox
      .answerFailedRequest(
        deliveryId,
        (taskId) => this.#tasks.threadId(taskId) !== null,
        (id) => this.#store.list().some((agent) => agent.id === id),
      )
      .pipe(
        Effect.match({
          onFailure: (failure) => this.#hooks.emitError("failed_request_answer_failed", failure.cause, agentId),
          onSuccess: (requesterId) => {
            if (requesterId) this.#mailboxSync.emitQueue(requesterId);
          },
        }),
      );
  }

  /**
   * Whether a routine run whose provider did not start can wait for a new start. Channel work and an
   * external conversation fail at once, so that their channel or their sender hears of it. An expired
   * sign-in waits for the user, not for time, and a run with a message behind it does not hold that
   * message back. Other routine runs behind it can wait: their provider cannot start either.
   */
  #mayRetryStart(context: DeliveryContext, error: unknown, laneId: string | null): boolean {
    const { delivery } = context;
    return (
      delivery.sender.kind === "routine" &&
      !this.#channels?.store.assignmentForDelivery(delivery.id) &&
      !this.#messaging?.ownsDelivery(delivery.id) &&
      !(error instanceof ProviderSignInError) &&
      classifyUserError(error) !== "auth" &&
      this.#onlyRoutineRunsQueued(delivery.recipientAgentId, laneId)
    );
  }

  /** Whether each queued delivery of this lane is a routine run. */
  #onlyRoutineRunsQueued(agentId: string, laneId: string | null): boolean {
    return this.#mailbox
      .laneQueuedIds(agentId, laneId)
      .every((id) => this.#mailbox.getDelivery(id)?.delivery.sender.kind === "routine");
  }

  /**
   * The provider is available again: the routine runs that wait for it start now. The caller drains
   * the agents of that provider; a run of an agent on another provider does not wait for this one.
   */
  providerResumed(provider: AgentProvider): void {
    this.#startRetry.providerResumed(provider);
  }

  /**
   * The wait of a routine run ended. With no provider running no queue drains, so the provider starts
   * here, as Refresh starts it, also after OpenBot stopped starting it for failed starts in a row.
   * While no provider runs, nothing else can start or fail the run, so it keeps waiting.
   */
  readonly #retryRoutineStart = Effect.fn("DrainScheduler.retryRoutineStart")(function* (
    this: DrainScheduler,
    deliveryId: string,
    agentId: string,
    provider: AgentProvider,
  ) {
    if (this.#hooks.isStopping()) return;
    if (this.#mailbox.getDelivery(deliveryId)?.delivery.status !== "queued") {
      this.#startRetry.forget(deliveryId);
      return;
    }
    // The agent moved to another provider: the run starts there, with no wait for the old one.
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent || providerForAgent(agent) !== provider) {
      this.#startRetry.forget(deliveryId);
      this.scheduleDrain(agentId);
      return;
    }
    yield* this.#providers.refreshProvider(provider).pipe(Effect.ignore);
    const available = this.#providers
      .status()
      .providers?.some((row) => row.id === provider && row.state === "available");
    // A start that failed again waits again, without a second start from the drain at once.
    if (!available && this.#startRetry.schedule(deliveryId, agentId, provider, !this.#providers.isReady())) return;
    // The provider runs, or the run had all its waits and the drain fails it as before.
    this.scheduleDrain(agentId);
  });

  /**
   * Whether this delivery is a routine run with its own provider session: in the agent's own chat, or
   * in the routine's side thread. The session closes when the run ends, so the thread session does
   * not grow with each run. A routine run in another task, a channel or a messaging thread runs in
   * that thread's session.
   */
  #runsInOwnSession(context: DeliveryContext): boolean {
    const id = context.delivery.id;
    if (context.delivery.sender.kind !== "routine") return false;
    const taskId = this.#mailbox.taskIdForDelivery(id);
    if (taskId !== null) return this.#tasks.isRoutineThread(taskId);
    return !this.#channels?.store.assignmentForDelivery(id) && !this.#messaging?.ownsDelivery(id);
  }

  /**
   * The routine run that sent the request a teammate's answer replies to, when that run had its own
   * session. The session closed with the run, so the turn that reads the answer did not see the
   * routine task, and a task with several steps stopped after the first answer (#6457).
   */
  answeredRoutine(delivery: DeliveryContext["delivery"]): AnsweredRoutine | null {
    if (delivery.sender.kind !== "agent" || !delivery.replyToMessageId) return null;
    const run = this.#mailbox.routineDeliveryOfRequest(delivery.recipientAgentId, delivery.replyToMessageId);
    if (run?.delivery.sender.kind !== "routine" || !this.#runsInOwnSession(run)) return null;
    return { routineName: run.delivery.sender.routineName, task: run.delivery.text };
  }

  /**
   * Ends the messages of an unconfirmed `turn/start` that no turn took by the deadline. A turn that
   * started late took them already, and holds its reservation like any turn.
   */
  readonly #settleUnstarted = Effect.fn("DrainScheduler.settleUnstarted")(
    function* (
      this: DrainScheduler,
      agentId: string,
      deliveryIds: readonly string[],
      releaseReservation: () => void,
      routineThreadId: string | null,
    ) {
      if (this.#hooks.isStopping()) return;
      let settled = false;
      for (const id of deliveryIds) {
        const current = this.#mailbox.getDelivery(id)?.delivery;
        if (current?.status !== "starting" || current.turnId) continue;
        yield* this.#mailbox
          .markTerminal(id, "interrupted", sourceText("error.backend.turnNotStarted"))
          .pipe(toDeliveryStartFailed);
        if (this.#channels?.store.assignmentForDelivery(id))
          yield* this.#channels.deliveryFailed(id, CHANNEL_START_FAILED).pipe(toDeliveryStartFailed);
        this.#messaging?.deliverySettled(id, "interrupted");
        settled = true;
      }
      if (!settled) return;
      // No turn took the routine run, so its session ends here.
      if (routineThreadId) yield* this.#threads.closeRoutineThread(routineThreadId);
      releaseReservation();
      this.#mailboxSync.emitQueue(agentId);
      this.scheduleDrain(agentId);
    },
    Effect.catch((failure) => Effect.sync(() => this.#hooks.emitError("delivery_start_unconfirmed", failure.cause))),
  );

  /** The model this turn runs on, or `null` when no running turn of this agent is the one asked for. */
  modelForTurn(agentId: string, turnId: string): string | null {
    for (const [key, running] of this.#turnModels)
      if (running.turnId === turnId && laneOf(key).agentId === agentId) return running.model;
    return null;
  }

  /** True while a delivery for this provider is between its first await and its turn. */
  hasStartingDeliveries(provider: AgentProvider): boolean {
    return this.#starting(provider) > 0;
  }

  #starting(provider: AgentProvider): number {
    return this.#startingDeliveries.get(provider) ?? 0;
  }

  /**
   * What a stopped channel task or an external conversation says when the provider did not start
   * it, or null for the general reason. A sign-in is the start failure that the reader can fix, so it
   * is named instead of the general reason (#6684): the provider's own sign-in text when the start
   * failed with it, such as a request for an API key, and an expired sign-in otherwise, also when the
   * provider refused the account before its check marked it. A provider that is not downloaded is
   * named too (#10597). Only catalog text goes out: every reader of it sees it, in the reader's
   * language. Another Codex app that holds the thread is the same: a new try fails until the reader
   * closes it there.
   */
  #startReason(recipient: AgentSummary | undefined, error: unknown): string | null {
    if (isCodexThreadInUse(error)) return sourceText("error.provider.codexThreadInUse");
    if (!recipient || !(error instanceof Error)) return null;
    const provider = providerForAgent(recipient);
    const statusText =
      this.#providers.status().providers?.find((status) => status.id === provider)?.message === error.message;
    // The status of the agent's own provider keeps the text of the missing download, and the start
    // fails with it. The general status message can be about another provider, so it is not used.
    if (statusText && matchingSourceKeys(error.message).some((key) => PROVIDER_MISSING_KEYS.has(key)))
      return error.message;
    const signInText = error instanceof ProviderSignInError || (this.#providers.signInRequired(provider) && statusText);
    // A fixed catalog text holds nothing from the provider. A placeholder can carry the provider's own
    // words, and a text outside the catalog, such as "Connect ChatGPT to continue.", is not translated.
    if (signInText && isFixedSourceText(error.message)) return error.message;
    // The agent runs on this provider, which it can only choose while signed in, so its sign-in expired.
    if (signInText || classifyUserError(error) === "auth")
      return sourceText("error.provider.signInExpired", { provider: providerLabel(provider) });
    return null;
  }

  /**
   * Whether this delivery waits while its agent's provider waits for a sign-in. Channel work and an
   * external conversation still start and fail, so that their channel or their sender hears of it and
   * the work does not hold a channel assignment.
   */
  #waitsForSignIn(delivery: DeliveryContext["delivery"] | undefined): boolean {
    if (!delivery) return true;
    return !(this.#channels?.store.assignmentForDelivery(delivery.id) || this.#messaging?.ownsDelivery(delivery.id));
  }

  /**
   * The providers a delivery to this agent can reach. One for an agent that exists; an agent
   * startDelivery has still to create can land on any of them, so all of them are claimed.
   */
  #deliveryProviders(agentId: string): AgentProvider[] {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    return agent ? [providerForAgent(agent)] : [...AGENT_PROVIDERS];
  }

  /** The agent's account lists a model that only it serves, with its fast tier, before the catalogue (#5217). */
  #serviceTier(agent: AgentSummary, provider: "codex" | "claude"): { serviceTier?: string | null } {
    const current = this.#store.list().find((candidate) => candidate.id === agent.id) ?? agent;
    return serviceTier(current, provider, [
      ...this.#providers.accountModels(provider, current.providerAccountId),
      ...this.#providers.listModels(),
    ]);
  }
}

export class DeliveryStartFailed extends Schema.TaggedError<DeliveryStartFailed>()("DeliveryStartFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: drainStep, rewrap: toDeliveryStartFailed } = causeHelpers(DeliveryStartFailed);

/**
 * The Codex or Claude service tier of a turn. The provider keeps the tier for the next turns of the
 * thread. `null` returns the thread to the standard tier, also for a model with no fast tier. A Claude
 * agent that never set fast mode sends nothing, so the provider keeps its own tier. A Codex agent that
 * never set it also sends `null` when its model has a fast tier: the picker shows Standard for it, and
 * a `service_tier` in the Codex config must not run the turn at a faster, more expensive tier (#11879).
 * While the catalog does not know the model, such as before the CLI lists its models, the turn sends
 * nothing and keeps the tier of the thread.
 */
function serviceTier(
  agent: Pick<AgentSummary, "fastMode" | "ultrafast" | "model">,
  provider: "codex" | "claude",
  models: readonly AgentModelOption[],
): { serviceTier?: string | null } {
  if (agent.fastMode === false) return { serviceTier: null };
  const model = models.find((candidate) => candidate.provider === provider && candidate.id === agent.model);
  if (!model) return {};
  if (agent.fastMode === undefined) return provider === "codex" && model.fastServiceTier ? { serviceTier: null } : {};
  // Ultrafast on a model or account without the tier runs at Fast, the next fastest tier.
  if (agent.ultrafast) return { serviceTier: model.ultrafastServiceTier ?? model.fastServiceTier ?? null };
  return { serviceTier: model.fastServiceTier ?? null };
}
