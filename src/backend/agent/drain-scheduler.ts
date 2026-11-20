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
import type { LiveVoiceRelayed } from "./live-voice";
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

export const REMOVED_ENDPOINT_MESSAGE = sourceText("error.agent.endpointRemoved");

const logger = createOpenBotLogger("drain-scheduler");
const CHANNEL_START_FAILED = "The provider could not start this assignment. Resume to try again.";
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
const TURN_START_GRACE_MS = 5 * 60_000;
const PROVIDER_SESSION_BUSY_RETRY_MS = 15_000;
const PROVIDER_SESSION_BUSY_RETRY_MAX_MS = 2 * 60_000;
const SESSION_RESUME_TIMEOUT_RETRIES = 3;

interface SessionRetry {
  refusals: number;
  waiting: boolean;
  resumeTimeouts: Map<string, number>;
}

export interface DrainHooks {
  emitError(code: string, error: unknown, agentId?: string): void;
  isStopping(): boolean;
  isDeleting(agentId: string): boolean;
  servesModel(model: string, provider: AgentProvider): boolean;
  redactMcp(text: string): string;
  tagReferences(agentId: string, threadId: string | null): TagReferenceSource;
  liveVoiceRelayed(deliveryId: string): LiveVoiceRelayed | null;
  requeueChannelDelivery(deliveryId: string, continueWork?: boolean): Effect.Effect<boolean>;
  mayContinueOnBackup(agentId: string): boolean;
  mayFailOver(agentId: string): boolean;
  followUsageLimit(agentId: string): boolean;
  followPendingRuntime(agentId: string): boolean;
  turnEnded(turnId: string): boolean;
  staleTurnSettlement(agentId: string, threadId: string, turnId: string): Effect.Effect<void> | null;
  turnRestarting(turnId: string): void;
  deliveriesStarting(deliveryIds: readonly string[], start: DeliveryStart): void;
  startRequestedNewChat(agentId: string, queuedRuns?: readonly string[]): Effect.Effect<void>;
  dropRequestedNewChat(agentId: string): void;
  signInWait(agentId: string, provider: AgentProvider): void;
}

export interface TaskLanes {
  threadId(taskId: string): string | null;
  openTaskIds(agentId: string): readonly string[];
  limit(agentId: string): number;
  oneTurnAtATime(agentId: string): boolean;
  isRoutineThread(taskId: string): boolean;
}

interface Lane {
  readonly agentId: string;
  readonly taskId: string | null;
}

