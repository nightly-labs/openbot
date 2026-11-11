import {
  type AgentEvent,
  type AgentStepActivity,
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
  isAgentAnswer,
  isAgentContextCategories,
  latestTurnAnswer,
  PLAN_CONTINUATION_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { type CauseCode, classifyFailure, isCauseCode } from "@openbot/telemetry";
import { userErrorMessage } from "@openbot/user-errors";
import { Cause, Deferred, Effect, Exit, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { BrowserOperationError } from "../browser-effects";
import type { BrowserDynamicToolHooks } from "../browser-tool-actions";
import { newAssistantMessage, normalizeCompletionStatus } from "../conversation-snapshots";
import { causeHelpers, reportOriginalFailure } from "../effect-boundary";
import { channelLane, type DeliveryContext, type MailboxStore, type UsageLimitContinuation } from "../mailbox-store";
import {
  type AppServerNotification,
  type DynamicToolCallParams,
  type DynamicToolResult,
  decodeAccountLoginCompletedResult,
  decodeRecordResponse,
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
import { type InstructionsChanges, instructionsChangeMessage } from "./instructions-changes";
import type { MailboxSync } from "./mailbox-sync";
import { memoryChangesMessage } from "./memory-changes-message";
import { type PlanContinuation, waitsForUser } from "./plan-continuation";
import { PLAN_UPDATED_METHOD, planFromNotification } from "./plan-updates";
import {
  isBalanceDiagnostic,
  isPlanLimitDiagnostic,
  isUsageLimitDiagnostic,
  providerResetDelayMs,
} from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import { isNoUpdateAnswer, quietTeammateDelivery, settleQuietRoutineTurn } from "./routine-quiet-runs";
import { type SkillLoad, skillLoads, skillLoadTokens } from "./skill-loads";
import {
  foldCodexChildItem,
  foldCodexSubagentItem,
  SUBAGENTS_UPDATED_METHOD,
  stopRunningSubagents,
  subagentsFromNotification,
} from "./subagent-updates";
import { shellReadPaths, ThreadFileHistory } from "./thread-file-history";
import {
  isNonActionableCodexWarning,
  isToolItem,
  refusedSessionFailure,
  type ToolUsageSignal,
  toolActivity,
  toolFailed,
  toolFailureText,
  toolProgressText,
  toolTraceDetail,
  toolUsage,
  toThreadItem,
} from "./thread-items";
import { TurnTraces, traceMessage } from "./turn-traces";
import { collectProviderUsage } from "./usage-collection";
import { USAGE_LIMIT_METHOD, type UsageLimitGate } from "./usage-limit-gate";

const logger = createOpenBotLogger("turn-lifecycle");
/** The retry of one turn after which the user gets a notice. A single retry is a normal network error. */
const RETRY_NOTICE_ATTEMPTS = 3;
const ENDED_TURN_LIMIT = 256;
/** How long before a turn's start its usage records can be, as in host analytics. */
const TURN_USAGE_MARGIN_MS = 60 * 60 * 1_000;
/**
 * The provider errors that move an agent set to switch without asking to its next backup model. Each
 * one can pass on another provider, account or model; a request the model refuses fails on each.
 * A usage limit that the usage-limit gate does not hold comes here too, such as a spent Gemini quota (#4368).
 * A model that gave only its reasoning and no answer can answer on another model (#6594). As for each
 * cause, a turn that ran a tool step does not run again, so the tool does not run two times.
 */
const FAILOVER_CAUSES: ReadonlySet<CauseCode> = new Set([
  "billing",
  "usage_limit",
  "provider_unavailable",
  "rate_limit",
  "authentication",
  "network",
  "timeout",
  "empty_answer",
]);

/**
 * The provider errors during a turn's own compaction that end the turn but can pass when it continues:
 * a connection that failed or stopped answering (#5822). A server error keeps the provider's text.
 */
const COMPACTION_RETRY_CAUSES: ReadonlySet<CauseCode> = new Set(["network", "timeout"]);

/** A provider error held until the end of its turn, which runs the turn again on a backup model or shows it. */
interface HeldProviderError {
  message: string;
  context: FailureContext & { causeCode: CauseCode };
  /** A spent balance or quota: the usage notice explains it, so a turn that does not move shows no banner. */
  quiet?: boolean;
  /** The Google page where the user fixes the account that failed the turn. */
  link?: string;
}

/**
 * The page that an ACP client names for an account the user must fix (#2419). Only a Google sign-in
 * page: the error banner opens it, and the other clients pass their provider's fields through.
 */
function accountLink(params: unknown): string | undefined {
  const link = getString(params, "link");
  if (!link || !URL.canParse(link)) return undefined;
  const url = new URL(link);
  return url.protocol === "https:" && url.hostname === "accounts.google.com" ? link : undefined;
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
  /** Lets another thread of the tab's owner agent use the tab. A tab of another agent does not change. */
  shareTab(tabId: string, target: { agentId: string; threadId: string }): void;
  /** A deleted thread can use no tab. */
  unshareThread(threadId: string): void;
  /** The scrubbed title and address of a tab this agent owns, or null. */
  agentTab(tabId: string, agentId: string): { title: string; url: string } | null;
}

export interface TurnHooks {
  emitFailure?(failure: FailureSignal): void;
  emit(event: AgentEvent): void;
  /** `link` is a page that the error banner opens. It is not part of the failure report. */
  emitError(code: string, error: unknown, agentId?: string, context?: FailureContext, link?: string): void;
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
   * Whether a ready backup, or the ready model the agent left for a limit, continues work that a usage
   * limit stopped after it started. An agent set to ask uses its order too: the turn already started,
   * so there is no moment to ask.
   */
  mayContinueOnBackup(agentId: string): boolean;
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
  /** Whether this public thread is the side thread of a routine, which takes that routine's runs. */
  isRoutineThread(threadId: string): boolean;
  /** Whether this task's thread exists and is not archived. */
  taskOpen(taskId: string): boolean;
  /** The error of a task turn. It shows in the task's panel, not in the agent's own chat. */
  taskFailed(taskId: string, message: string): void;
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

/** When the drain took a delivery from the queue, and its provider process start (null: it was running). */
export interface DeliveryStart {
  pickedAt: number;
  providerStartMs: number | null;
}

/**
 * Where the time of a finished turn went, in milliseconds. Each value is null when it is not known.
 * `queueWaitMs`: from the message to the drain. `startMs`: from the drain to the provider's
 * `turn/started`, `providerStartMs` included. `firstOutputMs`: from `turn/started` to the first text,
 * thinking or tool step.
 */
export interface TurnTiming {
  queueWaitMs: number | null;
  startMs: number | null;
  providerStartMs: number | null;
  firstOutputMs: number | null;
}

/** Entries kept for starts and finished turns that nothing took. Older ones go first. */
const TURN_TIMING_LIMIT = 64;

function keepBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= TURN_TIMING_LIMIT) break;
    map.delete(oldest);
  }
}

export interface TurnLifecycleOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  memories: AgentMemories;
  instructions: InstructionsChanges;
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
  readonly #instructions: InstructionsChanges;
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
  /** How many times the provider retried a request of each running turn. */
  readonly #turnRetries = new Map<string, number>();
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
      start: DeliveryStart | null;
      firstOutputAt: number | null;
      produced: boolean;
      acted: boolean;
      /** A compaction ran in the turn. Codex can end such a turn with no answer. */
      compacted: boolean;
      /** The tool steps that started and did not end yet. While one is open, the turn works, it does not wait. */
      openTools: Set<string>;
    }
  >();
  /** The drain's start of each starting delivery, until its turn starts. */
  readonly #deliveryStarts = new Map<string, DeliveryStart>();
  /** The timing of each finished turn, until host analytics takes it. */
  readonly #turnTimings = new Map<string, TurnTiming>();
  /** Running turns a provider plan refused, with the reset in epoch seconds when the provider gave it. */
  readonly #limitedTurns = new Map<string, number | null>();
  /**
   * Running turns that a provider error failed while their agent can move to a backup model, with
   * the error and its context. The end of the turn runs the turn again on the backup, or shows the error.
   */
  readonly #failoverTurns = new Map<string, HeldProviderError>();
  /**
   * Running turns whose own compaction lost the connection, with the error in plain words. `stalled`:
   * the compaction deadline stopped the turn, so its `interrupted` end is a failure. The end of the
   * turn continues it once, or shows the error.
   */
  readonly #compactionFailures = new Map<string, HeldProviderError & { stalled?: true }>();
  /** The deadline of the compaction that runs inside a turn, by provider thread. */
  readonly #compactionDeadlines = new Map<string, NodeJS.Timeout>();
  /**
   * The provider accounts and models (`UsageLimitGate.failureKey`) where a provider error failed each
   * delivery before it ran again, for one run again per key.
   */
  readonly #failoverRetries = new Map<string, Set<string>>();
  /** The deliveries run again after a refused session history. Each one gets a single retry. */
  readonly #refusedRetries = new Set<string>();
  /** Running turns whose agent called the no-update tool. The completion of the turn takes the entry. */
  readonly #noUpdateTurns = new Set<string>();
  /** Quiet routine turns whose provider failed with no answer after the no-update call. The completion takes the entry. */
  readonly #quietEmptyAnswers = new Set<string>();
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
  /**
   * The running Codex subagents, under their own thread id, with the turn whose list shows them.
   * Codex sends the items of these threads too, and OpenBot knows no agent for them.
   */
  readonly #codexChildren = new Map<string, { agentId: string; threadId: string; turnId: string }>();
  /**
   * The turns of each agent whose subagents still run. A background subagent keeps its turn here after
   * the turn ended. Boot recovery stops every subagent, so nothing here outlives the process.
   */
  readonly #subagentTurns = new Map<string, Set<string>>();

  constructor(options: TurnLifecycleOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#mailboxSync = options.mailboxSync;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#memories = options.memories;
    this.#instructions = options.instructions;
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

  /** The newest turn with running subagents of each agent in `agentIds`. */
  subagentTurns(agentIds: ReadonlySet<string>): Array<{ agentId: string; turnId: string }> {
    const turns: Array<{ agentId: string; turnId: string }> = [];
    for (const [agentId, turnIds] of this.#subagentTurns) {
      const turnId = [...turnIds].at(-1);
      if (turnId && agentIds.has(agentId)) turns.push({ agentId, turnId });
    }
    return turns;
  }

  forgetAgent(agentId: string): void {
    this.fileHistory.forgetAgent(agentId);
    this.#failedTurns.delete(agentId);
    this.#subagentTurns.delete(agentId);
    this.#lastEventAt.delete(agentId);
    for (const [childId, parent] of this.#codexChildren)
      if (parent.agentId === agentId) this.#codexChildren.delete(childId);
  }

  deliveriesStarting(deliveryIds: readonly string[], start: DeliveryStart): void {
    for (const id of deliveryIds) keepBounded(this.#deliveryStarts, id, start);
  }

  /** Where the time of this finished turn went. Once: a second call gives null. */
  takeTurnTiming(turnId: string): TurnTiming | null {
    const timing = this.#turnTimings.get(turnId) ?? null;
    this.#turnTimings.delete(turnId);
    return timing;
  }

  #keepTurnTiming(
    turnId: string,
    running: { startedAt: number; sentAt: number | null; start: DeliveryStart | null; firstOutputAt: number | null },
  ): void {
    const { start } = running;
    keepBounded(this.#turnTimings, turnId, {
      queueWaitMs: start === null || running.sentAt === null ? null : Math.max(0, start.pickedAt - running.sentAt),
      startMs: start === null ? null : Math.max(0, running.startedAt - start.pickedAt),
      providerStartMs: start?.providerStartMs ?? null,
      firstOutputMs: running.firstOutputAt === null ? null : running.firstOutputAt - running.startedAt,
    });
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
    this.#turnRetries.clear();
    this.#limitedTurns.clear();
    this.#failoverTurns.clear();
    this.#failoverRetries.clear();
    this.#runningTurns.clear();
    this.#noUpdateTurns.clear();
    this.#quietEmptyAnswers.clear();
    this.#reportedFailures.clear();
    this.#endedTurns.clear();
    this.#refusedRetries.clear();
    this.#lastEventAt.clear();
    this.#codexChildren.clear();
    this.#itemTurns.clear();
    this.#traces.clear();
    this.#observedCompactions.clear();
    this.#compactionFailures.clear();
    for (const timer of this.#compactionDeadlines.values()) clearTimeout(timer);
    this.#compactionDeadlines.clear();
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
      const compactionFailure = this.#compactionFailures.get(turnId);
      this.#compactionFailures.delete(turnId);
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
        this.#instructions.dropTurn(turn.agentId, turnId);
        // The client is gone, so no browser tool of this turn can run. Other agents keep their controls.
        this.#browser.endControl(this.#conversation.publicThreadId(turn.agentId, turn.threadId), turnId);
        // The turn does not end here, so a provider error held for a failover shows now.
        const failover = this.#failoverTurns.get(turnId);
        this.#failoverTurns.delete(turnId);
        if (failover) this.#showFailoverError(turn.agentId, turn.threadId, failover);
        // A process that the compaction deadline could not stop ended, so its plain error shows now.
        else if (compactionFailure) this.#showFailoverError(turn.agentId, turn.threadId, compactionFailure);
        continue;
      }
      this.#attention.clearForTurn(turn.threadId, turnId);
      if (this.#observedCompactions.get(turn.threadId) === turnId) {
        this.#observedCompactions.delete(turn.threadId);
        this.#clearCompactionDeadline(turn.threadId);
      }
      this.#compaction.abandonCompaction(turn.threadId);
      // The running entry is gone already, so `#completeTurn` cannot keep the timing.
      this.#keepTurnTiming(turnId, turn);
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

  /** The mailbox lane of a provider thread: its task, its channel, or null for the agent's own chat. */
  #laneForThread(agentId: string, externalThreadId: string): string | null {
    const taskId = this.#taskForThread(agentId, externalThreadId);
    if (taskId !== null) return taskId;
    const channelId = this.#conversation.channelForThread(this.#conversation.publicThreadId(agentId, externalThreadId));
    return channelId === null ? null : channelLane(channelId);
  }

  /**
   * Whether a completed turn may continue its plan: it served only the user's or the agent's own
   * messages, the user did not stop it, its last line asks nothing but whether to continue and does not say it waits, opened no wait and holds no question,
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
    if (waitsForUser(answer)) return false;
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

  /**
   * Stops a turn whose own compaction runs longer than the compaction run deadline. Codex waits with no
   * end for a connection that stops answering during a compaction, and its turn showed "Compacting
   * context" until the user stopped it (#5822). The end of the turn continues it once.
   */
  #armCompactionDeadline(agentId: string, threadId: string, turnId: string, client: AgentClient): void {
    this.#clearCompactionDeadline(threadId);
    const runMs = this.#compaction.runTimeoutMs;
    const timer = setTimeout(() => {
      this.#compactionDeadlines.delete(threadId);
      if (this.#observedCompactions.get(threadId) !== turnId || !this.#runningTurns.has(turnId)) return;
      logger.warn("A provider compaction did not end; OpenBot stops its turn.", { provider: client.provider, runMs });
      this.#holdCompactionFailure(
        turnId,
        {
          causeCode: "timeout",
          provider: client.provider,
          model: this.#hooks.turnModel(agentId, turnId),
          turnId,
          severity: "error",
        },
        true,
      );
      // As a Stop does, the turn ends with Codex's `turn/completed`. A request that times out starts the
      // probe that ends a process that does not answer (`CodexAppServerClient.#checkAnswering`).
      Effect.runFork(client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
    }, runMs);
    timer.unref?.();
    this.#compactionDeadlines.set(threadId, timer);
  }

  #clearCompactionDeadline(threadId: string): void {
    const timer = this.#compactionDeadlines.get(threadId);
    if (timer) clearTimeout(timer);
    this.#compactionDeadlines.delete(threadId);
  }

  /** Keeps the error of a turn whose compaction lost the connection until the turn ends. */
  #holdCompactionFailure(turnId: string, context: FailureContext & { causeCode: CauseCode }, stalled: boolean): void {
    const message = sourceText("error.agent.compactionConnectionLost");
    // An error that Codex sends after the deadline stopped the turn keeps the turn stopped by it.
    const stopped = stalled || this.#compactionFailures.get(turnId)?.stalled === true;
    this.#compactionFailures.set(turnId, { message, context, ...(stopped ? { stalled: true as const } : {}) });
    // The failed delivery keeps this reason, not the provider's text.
    this.#turnErrors.set(turnId, message);
  }

  /** Shows a provider error that was held for a failover that did not happen, as it shows with no backup. */
  #showFailoverError(agentId: string, threadId: string, failover: HeldProviderError): void {
    const taskId = this.#taskForThread(agentId, threadId);
    if (taskId === null && !failover.quiet) {
      this.#hooks.emitError("agent_error", failover.message, agentId, failover.context, failover.link);
      return;
    }
    this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
    // A thread shows no usage notice, so its failed turn keeps the provider's text (#5220).
    if (taskId !== null) this.#hooks.taskFailed(taskId, failover.message);
  }

  /**
   * Codex ends a turn with no answer and no step as completed. A lead that got its teammates' results
   * and ended that way stopped the whole team, with no error (#7225). Such a turn fails as an ACP turn
   * with no answer does, and its end runs it again or shows the error. A turn that wants no answer, a
   * turn that compacted, a plan and a turn that the user stopped can end empty.
   */
  #holdCodexNoAnswer(agentId: string, threadId: string, turnId: string, source: AgentClient): boolean {
    const running = this.#runningTurns.get(turnId);
    if (
      source.provider !== "codex" ||
      running === undefined ||
      running.acted ||
      running.compacted ||
      this.#turnErrors.has(turnId) ||
      this.#failoverTurns.has(turnId) ||
      this.#limitedTurns.has(turnId) ||
      this.#compaction.isCompactionTurn(threadId, turnId) ||
      this.#hooks.turnStopped(agentId, this.#taskForThread(agentId, threadId), turnId)
    )
      return false;
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (
      deliveries.length === 0 ||
      // A plan continuation that ends empty goes to the plan's own end (`PlanContinuation.consider`).
      deliveries.some(({ planContinuation }) => planContinuation !== undefined) ||
      deliveries.every(({ delivery }) => quietTeammateDelivery(delivery)) ||
      this.#quietRoutineTurn(agentId, threadId, deliveries)
    )
      return false;
    const messages = this.#conversation.ensureSnapshot(agentId, threadId).messages;
    if (
      messages.some(
        (message) => message.turnId === turnId && (message.id === `${turnId}:plan` || isAgentAnswer(message)),
      )
    )
      return false;
    const message = sourceText("error.provider.acpNoAnswer", {
      provider: agentProviderDescriptor(source.provider).displayName,
    });
    const context = {
      causeCode: "empty_answer" as const,
      provider: source.provider,
      model: this.#hooks.turnModel(agentId, turnId),
      turnId,
      severity: "error" as const,
    };
    logger.info("A turn ended with no answer.", { agentId, turnId, provider: source.provider });
    // The failed delivery keeps this reason.
    this.#turnErrors.set(turnId, message);
    this.#failoverTurns.set(turnId, { message, context });
    return true;
  }

  /**
   * Whether a provider error waits for the end of its turn, which can move the turn to a backup
   * model. A spent quota after work started waits also when the agent is set to ask.
   */
  #mayHoldError(agentId: string, turnId: string, causeCode: CauseCode): boolean {
    return (
      this.#hooks.mayFailOver(agentId) ||
      (causeCode === "usage_limit" &&
        this.#carriesWork(agentId, turnId, this.#runningTurns.get(turnId)) &&
        this.#hooks.mayContinueOnBackup(agentId))
    );
  }

  /** The turn did work, or continues work that an earlier provider started before its usage limit. */
  #carriesWork(agentId: string, turnId: string, running: { acted: boolean } | undefined): boolean {
    return (
      running !== undefined &&
      (running.acted ||
        this.#mailbox
          .findDeliveriesByTurn(agentId, turnId)
          .some((context) => context.resumeAfterUsageLimit !== undefined))
    );
  }

  /** Passes over the model that a held provider error failed. A spent balance names no reset (#5220). */
  #markFailed(agentId: string, model: string | null, failover: HeldProviderError): void {
    const resetDelayMs = providerResetDelayMs(failover.message);
    const spent = failover.quiet === true && resetDelayMs === null && isBalanceDiagnostic(failover.message);
    this.#usageLimits.failed(agentId, model, resetDelayMs, spent);
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
      const usage = this.#usageSession(agentId, threadId, source);
      if (usage) {
        try {
          collectProviderUsage(this.#store.database.usage, usage.agent, usage.session, notification.method, params);
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
        // Each lane of the agent starts its own turns: a task or channel turn takes only the delivery
        // of its own lane.
        const laneId = this.#laneForThread(agentId, threadId);
        const starting = unprompted ? undefined : this.#mailbox.startingDeliveryForAgent(agentId, laneId)?.delivery;
        const sentAt = starting ? Date.parse(starting.createdAt) : Number.NaN;
        const start = starting ? (this.#deliveryStarts.get(starting.id) ?? null) : null;
        // The other deliveries of the batch share this start and start no turn of their own.
        for (const [id, candidate] of this.#deliveryStarts) if (candidate === start) this.#deliveryStarts.delete(id);
        this.#runningTurns.set(turnId, {
          client: source,
          agentId,
          threadId,
          startedAt: Date.now(),
          sentAt: Number.isFinite(sentAt) ? sentAt : null,
          start,
          firstOutputAt: null,
          produced: false,
          acted: false,
          compacted: false,
          openTools: new Set(),
        });
        this.#traces.begin(turnId, new Date().toISOString());
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        snapshot.activeTurnId = turnId;
        if (laneId === null) this.#failedTurns.delete(agentId);
        const origin = starting?.sender.kind ?? "unknown";
        if (!unprompted) {
          const association = Deferred.makeUnsafe<void, TurnOperationFailed>();
          this.#turnAssociations.set(turnId, association);
          yield* Effect.gen({ self: this }, function* () {
            const exit = yield* Effect.exit(this.#associateStartedTurn(agentId, laneId, turnId, snapshot));
            yield* Deferred.done(association, exit);
            if (this.#turnAssociations.get(turnId) === association) this.#turnAssociations.delete(turnId);
          }).pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
        } else {
          // Claude answers a steer that came after the turn's last request in a turn of its own, named by
          // the steered delivery. The message goes with that answer, not above the earlier one (#6673).
          const moved = yield* this.#mailbox.moveSteerToTurn(agentId, turnId).pipe(
            Effect.catch((failure) =>
              Effect.sync(() => {
                this.#hooks.emitError("delivery_turn_association_failed", failure.cause, agentId);
                return false;
              }),
            ),
          );
          if (moved) {
            this.#mailboxSync.syncDeliveryMessage(snapshot, turnId);
            this.#mailboxSync.syncMailboxMessages(snapshot);
          }
        }
        this.#hooks.emit({ type: "turn-started", agentId, threadId: publicThreadId, turnId, origin });
        this.#conversation.emitConversation(snapshot, "turn.started", { turnId });
        const workspace = this.#store.list().find((entry) => entry.id === agentId)?.workspacePath;
        if (workspace) yield* this.#instructions.startTurn(agentId, turnId, workspace);
        return;
      }
      case "item/started":
      case "item/completed": {
        if (threadId && !agentId) {
          this.#applyCodexChildItem(threadId, getRecord(params, "item"));
          return;
        }
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const item = getRecord(params, "item");
        if (!turnId || !item) return;
        this.fileHistory.record(agentId, this.#conversation.publicThreadId(agentId, threadId), [
          ...getArray(params, "filePaths"),
          ...shellReadPaths(item),
        ]);
        const itemId = getString(item, "id");
        if (itemId) this.#itemTurns.set(itemId, turnId);
        this.#markProduced(turnId, isRepeatedWork(item));
        if (item.type === "contextCompaction") {
          const running = this.#runningTurns.get(turnId);
          if (running) running.compacted = true;
          // A memory change can mark the session for reload while its current client compacts it.
          if (this.#conversation.openClientFor(threadId) !== source) return;
          if (notification.method === "item/started") this.#observedCompactions.set(threadId, turnId);
          else this.#observedCompactions.delete(threadId);
          if (
            notification.method === "item/started" &&
            source.contextCompaction === "events" &&
            this.#runningTurns.has(turnId) &&
            !this.#compaction.isCompactionTurn(threadId, turnId)
          )
            this.#armCompactionDeadline(agentId, threadId, turnId, source);
          else this.#clearCompactionDeadline(threadId);
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
          const loads = skillLoads(item, getArray(params, "filePaths"));
          if (loads.length > 0)
            yield* this.#recordSkillLoads(
              agentId,
              threadId,
              turnId,
              itemId,
              getString(item, "cwd"),
              loads,
              source,
            ).pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
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
        const reported = getString(turn, "status") ?? "completed";
        const noAnswer = reported === "completed" && this.#holdCodexNoAnswer(agentId, threadId, turnId, source);
        // The compaction deadline stopped this turn, not the user: it failed. A quiet routine turn that
        // failed only because it gave no answer after the no-update call completed.
        const status =
          reported === "failed" && this.#quietEmptyAnswers.has(turnId) && !this.#turnErrors.has(turnId)
            ? "completed"
            : (reported === "interrupted" &&
                  this.#compactionFailures.get(turnId)?.stalled &&
                  !this.#hooks.turnStopped(agentId, this.#taskForThread(agentId, threadId), turnId)) ||
                noAnswer
              ? "failed"
              : reported;
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
          this.#clearCompactionDeadline(threadId);
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
        if (this.#conversation.openClientFor(threadId) !== source) return;
        this.#compaction.updateBudget(threadId, params, agentId);
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
        if (!threadId || !agentId || this.#conversation.openClientFor(threadId) !== source) return;
        const status = getString(params, "status");
        if (status !== "running" && status !== "completed" && status !== "failed") return;
        // Native Claude compaction does not report comparable full-context counts.
        this.#compaction.observeCompaction(threadId, status, "none");
        return;
      }
      case "openbot/turn-progress": {
        // A provider's own status for the running turn, such as a retry of a failed API request.
        const turnId = getString(params, "turnId");
        const detail = getString(params, "detail");
        if (!threadId || !agentId || !turnId || !detail || !this.#runningTurns.has(turnId)) return;
        if (this.#conversation.loadedClientFor(threadId) !== source) return;
        this.#emitTurnProgress(agentId, this.#conversation.publicThreadId(agentId, threadId), turnId, detail);
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
        // An ACP, Pi or Claude client names the cause that it read from structured fields or from its
        // own CLI text, before the error became a sentence for the user. The other clients leave it
        // to the error.
        const reportedCause = isRecord(params) && isCauseCode(params.causeCode) ? params.causeCode : null;
        const causeCode = reportedCause ?? classifyFailure(error ?? message);
        if (notification.method === "warning" && isNonActionableCodexWarning(message)) {
          // No banner, but the log keeps the reason, such as a closed WebSocket.
          logger.info("A provider warning needs no action.", {
            provider: source.provider,
            message: this.#hooks.redactMcp(message),
          });
          return;
        }
        // Codex retries on its own and reports the final failure again without `willRetry`.
        if (isRecord(params) && params.willRetry === true) {
          this.#providerRetried(agentId, threadId, getString(params, "turnId"), source.provider);
          return;
        }
        // A usage limit shows no banner, but the failed delivery still keeps it as the reason.
        const errorTurnId = getString(params, "turnId");
        // The no-update tool tells the model to end its turn, and a model that then sends only its
        // reasoning makes Grok fail the prompt with no answer. The run had nothing to report, so it
        // ends quiet and shows no error (#6247).
        if (
          notification.method === "error" &&
          causeCode === "empty_answer" &&
          agentId &&
          threadId &&
          errorTurnId &&
          this.#runningTurns.has(errorTurnId) &&
          this.#noUpdateTurns.has(errorTurnId) &&
          !this.#reportedFailures.has(errorTurnId) &&
          this.#quietRoutineTurn(agentId, threadId, this.#mailbox.findDeliveriesByTurn(agentId, errorTurnId))
        ) {
          this.#quietEmptyAnswers.add(errorTurnId);
          logger.info("A quiet turn ended with no answer after its no-update call.", {
            agentId,
            turnId: errorTurnId,
            provider: source.provider,
          });
          return;
        }
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
        // has a reading, and the free models failed with nothing on screen. Kimi keeps it because an
        // account with no Kimi Code plan has no reading. A plan window holds the queue until its
        // reset for every provider.
        if (
          error?.codexErrorInfo === "usageLimitExceeded" ||
          (isUsageLimitDiagnostic(message) &&
            ((source.provider !== "antigravity" &&
              source.provider !== "cursor" &&
              source.provider !== "opencode" &&
              source.provider !== "kimi" &&
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
          const context = {
            turnId: errorTurnId,
            provider: source.provider,
            model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
            causeCode,
            severity: notification.method === "warning" ? ("warning" as const) : ("error" as const),
          };
          yield* this.#providers.refreshUsageAfterLimit(source);
          // A spent balance or quota that the gate does not hold moves to a backup model as a provider
          // error does (#4616). The end of the turn reports it.
          if (
            notification.method === "error" &&
            agentId &&
            errorTurnId !== null &&
            this.#runningTurns.has(errorTurnId) &&
            !this.#limitedTurns.has(errorTurnId) &&
            this.#mayHoldError(agentId, errorTurnId, causeCode)
          ) {
            this.#failoverTurns.set(errorTurnId, { message, context, quiet: true });
            return;
          }
          this.#hooks.emitFailure?.({ code: "agent_error", ...(agentId !== undefined ? { agentId } : {}), ...context });
          // A thread shows no usage notice, so its failed turn keeps the provider's text (#5220). A turn
          // that a plan limit holds waits in the queue for the reset, so it has not failed.
          const held = planLimit || (errorTurnId !== null && this.#limitedTurns.has(errorTurnId));
          const taskId =
            !held && notification.method === "error" && agentId && threadId
              ? this.#taskForThread(agentId, threadId)
              : null;
          if (taskId !== null) this.#hooks.taskFailed(taskId, message);
          return;
        }
        const context = {
          causeCode,
          provider: source.provider,
          model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
          turnId: errorTurnId,
          severity: notification.method === "warning" ? ("warning" as const) : ("error" as const),
        };
        const link = notification.method === "error" ? accountLink(params) : undefined;
        // A connection that fails during the turn's own compaction ends the turn. The end of the turn
        // continues it, or shows the error in plain words (#5822).
        if (
          notification.method === "error" &&
          agentId &&
          threadId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          this.#observedCompactions.get(threadId) === errorTurnId &&
          COMPACTION_RETRY_CAUSES.has(context.causeCode) &&
          // A turn that did no work yet runs again on a backup model, as before.
          !(this.#runningTurns.get(errorTurnId)?.acted === false && this.#hooks.mayFailOver(agentId))
        ) {
          logger.warn("A provider compaction failed.", {
            provider: source.provider,
            causeCode: context.causeCode,
            message: this.#hooks.redactMcp(message),
          });
          this.#holdCompactionFailure(errorTurnId, context, false);
          return;
        }
        // A provider error moves an agent set to switch without asking to its next backup model. The
        // error waits for the end of the turn: a turn that did nothing yet runs again there instead.
        // A turn with no answer waits also with no backup: teammate results can run again (#7225).
        if (
          notification.method === "error" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          FAILOVER_CAUSES.has(context.causeCode) &&
          ((context.causeCode === "empty_answer" &&
            !(threadId && this.#compaction.isCompactionTurn(threadId, errorTurnId))) ||
            this.#mayHoldError(agentId, errorTurnId, context.causeCode))
        ) {
          this.#failoverTurns.set(errorTurnId, { message, context, ...(link ? { link } : {}) });
          return;
        }
        // A warning does not end the turn. When its text is empty, a path, a stack or too long, the
        // banner showed "The agent could not continue" in its place while the turn went on. Codex
        // warnings on Windows quote `C:\` paths. The log keeps the text and the failure count keeps
        // the report.
        if (notification.method === "warning" && userErrorMessage(message, "") === "") {
          logger.info("A provider warning has no text to show.", {
            provider: source.provider,
            message: this.#hooks.redactMcp(message),
          });
          this.#hooks.emitFailure?.({ code: "agent_warning", ...(agentId ? { agentId } : {}), ...context });
          return;
        }
        const taskId =
          notification.method === "error" && agentId && threadId ? this.#taskForThread(agentId, threadId) : null;
        if (taskId !== null) {
          this.#hooks.emitFailure?.({ code: "agent_error", ...(agentId ? { agentId } : {}), ...context });
          this.#hooks.taskFailed(taskId, message);
        } else this.#hooks.emitError(`agent_${notification.method}`, message, agentId, context, link);
      }
    }
  }).bind(this);

  /**
   * Codex sent a request of a running turn again. A turn that retries again and again looked like
   * work: Codex sent the same large request for 11 minutes, and the agent showed as working (#4374).
   * The user gets one notice per turn. A large session also compacts before its next turn.
   */
  #providerRetried(
    agentId: string | null | undefined,
    threadId: string | null | undefined,
    turnId: string | null,
    provider: AgentClient["provider"],
  ): void {
    if (!agentId || !threadId || !turnId || !this.#runningTurns.has(turnId)) return;
    const attempts = (this.#turnRetries.get(turnId) ?? 0) + 1;
    this.#turnRetries.set(turnId, attempts);
    logger.info("A provider retries a request.", {
      provider,
      attempts,
      usedPercent: this.#compaction.usedPercent(threadId),
    });
    if (attempts !== RETRY_NOTICE_ATTEMPTS) return;
    const compacts = this.#compaction.retrying(threadId);
    const percent = this.#compaction.usedPercent(threadId);
    this.#hooks.emitError(
      "agent_warning",
      compacts && percent !== null
        ? sourceText("error.backend.providerRetryingLargeContext", {
            attempts: String(attempts),
            percent: String(percent),
          })
        : sourceText("error.backend.providerRetrying", { attempts: String(attempts) }),
      agentId,
      {
        provider,
        model: this.#hooks.turnModel(agentId, turnId),
        turnId,
        severity: "warning",
      },
    );
  }

  /**
   * Records a call to the no-update tool. `quiet` when the turn runs only quiet routine runs and
   * teammate updates, so its completion keeps the text answers as quiet answers; `shown` when a
   * person waits for the answer, as in a Test run; null when neither a routine run nor a teammate
   * update started the turn. The completion decides again, because a message can join the turn after
   * the call.
   */
  requestNoUpdate(agentId: string, threadId: string, turnId: string): "quiet" | "shown" | null {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!deliveries.some(({ delivery }) => delivery.sender.kind === "routine" || quietTeammateDelivery(delivery)))
      return null;
    this.#noUpdateTurns.add(turnId);
    // A failed run is never quiet, so its answer must still be written.
    if (this.#reportedFailures.has(turnId)) return "shown";
    return this.#quietRoutineTurn(agentId, threadId, deliveries) ? "quiet" : "shown";
  }

  /**
   * Records a call to the failure tool; the latest reason wins. False when no routine run started the
   * turn. A flow handoff counts: its call fails that step only, because a handoff has no run of its own.
   * `channelRun` is a turn that owns a main task of a channel routine's request: the channel reads
   * the reason from the task's delivery and ends the run failed (#6667).
   */
  reportRoutineFailure(agentId: string, turnId: string, reason: string, channelRun = false): boolean {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!channelRun && !deliveries.some(({ delivery }) => delivery.sender.kind === "routine")) return false;
    this.#reportedFailures.set(turnId, reason);
    return true;
  }

  /**
   * Only a turn that runs nothing but quiet routine runs and teammate updates, in the agent's own
   * chat or in a routine's side thread: not in a channel, a messaging thread or another task.
   */
  #quietRoutineTurn(agentId: string, threadId: string | null, deliveries: readonly DeliveryContext[]): boolean {
    const publicThreadId = threadId === null ? null : this.#conversation.publicThreadId(agentId, threadId);
    return (
      deliveries.length > 0 &&
      (!this.#conversation.isExecutionThread(publicThreadId) ||
        (publicThreadId !== null && this.#hooks.isRoutineThread(publicThreadId))) &&
      deliveries.every(
        ({ delivery }) =>
          quietTeammateDelivery(delivery) ||
          (delivery.sender.kind === "routine" && this.#hooks.quietRoutineDelivery(delivery.id)),
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
      this.#quietEmptyAnswers.delete(turnId);
      const reportedFailure = this.#reportedFailures.get(turnId);
      this.#reportedFailures.delete(turnId);
      if (running) {
        this.#keepTurnTiming(turnId, running);
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
      this.#turnRetries.delete(turnId);
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
      const compactionFailure = this.#compactionFailures.get(turnId);
      this.#compactionFailures.delete(turnId);
      this.#deltas.flushTurn(turnId);
      yield* this.#images.waitForOperations(threadId, turnId);
      const association = this.#turnAssociations.get(turnId);
      if (association) yield* Deferred.await(association).pipe(Effect.catch(() => Effect.void));
      const memoryChanges = this.#memories.finishTurn(turnId, status).get(agentId) ?? [];
      const workspace = this.#store.list().find((entry) => entry.id === agentId)?.workspacePath;
      const instructionsChange = yield* this.#instructions.finishTurn(agentId, turnId, workspace);
      // A refused session is closed below, and a spent plan would refuse the summary turn too, so
      // neither is compacted.
      // A routine run's own session closes after this turn, so it is not compacted either. Nor is a
      // turn that a provider error ended before it did work: it can run again on a backup model. Nor
      // is a turn that a spent quota ended after work started: a backup model can continue it.
      const routineSession = this.#conversation.isRoutineSession(threadId);
      const failedOnProvider = failover !== undefined && !limited && status === "failed" && running !== undefined;
      const mayRunAgain = failedOnProvider && !running.acted;
      const mayContinue =
        failedOnProvider && failover.context.causeCode === "usage_limit" && this.#carriesWork(agentId, turnId, running);
      const shouldCompact =
        !refused &&
        !limited &&
        !mayRunAgain &&
        !mayContinue &&
        !routineSession &&
        this.#compaction.reserve(agentId, threadId, false, turnId);
      // Read before a refused session is dropped below: the drop unbinds the provider thread, and a
      // channel turn would then end on the agent's own chat, so its task kept running (#6596).
      const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
      this.#browser.endControl(publicThreadId, turnId);
      const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
      // A routine run in its own session ends in the chat's snapshot, where a later turn can still
      // run, such as one the provider started itself. That turn stays active. Cleared, the queue saw an
      // idle chat and asked the busy provider for a turn again and again. An id of a turn that no
      // longer runs is cleared, as before.
      if (snapshot.activeTurnId === turnId || !this.#runningTurns.has(snapshot.activeTurnId ?? ""))
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
      const laneTaskId = taskTurn ? this.#taskForThread(agentId, threadId) : null;
      // A turn that its own compaction stopped when the connection failed continues once, as a plan
      // continues, and shows no error. A second such stop shows the error (#5822).
      const compactionContinuation =
        compactionFailure !== undefined &&
        failover === undefined &&
        status === "failed" &&
        running !== undefined &&
        !limited &&
        !channelTurn &&
        !routineSession &&
        (!taskTurn || laneTaskId !== null) &&
        this.#planContinues(agentId, laneTaskId, turnId, deliveries, undefined)
          ? this.#planContinuation.afterFailedCompaction({
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
      // After work started, a ready backup in the agent's order, or the ready model that the agent left,
      // continues it. With neither, the work of the agent's chat or a task waits in the queue, and the
      // model continues it when its limit ends (#6660). A channel task goes back to its channel only
      // for a backup. A turn refused before work waits for the reset too. A continuation that a backup
      // refused before work keeps the earlier provider's work.
      const carriesWork = this.#carriesWork(agentId, turnId, running);
      const waitsHere = !channelTurn && deliveries.every(({ channelId }) => channelId === undefined);
      let continuing =
        limited && carriesWork && deliveries.length > 0 && (waitsHere || this.#hooks.mayContinueOnBackup(agentId));
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
      // the same one again. A turn that a spent quota ended after work started continues on a backup,
      // as after a plan limit, also when the agent is set to ask: there is no moment to ask.
      const failedKey = this.#usageLimits.failureKey(agentId, model);
      const failedOver =
        (mayRunAgain || mayContinue) &&
        failedKey !== null &&
        deliveries.length > 0 &&
        !taskTurn &&
        !channelTurn &&
        deliveries.every(({ delivery }) => !this.#failoverRetries.get(delivery.id)?.has(failedKey)) &&
        ((mayRunAgain && this.#hooks.mayFailOver(agentId)) ||
          (mayContinue && this.#hooks.mayContinueOnBackup(agentId)));
      // Teammate results start a lead's turn, and nothing else wakes the team when that turn gives no
      // answer (#7225). With no backup to take it, the turn runs once more on the same model. It did
      // no step, so it repeats nothing. A second empty run shows the error.
      const runsAgainHere =
        !failedOver &&
        mayRunAgain &&
        failover.context.causeCode === "empty_answer" &&
        failedKey !== null &&
        deliveries.length > 0 &&
        !taskTurn &&
        !channelTurn &&
        deliveries.every(
          ({ delivery }) =>
            delivery.sender.kind === "agent" &&
            Boolean(delivery.replyToMessageId) &&
            !this.#failoverRetries.get(delivery.id)?.has(failedKey),
        );
      // The work that this turn did, so that the backup model continues it and does not do it again.
      const continuedWork = Effect.gen({ self: this }, function* () {
        const workSteps = running
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
        if (trace) this.#attachTrace(snapshot.messages, agentId, turnId, trace);
        const traceSteps = trace
          ? trace.steps
              .filter((step) => step.kind === "tool")
              .map(
                (step) =>
                  `${step.command ?? step.text ?? "tool"} (${step.endedAt === null ? "interrupted" : step.failed ? "failed" : "completed"})`,
              )
              .join("\n")
          : "";
        return {
          turnId,
          previousTurnIds: [turnId],
          workSteps: this.#hooks.redactMcp(
            workSteps || (traceSteps ? `Full tool results are unavailable. Verify the saved work.\n${traceSteps}` : ""),
          ),
        };
      });
      // A foreground subagent ends with its turn. A background one works on and reports later.
      const subagents = snapshot.messages.find((message) => message.id === `${turnId}:subagents`);
      stopRunningSubagents(subagents?.subagents, new Date().toISOString(), { background: false });
      if (this.#trackSubagents(agentId, turnId, subagents?.subagents)) this.#hooks.emitRuntimeSnapshot();
      for (const [childId, parent] of this.#codexChildren)
        if (parent.turnId === turnId) this.#codexChildren.delete(childId);
      for (const message of snapshot.messages) {
        if (this.#itemTurns.get(message.id) !== turnId || message.status !== "streaming") continue;
        message.status = normalizeCompletionStatus(
          repeatable || failedOver || runsAgainHere || compactionContinuation ? "interrupted" : status,
        );
        markIncompleteImageGeneration(message, message.status);
      }
      // Only this loop reads the map, so the finished turn's items go, or it holds every item ever seen.
      for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
      if (requeue) {
        yield* this.#requeueTurn(
          agentId,
          threadId,
          turnId,
          snapshot,
          deliveries,
          continuing ? yield* continuedWork : undefined,
        );
        // After the requeue, so a routine set to skip finds its run back in the queue.
        yield* this.#usageLimits.reached(agentId, resetsAt, model);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      if (failover && (failedOver || runsAgainHere) && failedKey !== null) {
        this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
        for (const { delivery } of deliveries) {
          const failed = this.#failoverRetries.get(delivery.id) ?? new Set<string>();
          this.#failoverRetries.set(delivery.id, failed.add(failedKey));
        }
        yield* this.#requeueTurn(
          agentId,
          threadId,
          turnId,
          snapshot,
          deliveries,
          failedOver && mayContinue ? yield* continuedWork : undefined,
        );
        // A turn that runs again on the same model keeps it.
        if (failedOver) this.#markFailed(agentId, model, failover);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      // A thread turn does not run again, but the agent leaves the failing model before its next turn (#5220).
      if (failover && mayRunAgain && taskTurn && failedKey !== null && this.#hooks.mayFailOver(agentId))
        this.#markFailed(agentId, model, failover);
      // The turn did work that no backup continues, or nothing waits to run again: the error shows as
      // it does with no backup.
      if (failover) this.#showFailoverError(agentId, threadId, failover);
      if (compactionFailure && compactionContinuation)
        this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...compactionFailure.context });
      else if (compactionFailure && status === "failed" && !failover)
        this.#showFailoverError(agentId, threadId, compactionFailure);
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
      const outcome = requeued || compactionContinuation ? "interrupted" : status;
      // The failed turn of the agent's own chat and its messaging work only: a task shows its outcome
      // in its own row, and a channel turn in its channel.
      const ownLane = !taskTurn && this.#conversation.channelForThread(snapshot.threadId) === null;
      if (ownLane && outcome === "failed") this.#failedTurns.set(agentId, turnId);
      else if (ownLane) this.#failedTurns.delete(agentId);
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
      // Only a turn that ran nothing but scheduled, script or webhook runs and teammate updates: a
      // person who wrote in the same turn, or who started a Test run, waits for the answer. A failed
      // run is never quiet.
      const quiet =
        outcome === "completed" &&
        reportedFailure === undefined &&
        this.#quietRoutineTurn(agentId, snapshot.threadId, deliveries) &&
        settleQuietRoutineTurn(snapshot, turnId, noUpdateCalled);
      const latestAssistant = latestTurnAnswer(snapshot.messages, turnId);
      // A routine run that answered only the no-update marker, also a Test run that shows it in the
      // chat, does not put the marker in the preview.
      const markerAnswer =
        latestAssistant !== undefined &&
        deliveries.some(({ delivery }) => delivery.sender.kind === "routine") &&
        isNoUpdateAnswer(latestAssistant.text);
      // Before the deliveries end: until then they hold their lane, so no later turn of that lane
      // starts before the digest is in its handoff. A chat turn that starts at the same time keeps
      // the digest for its next turn (see `ThreadLifecycle.deletePendingHandoff`).
      const routineDelivery = deliveries[0]?.delivery.id;
      if (routineSession && routineDelivery && outcome === "completed" && !quiet && !markerAnswer && latestAssistant)
        yield* this.#hooks.routineAnswered(agentId, routineDelivery, latestAssistant.text);
      const planContinues =
        outcome === "completed" &&
        reportedFailure === undefined &&
        running !== undefined &&
        !channelTurn &&
        !routineSession &&
        (!taskTurn || laneTaskId !== null) &&
        this.#planContinues(agentId, laneTaskId, turnId, deliveries, latestAssistant?.text);
      const continuation =
        compactionContinuation ??
        (planContinues
          ? this.#planContinuation.consider({
              agentId,
              taskId: laneTaskId,
              deliveryIds: deliveries.map(({ delivery }) => delivery.id),
              plan: snapshot.messages.find((message) => message.id === `${turnId}:plan`)?.plan ?? null,
              earlierPlan:
                snapshot.messages.findLast(
                  (message) => message.itemType === CONVERSATION_PLAN_ITEM_TYPE && message.turnId !== turnId,
                )?.plan ?? null,
              answer: latestAssistant?.text,
            })
          : null);
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
              : terminal === "completed" &&
                  reportedFailure !== undefined &&
                  (delivery.delivery.sender.kind === "routine" || delivery.channelId !== undefined)
                ? this.#hooks.redactMcp(reportedFailure)
                : null;
          yield* this.#mailbox.markTerminal(delivery.delivery.id, terminal, reason).pipe(toTurnOperationFailed);
          this.#mailboxSync.syncDeliveryMessage(snapshot, delivery.delivery.id);
        }
        // A turn can start with the answers of several teammates. `#relayAgentResult` skips each one
        // that wants no answer, so only a teammate that asked for a result gets one.
        if (!continuation && !this.#conversation.isExecutionThread(snapshot.threadId) && terminal === "completed") {
          for (const delivery of deliveries)
            yield* this.#relayAgentResult(agentId, turnId, delivery, deliveries, latestAssistant?.text);
        }
        // A failed turn sends no result, so the agent that asked gets the failure as its answer.
        if (!continuation && terminal === "failed") {
          for (const { delivery } of deliveries) yield* this.#answerFailedRequest(agentId, delivery.id);
        }
        // The requester holds the answers of the other teammates until each request has ended, so
        // this end can release them, and the failure note above.
        for (const { delivery } of deliveries) {
          if (delivery.sender.kind === "agent") this.#hooks.scheduleDrain(delivery.sender.agentId);
        }
      }
      if (latestAssistant && !markerAnswer && !this.#conversation.isExecutionThread(snapshot.threadId)) {
        yield* this.#store.updatePreview(agentId, latestAssistant.text).pipe(toTurnOperationFailed);
        this.#hooks.emit({ type: "agents-changed", agents: this.#hooks.listAgents() });
      }
      if (outcome === "completed" && latestAssistant && !quiet && !markerAnswer) {
        const paths = answerFilePaths(latestAssistant.text);
        if (paths.length > 0) yield* this.#hooks.attachAnswerFiles(agentId, snapshot, latestAssistant, paths);
      }
      if (trace) this.#attachTrace(snapshot.messages, agentId, turnId, trace);
      const memoryLine = memoryChangesMessage(turnId, memoryChanges, (text) => this.#hooks.redactMcp(text));
      if (memoryLine) snapshot.messages.push(memoryLine);
      if (instructionsChange) snapshot.messages.push(instructionsChangeMessage(turnId, instructionsChange));
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
          text:
            continuation.kind === "compaction"
              ? sourceText("status.agent.compactionContinues")
              : sourceText(
                  continuation.kind === "plan" ? "status.agent.planContinues" : "status.agent.nextStepContinues",
                  {
                    current: continuation.current,
                    limit: continuation.limit,
                  },
                ),
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
        threadId: publicThreadId,
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
      // Nor a compaction that it reserved and did not ask for: its hold has no deadline (#4960).
      completion.pipe(
        Effect.onError((cause) =>
          Effect.andThen(
            Effect.sync(() => this.#compaction.dropReservation(agentId, threadId, turnId)),
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : this.settleOrphanedTurn(agentId, threadId, turnId, status === "failed" ? "failed" : "interrupted"),
          ),
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
    const running = this.#runningTurns.get(turnId);
    const runningThreadId = running?.threadId ?? threadId;
    if (running) this.#keepTurnTiming(turnId, running);
    this.#runningTurns.delete(turnId);
    this.#reportedFailures.delete(turnId);
    this.#quietEmptyAnswers.delete(turnId);
    this.#markEnded(turnId);
    this.#instructions.dropTurn(agentId, turnId);
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
        if (message.subagents && this.#trackSubagents(agentId, turnId, message.subagents))
          this.#hooks.emitRuntimeSnapshot();
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
    // With no continuation, the next attempt runs with this turn ID and writes its text into this
    // attempt's empty rows, which keep this attempt's time. The answer then shows above the messages
    // that waited in the queue (#6504). The write deletes the stored rows, as `#clearPlan` does.
    if (!resumeAfterUsageLimit)
      for (let index = snapshot.messages.length - 1; index >= 0; index -= 1)
        if (isEmptyAttemptText(snapshot.messages[index], turnId)) snapshot.messages.splice(index, 1);
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
    laneId: string | null,
    turnId: string,
    snapshot: ConversationSnapshot,
  ) {
    const deliveries = yield* turnStep(() => this.#mailbox.startingDeliveriesForAgent(agentId, laneId));
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

  /** Sends the agent that asked the note that its request failed. A failed note does not stop the turn's end. */
  #answerFailedRequest(agentId: string, deliveryId: string): Effect.Effect<void> {
    return this.#mailbox
      .answerFailedRequest(
        deliveryId,
        (taskId) => this.#hooks.taskOpen(taskId),
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

  readonly #relayAgentResult = Effect.fn("TurnLifecycle.relayAgentResult")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    delivery: DeliveryContext,
    turnDeliveries: readonly DeliveryContext[],
    text: string | undefined,
  ) {
    if (delivery.delivery.sender.kind !== "agent") return;
    const messageId = delivery.delivery.messageId;
    const originAgentId = this.#mailbox.chainOriginAgentId(messageId);
    const recipientAgentId = delivery.delivery.sender.agentId;
    // The user deleted the agent that asked. A result for it would make the agent again (#6106).
    if (!this.#store.list().some((agent) => agent.id === recipientAgentId)) return;
    // The requests of this sender that the turn read. A reply to one of them answers only that one.
    const requestIds = new Set(
      turnDeliveries
        .filter(
          ({ delivery: other }) =>
            other.sender.kind === "agent" &&
            other.sender.agentId === recipientAgentId &&
            this.#mailbox.expectsReply(other.messageId),
        )
        .map(({ delivery: other }) => other.messageId),
    );
    if (
      !originAgentId ||
      originAgentId === agentId ||
      // The sender said it wants no answer, so the turn's result stays with this agent. Without
      // this the sender is woken for an echo of work it only wanted to know about.
      !this.#mailbox.expectsReply(messageId) ||
      this.#mailbox.hasReplyFrom(agentId, messageId) ||
      this.#mailbox.hasAgentMessageFromTurnTo(agentId, turnId, recipientAgentId, requestIds) ||
      // A turn with no answer that passed work on to a teammate waits for that answer: its result comes later.
      (text === undefined && this.#mailbox.hasRequestFromTurn(agentId, turnId))
    )
      return;

    // A result for a request from a side thread runs in that thread, as an answer with send_message does.
    const answerTaskId = this.#mailbox.answerTaskId(agentId, messageId, [recipientAgentId]);
    const taskId = answerTaskId && this.#hooks.taskOpen(answerTaskId) ? answerTaskId : undefined;
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId },
        recipientAgentIds: [recipientAgentId],
        // A turn that ended with no answer still answers, so the agent that asked does not wait for a
        // result that never comes (#6044).
        text: text ?? NO_RESULT_NOTE,
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

  /** The agent and provider session that own the usage of a provider thread. */
  #usageSession(agentId: string, threadId: string, source: AgentClient) {
    const agent = this.#store.list().find((entry) => entry.id === agentId);
    if (!agent) return undefined;
    // A task or other side thread keeps its provider sessions under its own thread, not the agent's.
    // A routine run's own session is not saved, so its usage has its own session id.
    const session =
      this.#store.database
        .listProviderSessions(this.#conversation.publicThreadId(agentId, threadId))
        .find((entry) => entry.externalSessionId === threadId && entry.provider === source.provider) ??
      (this.#conversation.isRoutineSession(threadId)
        ? { id: `routine:${threadId}`, provider: source.provider, createdAt: new Date().toISOString() }
        : undefined);
    return session ? { agent, session } : undefined;
  }

  /** Saves the skills that a finished tool step loaded, with the estimated tokens of each skill file. */
  readonly #recordSkillLoads = Effect.fn("TurnLifecycle.recordSkillLoads")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    itemId: string,
    cwd: string | null,
    loads: readonly SkillLoad[],
    source: AgentClient,
  ) {
    const found = this.#usageSession(agentId, threadId, source);
    if (!found) return;
    const sizes: (number | null)[] = [];
    for (const load of loads)
      sizes.push(
        yield* skillLoadTokens(load, {
          cwd,
          workspace: found.agent.workspacePath ?? null,
          provider: found.session.provider,
        }),
      );
    // The file reads wait, so the agent can be gone now. Find it again and save all loads at once.
    const owner = this.#usageSession(agentId, threadId, source);
    if (!owner) return;
    const { agent, session } = owner;
    const usage = this.#store.database.usage;
    const model = usage.turnModel(agent.id, session.id, turnId) ?? agent.model;
    const occurredAt = new Date().toISOString();
    try {
      for (const [index, load] of loads.entries())
        usage.recordSkillLoad({
          agentId: agent.id,
          sessionId: session.id,
          turnId,
          itemId,
          provider: session.provider,
          model,
          skill: load.skill,
          tokens: sizes[index] ?? null,
          occurredAt,
        });
    } catch {
      this.#hooks.emitError("usage_collection_failed", new Error("Usage data could not be saved."), agentId);
    }
  });

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
    const openTools = this.#runningTurns.get(turnId)?.openTools;
    let lastToolClosed = false;
    if (openTools && isToolItem(item) && isString(item.id)) {
      if (completed) lastToolClosed = openTools.delete(item.id) && openTools.size === 0;
      else openTools.add(item.id);
    }
    // MCP credentials and the shared secret patterns come out before the text leaves the agent service.
    const failure = completed ? toolFailureText(item, (text) => this.#hooks.redactMcp(text)) : null;
    this.#observeTraceStep(turnId, item, completed, toolProgress, failure);
    if (toolProgress) {
      const activity = toolActivity(item, completed);
      this.#emitTurnProgress(
        agentId,
        this.#conversation.publicThreadId(agentId, threadId),
        turnId,
        toolProgress,
        activity,
        failure,
      );
      return;
    }
    // A tool whose end adds no line, such as a memory search, still ends its step. Without this the
    // client keeps `running` and the face of that step until the next line.
    if (lastToolClosed) {
      this.#emitTurnProgress(
        agentId,
        this.#conversation.publicThreadId(agentId, threadId),
        turnId,
        sourceText("status.agent.toolResultReviewing"),
        "reviewing",
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
    if (previous && subagentStates(previous) === subagentStates(subagents)) {
      this.#conversation.emitReplacedMessage(snapshot, id, "turn.subagents-updated");
      return;
    }
    this.#conversation.emitConversation(snapshot);
    if (this.#trackSubagents(agentId, turnId, subagents)) this.#hooks.emitRuntimeSnapshot();
    const publicThreadId = snapshot.threadId;
    if (!publicThreadId) return;
    const failedBefore = new Set(previous?.filter((subagent) => subagent.status === "failed").map(({ id }) => id));
    for (const subagent of subagents)
      if (subagent.status === "failed" && !failedBefore.has(subagent.id))
        this.#hooks.emit({
          type: "subagent-failed",
          agentId,
          threadId: publicThreadId,
          turnId,
          subagentId: subagent.id,
          title: subagent.title,
        });
  }

  /**
   * Notes whether a turn's subagents still run, so that their agent shows as at work. Returns true when
   * the turns of the agent changed.
   */
  #trackSubagents(agentId: string, turnId: string, subagents: readonly ConversationSubagent[] | undefined): boolean {
    const running = subagents?.some((subagent) => subagent.status === "running") === true;
    const turns = this.#subagentTurns.get(agentId);
    if (running === (turns?.has(turnId) === true)) return false;
    if (running) this.#subagentTurns.set(agentId, (turns ?? new Set()).add(turnId));
    else if (turns) {
      turns.delete(turnId);
      if (turns.size === 0) this.#subagentTurns.delete(agentId);
    }
    return true;
  }

  /** Codex reports its subagents as tool items of the parent thread. */
  #applyCodexSubagents(agentId: string, threadId: string, turnId: string, item: DynamicRecord): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const current = snapshot.messages.find((candidate) => candidate.id === `${turnId}:subagents`)?.subagents ?? [];
    const subagents = foldCodexSubagentItem(current, item, new Date().toISOString());
    const clamped = subagents && clampConversationSubagents(subagents);
    if (!clamped) return;
    for (const subagent of clamped)
      if (subagent.status === "running") this.#codexChildren.set(subagent.id, { agentId, threadId, turnId });
      else this.#codexChildren.delete(subagent.id);
    this.#applySubagents(agentId, threadId, turnId, clamped);
  }

  /**
   * An item of a Codex subagent's own thread becomes a step of that subagent. Items that came
   * before `spawnAgent` named the thread are not shown. The subagent's work keeps its agent active.
   */
  #applyCodexChildItem(childThreadId: string, item: DynamicRecord | null): void {
    const parent = this.#codexChildren.get(childThreadId);
    if (!parent || !item) return;
    this.#lastEventAt.set(parent.agentId, Date.now());
    const snapshot = this.#conversation.ensureSnapshot(parent.agentId, parent.threadId);
    const current = snapshot.messages.find((candidate) => candidate.id === `${parent.turnId}:subagents`)?.subagents;
    const subagents = current && foldCodexChildItem(current, childThreadId, item);
    const clamped = subagents && clampConversationSubagents(subagents);
    if (clamped) this.#applySubagents(parent.agentId, parent.threadId, parent.turnId, clamped);
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
  #observeTraceStep(
    turnId: string,
    item: ThreadItem,
    completed: boolean,
    toolProgress: string | null,
    failure: string | null,
  ): void {
    if (!isString(item.id)) return;
    if (isToolItem(item)) {
      const failed = completed && toolFailed(item);
      this.#traces.observe(turnId, item.id, "tool", {
        completed,
        failed,
        text: toolProgress,
        error: failure,
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

  #emitTurnProgress(
    agentId: string,
    threadId: string,
    turnId: string,
    text: string,
    activity: AgentStepActivity | null = null,
    error: string | null = null,
  ): void {
    const running = (this.#runningTurns.get(turnId)?.openTools.size ?? 0) > 0;
    this.#hooks.emit({
      type: "turn-progress",
      agentId,
      threadId,
      turnId,
      detail: text,
      ...(running ? { running } : {}),
      ...(activity ? { activity } : {}),
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

/** An answer or thinking row of the turn that holds nothing yet: no text, no file and no image. */
function isEmptyAttemptText(message: ConversationMessage | undefined, turnId: string): boolean {
  return (
    message?.author === "assistant" &&
    message.turnId === turnId &&
    (message.itemType === "agentMessage" || message.itemType === "commentary") &&
    !message.text.trim() &&
    !message.attachments?.length &&
    !message.imageGeneration
  );
}

export class TurnOperationFailed extends Schema.TaggedError<TurnOperationFailed>()("TurnOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: turnStep, rewrap: toTurnOperationFailed } = causeHelpers(TurnOperationFailed);

/** The answer for a teammate request when the turn ended with no answer, in the reply format. */
const NO_RESULT_NOTE = [
  "Status: blocked",
  "Result: OpenBot note, not written by this teammate: the teammate's turn ended with no result and no error. The requested work can be unfinished.",
  "Evidence: none",
  "Unblock: Check what is done, then finish the rest yourself or send the teammate a narrower request.",
].join("\n");

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