function laneTaskId(lane: Lane): string | null {
  return lane.taskId !== null && lane.taskId !== MESSAGING_LANE && laneChannelId(lane.taskId) === null
    ? lane.taskId
    : null;
}

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
  readonly #slotWaiters = new Set<string>();
  #wakingSlotWaiters = false;
  readonly #hooks: DrainHooks;
  readonly #channels: ChannelService | undefined;
  readonly #messaging: MessagingThreads | undefined;
  readonly #drainingLanes = new Set<string>();
  readonly #requeuedAtLimit = new Set<string>();
  readonly #settingsHolds = new Map<string, number>();
  readonly #providerTurnHolds = new Set<string>();
  readonly #busyRetries = new Map<string, SessionRetry>();
  readonly #drainCalls = new Map<string, number>();
  readonly #reportedHolds = new Map<string, string>();
  readonly #turnModels = new Map<string, { turnId: string; model: string }>();
  readonly #startingDeliveries = new Map<AgentProvider, number>();
  readonly #scheduledDrains = new Set<string>();
  readonly #settlingTurns = new Set<string>();
  readonly #drainTasks = new Map<string, Deferred.Deferred<void, DeliveryStartFailed>>();
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

  mayDrain(agentId: string): boolean {
    return this.#heldBy(mainLane(agentId)) === null;
  }

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

  #ownThreadTurnActive(agentId: string, messaging: boolean): boolean {
    return this.#ownThreadTurn(agentId, messaging) !== undefined;
  }

  #ownThreadTurn(agentId: string, messaging: boolean) {
    return [...this.#conversation.activeSnapshots()].find(
      ([id, snapshot]) =>
        id === agentId &&
        Boolean(snapshot.activeTurnId) &&
        !this.#conversation.isSideThread(snapshot.threadId) &&
        messaging ===
          (snapshot.threadId !== null &&
            this.#conversation.isExecutionThread(snapshot.threadId) &&
            this.#messaging?.inMessagingLane(agentId, snapshot.threadId) === true),
    )?.[1];
  }

  #settleStaleOwnTurn(lane: Lane): void {
    if (lane.taskId !== null && lane.taskId !== MESSAGING_LANE) return;
    const snapshot = this.#ownThreadTurn(lane.agentId, lane.taskId === MESSAGING_LANE);
    const turnId = snapshot?.activeTurnId;
    if (!snapshot?.threadId || !turnId || this.#settlingTurns.has(turnId)) return;
    const settlement = this.#hooks.staleTurnSettlement(lane.agentId, snapshot.threadId, turnId);
    if (!settlement) return;
    this.#settlingTurns.add(turnId);
    Effect.runFork(settlement.pipe(Effect.ensuring(Effect.sync(() => this.#settlingTurns.delete(turnId)))));
  }

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

  #heldBy(lane: Lane): string | null {
    const { agentId, taskId } = lane;
    if (this.#hooks.isDeleting(agentId)) return "deleting";
    if (this.#settingsHolds.has(agentId)) return "session-settings";
    if (this.#laneTurnActive(lane)) return "active-turn";
    if (this.#providerTurnHolds.has(laneKey(lane))) return "provider-turn";
    if (
      this.#tasks.oneTurnAtATime(agentId) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "one-turn";
    const channelId = laneChannelId(taskId);
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
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (
      agent &&
      !this.#providers.agentClientCurrent(agent) &&
      this.#lanesOf(agentId).some((other) => other.taskId !== taskId && this.#laneRunning(other))
    )
      return "agent-client-changing";
    if (agent && this.#startRetry.agentWaits(agentId)) {
      const head = this.#mailbox.nextQueued(agentId, taskId)?.delivery;
      if (
        head &&
        this.#startRetry.waiting(head.id, providerForAgent(agent)) &&
        this.#onlyRoutineRunsQueued(agentId, taskId)
      )
        return "provider-start";
    }
    if (
      agent &&
      this.#providers.signInRequired(providerForAgent(agent)) &&
      this.#waitsForSignIn(this.#mailbox.nextQueued(agentId, taskId)?.delivery)
    )
      return "sign-in";
    if (taskId === null && this.#tasks.oneTurnAtATime(agentId) && !(this.#channels?.mayDrain(agentId) ?? true))
      return "channel";
    if (!this.#profileSave.mayDrain(agentId)) return "profile-save";
    if (!this.#duplication.mayDrain(agentId)) return "duplication";
    if (this.#compactionHolds(lane)) return "compaction";
    if (!this.#routines.mayDrain(agentId)) return "routine";
    if (!this.#usageLimits.mayDrain(agentId) && !this.#usageLimits.mayTry(agentId)) return "usage-limit";
    return null;
  }

  #reportHold(lane: Lane, reason: string): void {
    const key = laneKey(lane);
    if (this.#reportedHolds.get(key) === reason || !this.#mailbox.nextQueued(lane.agentId, lane.taskId)) return;
    this.#reportedHolds.set(key, reason);
    const working =
      reason === "active-turn" && lane.taskId === null ? this.#conversation.workingSnapshot(lane.agentId) : undefined;
    const channelId = laneChannelId(lane.taskId);
    const provider = reason === "sign-in" ? this.#laneProvider(lane) : null;
    if (provider) this.#hooks.signInWait(lane.agentId, provider);
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
      ...(provider ? { provider } : {}),
      ...(working ? { threadId: working.threadId, turnId: working.activeTurnId } : {}),
    });
  }

  #laneProvider(lane: Lane): AgentProvider | null {
    const agent = this.#store.get(lane.agentId);
    return agent ? providerForAgent(agent) : null;
  }

  messagingTurnActive(agentId: string): boolean {
    return this.#ownThreadTurnActive(agentId, true);
  }

  ownChatHold(agentId: string): string | null {
    return this.#heldBy({ agentId, taskId: null });
  }

  taskHold(agentId: string, taskId: string): string | null {
    const lane = { agentId, taskId };
    if (!this.#mailbox.nextQueued(agentId, taskId)) return null;
    const heldByMachine = !this.#memory.mayDrain(agentId) || this.#slotWaiters.has(laneKey(lane));
    return this.#heldBy(lane) ?? this.#providerHold(agentId) ?? (heldByMachine ? "machine" : null);
  }

  #providerHold(agentId: string): "providers-not-ready" | "provider-cli-replaced" | null {
    if (!this.#providers.isReady()) return "providers-not-ready";
    if (this.#deliveryProviders(agentId).some((provider) => this.#providers.isReplacingCli(provider)))
      return "provider-cli-replaced";
    return null;
  }

  scheduleDrain(agentId: string, followUsageLimit = true): void {
    this.#drainCalls.set(agentId, (this.#drainCalls.get(agentId) ?? 0) + 1);
    for (const key of [...this.#providerTurnHolds])
      if (laneOf(key).agentId === agentId) this.#providerTurnHolds.delete(key);
    this.#scheduleDrain(agentId, followUsageLimit);
    this.retrySlotWaiters();
  }

  scheduleDrains(agentIds: Iterable<string>): void {
    this.#slots.round(() => {
      for (const agentId of agentIds) this.scheduleDrain(agentId);
    });
  }

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

  retrySlotWaiters(): void {
    if (this.#wakingSlotWaiters || this.#slotWaiters.size === 0) return;
    this.#wakingSlotWaiters = true;
    try {
      const waiters = [...this.#slotWaiters];
      this.#slotWaiters.clear();
      this.#slots.round(() => {
        for (const key of waiters) this.#scheduleLane(laneOf(key));
      });
    } finally {
      this.#wakingSlotWaiters = false;
    }
  }

  #scheduleDrain(agentId: string, followUsageLimit = true): void {
    if (this.#scheduleLane(mainLane(agentId), followUsageLimit)) return;
    this.#scheduleSideLanes(agentId);
  }

  #scheduleSideLanes(agentId: string): void {
    for (const taskId of [...this.#mailbox.queuedTaskIds(agentId), ...this.#mailbox.sideLanes(agentId, true)])
      if (this.#mailbox.nextQueued(agentId, taskId)) this.#scheduleLane({ agentId, taskId }, false);
  }

  #scheduleLane(lane: Lane, followUsageLimit = true): boolean {
    const key = laneKey(lane);
    if (this.#hooks.isStopping() || this.#scheduledDrains.has(key)) return false;
    const hold =
      (!this.#providers.isReady() && "providers-not-ready") ||
      (this.#drainingLanes.has(key) && "drain-running") ||
      this.#heldBy(lane) ||
      (this.#heldByMachine(lane) && "machine");
    if (hold) this.#reportHold(lane, hold);
    if (hold === "active-turn") this.#settleStaleOwnTurn(lane);
    if (followUsageLimit && hold === "sign-in" && this.#hooks.followPendingRuntime(lane.agentId)) return true;
    if (followUsageLimit && (!hold || hold === "usage-limit") && this.#hooks.followUsageLimit(lane.agentId))
      return true;
    if (hold) return false;
    this.#scheduledDrains.add(key);
    const completion = Deferred.makeUnsafe<void, DeliveryStartFailed>();
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

  #mayStartNow(lane: Lane): boolean {
    return (
      !this.#hooks.isStopping() &&
      !this.#drainingLanes.has(laneKey(lane)) &&
      this.#providerHold(lane.agentId) === null &&
      this.#heldBy(lane) === null
    );
  }

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
      this.#providerHold(agentId) ||
      (this.#heldByMachine(lane) && "machine");
    if (hold) {
      this.#reportHold(lane, hold);
      if (hold === "active-turn") this.#settleStaleOwnTurn(lane);
      return;
    }
    this.#reportedHolds.delete(key);
    this.#drainingLanes.add(key);
    yield* Effect.gen({ self: this }, function* () {
      if (this.#laneTurnActive(lane)) return;
      const context = this.#mailbox.nextQueued(agentId, taskId);
      if (!context) {
        if (taskId === null) yield* this.#hooks.startRequestedNewChat(agentId);
        return;
      }
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
      if (laneTaskId(lane) === null) {
        const agent = this.#store.list().find((candidate) => candidate.id === agentId);
        const assignment = this.#channels?.store.assignmentForDelivery(context.delivery.id);
        const publicThreadId = assignment
          ? this.#channels?.store.context(assignment.channelId, assignment.agentId).threadId
          : (this.#messaging?.threadForDelivery(context.delivery.id) ?? agent?.threadId);
        if (assignment && publicThreadId)
          this.#conversation.registerChannelThread(agentId, publicThreadId, assignment.channelId);
        const ownSession = this.#runsInOwnSession(context);
        if (agent && publicThreadId === agent.threadId) {
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
      this.#usageLimits.tryStarted(agentId);
      yield* this.startDelivery(context, planNote ?? undefined);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#drainingLanes.delete(key);
          if (this.#requeuedAtLimit.delete(agentId) || this.#mailbox.nextQueued(agentId))
            this.#scheduleLane(mainLane(agentId));
          this.#scheduleSideLanes(agentId);
          this.retrySlotWaiters();
        }),
      ),
    );
  }, Effect.uninterruptible);

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
    let routineThreadId: string | null = null;
    const claimed = this.#deliveryProviders(delivery.recipientAgentId);
    for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) + 1);
    let releaseRuntimeRefresh: () => void = () => {};
    const releaseReservation = this.#memory.reserveTurn();
    let turnMayRun = false;
    let providerStartFailed = false;
    let requestedModel: string | null = null;
    const pickedAt = Date.now();
    yield* Effect.gen({ self: this }, function* () {
      for (const item of batch) yield* this.#mailbox.markStarting(item.delivery.id).pipe(toDeliveryStartFailed);
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
      yield* this.#mailbox.verifyDeliveryAttachments(delivery.id).pipe(toDeliveryStartFailed);
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
      yield* checkAgentFolders(agent);
      requestedModel = agent.model;
      const requireServedModel = () => {
        if (!this.#hooks.servesModel(agent.model, providerForAgent(agent))) throw new Error(REMOVED_ENDPOINT_MESSAGE);
      };
      yield* drainStep(requireServedModel);
      yield* this.#threads.applyPendingRuntimeRefresh(agent, new Set(batch.map((item) => item.delivery.id)));
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
        this.#startRetry.forget(delivery.id);
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }
      if (taskThreadId) this.#conversation.registerTaskThread(agent.id, taskThreadId);
      const channelId = laneChannelId(laneId);
      if (channelDelivery && channelId !== null && execution)
        this.#conversation.registerChannelThread(agent.id, execution.threadId, channelId);
      if (ownSession) {
        const publicThreadId =
          execution?.threadId ?? (yield* this.#store.ensureThreadId(agent.id).pipe(toDeliveryStartFailed));
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
      this.#startRetry.forget(delivery.id);
      const snapshot = this.#conversation.ensureSnapshot(agent.id, threadId);
      if (snapshot.activeTurnId) {
        for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
        this.#mailboxSync.emitQueue(agent.id);
        return;
      }

      const agentNames = agentNamesById(this.#store.list());
      const tags = this.#hooks.tagReferences(agent.id, this.#conversation.publicThreadId(agent.id, threadId));
      const requestIds = new Set(
        batch.flatMap(({ delivery: item }) =>
          item.sender.kind === "agent" && item.replyToMessageId ? [item.replyToMessageId] : [],
        ),
      );
      const stillWorking = new Set(
        [...requestIds].flatMap((requestId) => this.#mailbox.stillWorkingRecipients(agent.id, requestId)),
      );
      const unanswered = new Set(
        [...requestIds]
          .flatMap((requestId) => this.#mailbox.unansweredRecipients(requestId))
          .filter((recipientId) => !stillWorking.has(recipientId)),
      );
      const promptInput = (executionText: string | undefined) => {
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
              liveVoice: this.#hooks.liveVoiceRelayed(item.delivery.id),
              externalChat: this.#messaging?.ownsDelivery(item.delivery.id) === true,
              ...(executionText === undefined ? {} : { executionText }),
            });
          }),
          [...unanswered],
          agentNames,
          [...stillWorking],
        );
        return batch.some((item) => item.restartedResult) ? restartedResultInput(input) : input;
      };
      const completeInput =
        planNote === undefined ? promptInput(execution?.text) : [{ type: "text" as const, text: planNote }];
      const shortened = channelDelivery ? channels : messagingDelivery ? messaging : undefined;
      const delta = shortened?.delta(delivery.id);
      const deltaInput = delta ? promptInput(delta.text) : null;
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
                ...((context.resumeAfterUsageLimit || planNote !== undefined) && client.provider !== "codex"
                  ? { clientTurnId: randomUUID() }
                  : {}),
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
      this.#hooks.turnRestarting(delivery.id);
      const firstStart = yield* Effect.result(startTurn(threadId));
      let response: Effect.Success<ReturnType<typeof startTurn>>;
      if (Result.isSuccess(firstStart)) response = firstStart.success;
      else {
        if (!routineThreadId && isCodexCompactionRefusal(firstStart.failure.cause)) {
          for (const item of batch) yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
          this.#compaction.holdForRefusal(agent.id, threadId, client);
          this.#mailboxSync.emitQueue(agent.id);
          return;
        }
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
      Effect.catchDefect((cause) => Effect.fail(new DeliveryStartFailed({ cause }))),
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          const error = failure.cause;
          if (confirmedTurnId) {
            this.#hooks.emitError("delivery_reconciliation_pending", error, delivery.recipientAgentId);
            this.#mailboxSync.retryDeliveryReconciliation(
              delivery.recipientAgentId,
              confirmedTurnId,
              batch.map(({ delivery: item }) => item.id),
            );
            return;
          }
          const recipient = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
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
            if (!this.#hooks.followUsageLimit(delivery.recipientAgentId))
              this.#providerTurnHolds.add(laneKey({ agentId: delivery.recipientAgentId, taskId: laneId }));
            return;
          }
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
              logger.warn(
                sessionStartTimedOut
                  ? "A routine run waits for its provider to open a session."
                  : "A routine run waits for its provider to start.",
                {
                  agentId: delivery.recipientAgentId,
                  provider,
                  reason: this.#hooks.redactMcp(error instanceof Error ? error.message : String(error)),
                },
              );
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
            const ids = batch.map(({ delivery: item }) => item.id);
            yield* Effect.forkDetach(
              this.#settleUnstarted(delivery.recipientAgentId, ids, releaseReservation, routineThreadId).pipe(
                Effect.delay(TURN_START_GRACE_MS),
              ),
            );
            return;
          }
          const detail = this.#hooks.redactMcp(error instanceof Error ? error.message : String(error));
          const threadInUse = isCodexThreadInUse(error);
          const stoppedKey = providerStopped
            ? "error.provider.stoppedBeforeStart"
            : sessionStartTimedOut
              ? "error.provider.sessionStartTimedOut"
              : null;
          const stoppedReason =
            stoppedKey && recipient
              ? sourceText(stoppedKey, { provider: providerLabel(providerForAgent(recipient)) })
              : null;
          const reason = threadInUse ? sourceText("error.provider.codexThreadInUse") : (stoppedReason ?? detail);
          if (!messagingDelivery && isPlanLimitDiagnostic(reason)) {
            if (!channelDelivery) {
              for (const item of batch)
                yield* this.#mailbox.restoreQueued(item.delivery.id).pipe(toDeliveryStartFailed);
              this.#mailboxSync.emitQueue(delivery.recipientAgentId);
              yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
              return;
            }
            yield* this.#usageLimits.reached(delivery.recipientAgentId, null, requestedModel);
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
          for (const { delivery: companion } of batch) {
            if (companion.id !== delivery.id)
              yield* this.#mailbox.restoreQueued(companion.id).pipe(toDeliveryStartFailed);
          }
          this.#mailboxSync.emitQueue(delivery.recipientAgentId);
          yield* this.#answerFailedRequest(delivery.id, delivery.recipientAgentId);
          const startReason = this.#startReason(recipient, error);
          if (this.#channels)
            yield* this.#channels
              .deliveryFailed(delivery.id, startReason ?? CHANNEL_START_FAILED)
              .pipe(toDeliveryStartFailed);
          this.#messaging?.deliveryFailed(delivery.id, startReason);
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
          if (delivery.sender.kind === "agent") this.scheduleDrain(delivery.sender.agentId);
        }),
      ),
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (routineThreadId && !confirmedTurnId && !turnMayRun)
            yield* this.#threads.closeRoutineThread(routineThreadId);
          releaseRuntimeRefresh();
          if (!confirmedTurnId && !turnMayRun) releaseReservation();
          for (const provider of claimed) this.#startingDeliveries.set(provider, this.#starting(provider) - 1);
        }),
      ),
    );
  }, Effect.uninterruptible);

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

  #onlyRoutineRunsQueued(agentId: string, laneId: string | null): boolean {
    return this.#mailbox
      .laneQueuedIds(agentId, laneId)
      .every((id) => this.#mailbox.getDelivery(id)?.delivery.sender.kind === "routine");
  }

  providerResumed(provider: AgentProvider): void {
    this.#startRetry.providerResumed(provider);
  }

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
    if (!available && this.#startRetry.schedule(deliveryId, agentId, provider, !this.#providers.isReady())) return;
    this.scheduleDrain(agentId);
  });

  #runsInOwnSession(context: DeliveryContext): boolean {
    const id = context.delivery.id;
    if (context.delivery.sender.kind !== "routine") return false;
    const taskId = this.#mailbox.taskIdForDelivery(id);
    if (taskId !== null) return this.#tasks.isRoutineThread(taskId);
    return !this.#channels?.store.assignmentForDelivery(id) && !this.#messaging?.ownsDelivery(id);
  }

  answeredRoutine(delivery: DeliveryContext["delivery"]): AnsweredRoutine | null {
    if (delivery.sender.kind !== "agent" || !delivery.replyToMessageId) return null;
    const run = this.#mailbox.routineDeliveryOfRequest(delivery.recipientAgentId, delivery.replyToMessageId);
    if (run?.delivery.sender.kind !== "routine" || !this.#runsInOwnSession(run)) return null;
    return { routineName: run.delivery.sender.routineName, task: run.delivery.text };
  }

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
      if (routineThreadId) yield* this.#threads.closeRoutineThread(routineThreadId);
      releaseReservation();
      this.#mailboxSync.emitQueue(agentId);
      this.scheduleDrain(agentId);
    },
    Effect.catch((failure) => Effect.sync(() => this.#hooks.emitError("delivery_start_unconfirmed", failure.cause))),
  );

  modelForTurn(agentId: string, turnId: string): string | null {
    for (const [key, running] of this.#turnModels)
      if (running.turnId === turnId && laneOf(key).agentId === agentId) return running.model;
    return null;
  }

  hasStartingDeliveries(provider: AgentProvider): boolean {
    return this.#starting(provider) > 0;
  }

  #starting(provider: AgentProvider): number {
    return this.#startingDeliveries.get(provider) ?? 0;
  }

  #startReason(recipient: AgentSummary | undefined, error: unknown): string | null {
    if (isCodexThreadInUse(error)) return sourceText("error.provider.codexThreadInUse");
    if (!recipient || !(error instanceof Error)) return null;
    const provider = providerForAgent(recipient);
    const statusText =
      this.#providers.status().providers?.find((status) => status.id === provider)?.message === error.message;
    if (statusText && matchingSourceKeys(error.message).some((key) => PROVIDER_MISSING_KEYS.has(key)))
      return error.message;
    const signInText = error instanceof ProviderSignInError || (this.#providers.signInRequired(provider) && statusText);
    if (signInText && isFixedSourceText(error.message)) return error.message;
    if (signInText || classifyUserError(error) === "auth")
      return sourceText("error.provider.signInExpired", { provider: providerLabel(provider) });
    return null;
  }

  #waitsForSignIn(delivery: DeliveryContext["delivery"] | undefined): boolean {
    if (!delivery) return true;
    return !(this.#channels?.store.assignmentForDelivery(delivery.id) || this.#messaging?.ownsDelivery(delivery.id));
  }

  #deliveryProviders(agentId: string): AgentProvider[] {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    return agent ? [providerForAgent(agent)] : [...AGENT_PROVIDERS];
  }

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

function serviceTier(
  agent: Pick<AgentSummary, "fastMode" | "ultrafast" | "model">,
  provider: "codex" | "claude",
  models: readonly AgentModelOption[],
): { serviceTier?: string | null } {
  if (agent.fastMode === false) return { serviceTier: null };
  const model = models.find((candidate) => candidate.provider === provider && candidate.id === agent.model);
  if (!model) return {};
  if (agent.fastMode === undefined) return provider === "codex" && model.fastServiceTier ? { serviceTier: null } : {};
  if (agent.ultrafast) return { serviceTier: model.ultrafastServiceTier ?? model.fastServiceTier ?? null };
  return { serviceTier: model.fastServiceTier ?? null };
}
