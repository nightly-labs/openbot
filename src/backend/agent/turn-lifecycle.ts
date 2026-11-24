import { type AgentProviderId, agentProviderName, KEY_ONLY_PROVIDERS } from "@openbot/contracts/agent-providers";
import { isNarrationItemId } from "@openbot/contracts/conversation-narration";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
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
  type ConversationTraceStep,
  type ConversationTurnTrace,
  clampConversationSubagents,
  conversationPlanText,
  conversationSubagentsText,
  isAgentAnswer,
  isAgentContextCategories,
  latestTurnAnswer,
  PLAN_CONTINUATION_ITEM_TYPE,
  type QueueDelivery,
  SIGN_IN_FAILURE_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { type CauseCode, classifyFailure, isCauseCode } from "@openbot/telemetry";
import { userErrorMessage } from "@openbot/user-errors";
import { Cause, Deferred, Effect, Exit, Schedule, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { BrowserOperationError } from "../browser-effects";
import type { BrowserDynamicToolHooks } from "../browser-tool-actions";
import { newAssistantMessage, normalizeCompletionStatus } from "../conversation-snapshots";
import { causeHelpers, reportOriginalFailure } from "../effect-boundary";
import {
  AUTO_RESULT_KEY_PREFIX,
  channelLane,
  type DeliveryContext,
  type MailboxStore,
  MESSAGING_LANE,
  type UsageLimitContinuation,
} from "../mailbox-store";
import { perfCount } from "../perf-probe-hooks";
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
import type { AttentionBrowserHost, AttentionRegistry, CodexSubagentParent } from "./attention-registry";
import type { BrowserUploadTarget } from "./browser-uploads";
import { type ContextCompaction, compactsOnRequest } from "./context-compaction";
import type { ConversationRuntime } from "./conversation-runtime";
import { HANDOFF_START } from "./delivery-content";
import type { DeltaBuffer } from "./delta-buffer";
import type { FailureContext, FailureSignal } from "./failure-signal";
import {
  FINISH_CHECK_ABORT_POLL,
  FINISH_CHECK_CONTEXT_MESSAGES,
  FINISH_CHECK_DEADLINE_MS,
  type FinishCheckInput,
  type FinishCheckResult,
  finishCheckGap,
} from "./finish-check";
import { readCapturedSteps } from "./handoff-tool-steps";
import type { ImageGenRuntime } from "./image-gen-runtime";
import { markIncompleteMediaGeneration } from "./image-generation";
import { type InstructionsChanges, instructionsChangeMessage } from "./instructions-changes";
import type { MailboxSync } from "./mailbox-sync";
import { memoryChangesMessage } from "./memory-changes-message";
import { type FinishCheckMode, type PlanContinuation, promisesWork, waitsForUser } from "./plan-continuation";
import { PLAN_UPDATED_METHOD, planFromNotification } from "./plan-updates";
import {
  GEMINI_INVALID_CREDENTIALS,
  isBalanceDiagnostic,
  isCodexAccountSettingsFailure,
  isPlanLimitDiagnostic,
  isUsageLimitDiagnostic,
  providerResetDelayMs,
} from "./provider-diagnostics";
import type { ProviderRuntime } from "./provider-runtime";
import {
  answeredRequestId,
  isNoUpdateAnswer,
  isNoUpdateToolCall,
  quietRunStepsMessage,
  quietTeammateDelivery,
  quietTeammateTurnDelivery,
  settleQuietChannelTurn,
  settleQuietRoutineTurn,
  teammateRequest,
  writesNoAnswer,
} from "./routine-quiet-runs";
import { type SkillLoad, skillLoads, skillLoadTokens } from "./skill-loads";
import {
  endCodexChild,
  foldCodexChildItem,
  foldCodexSubagentItem,
  SUBAGENTS_UPDATED_METHOD,
  stopRunningSubagents,
  subagentsFromNotification,
} from "./subagent-updates";
import { shellReadPaths, shellWorkFolders, ThreadFileHistory } from "./thread-file-history";
import {
  isNonActionableCodexWarning,
  isToolItem,
  openBotTool,
  refusedSessionFailure,
  type ToolUsageSignal,
  toolActivity,
  toolCallName,
  toolFailed,
  toolFailureText,
  toolProgressText,
  toolResultText,
  toolTraceDetail,
  toolUsage,
  toThreadItem,
} from "./thread-items";
import { type ToolOutcome, TurnTraces, traceMessage } from "./turn-traces";
import { collectProviderUsage } from "./usage-collection";
import { USAGE_LIMIT_METHOD, type UsageLimitGate } from "./usage-limit-gate";

const logger = createOpenBotLogger("turn-lifecycle");
const RETRY_NOTICE_ATTEMPTS = 3;
const CAPACITY_CAUSE: CauseCode = "provider_unavailable";
const MODEL_AT_CAPACITY = /\bmodel is at capacity\b/iu;

function modelAtCapacity(error: DynamicRecord | null, details: string | null): boolean {
  return error?.codexErrorInfo === "serverOverloaded" || (details !== null && MODEL_AT_CAPACITY.test(details));
}
const ENDED_TURN_LIMIT = 256;
const SELF_STARTED_ORIGIN_LIMIT = 4096;
const REQUEST_SEARCH_TURN_LIMIT = 64;

function keepNewest(turns: Set<string>, turnId: string): void {
  turns.add(turnId);
  if (turns.size <= ENDED_TURN_LIMIT) return;
  const [oldest] = turns;
  if (oldest !== undefined) turns.delete(oldest);
}
const SESSION_FAILURE_LIMIT = 2;
const QUIET_END_MS = 30_000;
const QUIET_END_MAX_MS = 2 * 60_000;
const QUIET_REPEAT_POLL_MS = 1_000;
const TURN_USAGE_MARGIN_MS = 60 * 60 * 1_000;
const TEXT_RESET_MARGIN_MS = 60_000;
export const FAILOVER_CAUSES: ReadonlySet<CauseCode> = new Set([
  "billing",
  "usage_limit",
  "provider_unavailable",
  "rate_limit",
  "authentication",
  "network",
  "timeout",
  "empty_answer",
  "model_not_found",
  "invalid_request",
]);

const CODEX_SAFETY_BLOCKS: ReadonlySet<string> = new Set(["cyberPolicy", "misalignmentPolicyViolation"]);
const SAFETY_BLOCK_REVERT_TIMEOUT_MS = 10_000;

function carriesHandoff(item: DynamicRecord): boolean {
  return getArray(item, "content").some(
    (part) => isRecord(part) && isString(part.text) && part.text.startsWith(HANDOFF_START),
  );
}

function safetyBlockText(reason: string, dropped: boolean): string {
  const provider = agentProviderName("codex");
  return dropped
    ? sourceText("error.provider.codexSafetyBlocked", { provider, reason })
    : sourceText("error.provider.codexSafetyBlockedKept", { provider, reason });
}

function isRefusedGeminiToken(provider: string | undefined, message: string): boolean {
  return provider === "antigravity" && GEMINI_INVALID_CREDENTIALS.test(message);
}

const CONTINUE_CAUSES: ReadonlySet<CauseCode> = new Set([
  "authentication",
  "provider_unavailable",
  "rate_limit",
  "network",
  "timeout",
]);
const POOL_PASS_OVER_CAUSES: ReadonlySet<CauseCode> = new Set([
  "usage_limit",
  "provider_unavailable",
  "authentication",
  "model_not_found",
]);

const COMPACTION_RETRY_CAUSES: ReadonlySet<CauseCode> = new Set(["network", "timeout"]);

const TEMPORARY_REQUEST_CAUSES: ReadonlySet<CauseCode> = new Set([
  "stalled",
  "timeout",
  "network",
  "provider_unavailable",
  "rate_limit",
  "empty_answer",
]);

interface HeldProviderError {
  message: string;
  context: FailureContext & { causeCode: CauseCode };
  quiet?: boolean;
  link?: string;
  movesToBackup?: true;
}

function accountLink(params: unknown): string | undefined {
  const link = getString(params, "link");
  if (!link || !URL.canParse(link)) return undefined;
  const url = new URL(link);
  return url.protocol === "https:" && url.hostname === "accounts.google.com" ? link : undefined;
}

export interface AgentBrowserHost extends AttentionBrowserHost, BrowserUploadTarget {
  onChanged(listener: (tabs: BrowserTab[], activeTabId: string | null) => void): () => void;
  onControlChanged(listener: (state: BrowserControlState) => void): () => void;
  onDocumentChanged(listener: (tabId: string, documentIds: ReadonlySet<string>) => void): () => void;
  clearControls(): void;
  endControl(threadId: string, turnId: string): void;
  close(tabId: string): Effect.Effect<void, BrowserOperationError>;
  clearAgentSession(agentId: string): Effect.Effect<void, BrowserOperationError>;
  handleDynamicTool(
    params: DynamicToolCallParams,
    hooks?: BrowserDynamicToolHooks,
  ): Effect.Effect<DynamicToolResult, BrowserOperationError>;
  userControlTabFor(params: DynamicToolCallParams): string | null;
  awaitUserControlRelease(tabId: string): Effect.Effect<void>;
  shareTab(tabId: string, target: { agentId: string; threadId: string }): void;
  unshareThread(threadId: string): void;
  agentTab(tabId: string, agentId: string): { title: string; url: string } | null;
  releaseIdleTabs?(runningThreadIds: ReadonlySet<string>): Effect.Effect<void>;
}

export interface TurnHooks {
  emitFailure?(failure: FailureSignal): void;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string, context?: FailureContext, link?: string): void;
  emitRuntimeSnapshot(): void;
  scheduleDrain(agentId: string): void;
  steerAgentMessage(recipientAgentId: string, deliveryId: string): Effect.Effect<void>;
  dropRefusedSession(agentId: string, externalThreadId: string): Effect.Effect<void, TurnOperationFailed>;
  listAgents(): AgentSummary[];
  redactMcp(text: string): string;
  checkFinish?(agentId: string, input: FinishCheckInput): Effect.Effect<FinishCheckResult | null>;
  emitToolUsage(usage: ToolUsageSignal): void;
  turnModel(agentId: string, turnId: string): string | null;
  mayFailOver(agentId: string): boolean;
  backupReadyAt(agentId: string): number | null;
  backupsAtLimit(agentId: string): boolean;
  poolHasOtherAccount(agentId: string): boolean;
  mayContinueOnBackup(agentId: string): boolean;
  requeueChannelDelivery(deliveryId: string, continueWork?: boolean): Effect.Effect<boolean>;
  keepChannelDelivery(deliveryId: string): Effect.Effect<boolean>;
  quietRoutineDelivery(deliveryId: string): boolean;
  taskForThread(threadId: string): string | null;
  inMessagingLane(agentId: string, threadId: string): boolean;
  isRoutineThread(threadId: string): boolean;
  taskOpen(taskId: string): boolean;
  taskBackgroundLost(taskId: string): void;
  taskReporting(taskId: string): boolean;
  taskFailed(taskId: string, message: string): void;
  conversationTurnEnded(
    agentId: string,
    sideThreadId: string | null,
    counts: boolean,
    memoryCommitted: boolean,
  ): Effect.Effect<void>;
  turnStopped(agentId: string, taskId: string | null, turnId: string): boolean;
  hasOpenWait(agentId: string, deliveryIds: readonly string[]): boolean;
  closeRoutineSession(externalThreadId: string, archive?: boolean): Effect.Effect<void>;
  routineAnswered(agentId: string, deliveryId: string, answer: string): Effect.Effect<void>;
  attachAnswerFiles(
    agentId: string,
    snapshot: ConversationSnapshot,
    answer: ConversationSnapshot["messages"][number],
    paths: string[],
  ): Effect.Effect<void>;
}

export interface DeliveryStart {
  pickedAt: number;
  providerStartMs: number | null;
}

export interface TurnTiming {
  queueWaitMs: number | null;
  startMs: number | null;
  providerStartMs: number | null;
  firstOutputMs: number | null;
}

const TURN_TIMING_LIMIT = 64;

const STREAMING_DELTA_METHODS: ReadonlySet<string> = new Set([
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryPartAdded",
  "item/agentMessage/delta",
]);

export function isStreamingDelta(method: string): boolean {
  return STREAMING_DELTA_METHODS.has(method);
}

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
  readonly #traces = new TurnTraces();
  #scope = Scope.makeUnsafe();
  readonly #turnAssociations = new Map<string, Deferred.Deferred<void, TurnOperationFailed>>();
  readonly #turnErrors = new Map<string, string>();
  readonly #turnCauses = new Map<string, CauseCode>();
  readonly #turnRetries = new Map<string, number>();
  readonly #capacityNotices = new Set<string>();
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
      carriedHistory: boolean;
      workedBesidesReaction: boolean;
      compacted: boolean;
      startedBackgroundWork: boolean;
      narration: string | null;
      narrationStepKnown: boolean;
      narrationOpenTools: ReadonlySet<string>;
      openTools: Set<string>;
      failureReports: Set<string>;
      lastEventAt: number;
      unprompted: boolean;
      reports: Map<string, string>;
      continues: readonly string[];
    }
  >();
  readonly #unreadReports = new Map<string, Map<string, string>>();
  readonly #selfStartedOrigins = new Map<string, readonly string[]>();
  readonly #lastResults = new Map<
    string,
    { turnIds: readonly string[]; requests: readonly DeliveryContext[]; interim?: true }
  >();
  readonly #deliveryStarts = new Map<string, DeliveryStart>();
  readonly #turnTimings = new Map<string, TurnTiming>();
  readonly #limitedTurns = new Map<string, number | null>();
  readonly #failoverTurns = new Map<string, HeldProviderError>();
  readonly #compactionFailures = new Map<string, HeldProviderError & { stalled?: true; loop?: true; exited?: true }>();
  readonly #compactionDeadlines = new Map<string, NodeJS.Timeout>();
  readonly #failoverRetries = new Map<string, Set<string>>();
  readonly #refusedRetries = new Set<string>();
  readonly #safetyBlockedTurns = new Set<string>();
  readonly #sessionFailures = new Map<string, number>();
  readonly #noUpdateTurns = new Set<string>();
  readonly #taskStartTurns = new Set<string>();
  readonly #noUpdateSteps = new Map<string, Set<string>>();
  readonly #quietTurns = new Set<string>();
  readonly #followUpTurns = new Set<string>();
  readonly #quietChannelTurns = new Set<string>();
  readonly #quietEmptyAnswers = new Set<string>();
  readonly #quietEndTimers = new Map<string, NodeJS.Timeout>();
  readonly #quietStops = new Set<string>();
  readonly #quietRepeats = new Set<string>();
  readonly #reportedFailures = new Map<string, string>();
  readonly #endedTurns = new Set<string>();
  readonly #channelResultNotes = new Map<string, Set<string>>();
  readonly #completingTurns = new Set<string>();
  readonly #lastEventAt = new Map<string, number>();
  readonly #codexChildren = new Map<string, CodexSubagentParent>();
  readonly #codexChildTurns = new Map<string, { turnId: string; client: AgentClient }>();
  readonly #subagentTurns = new Map<string, Set<string>>();
  readonly #waitingThreads = new Map<string, { agentId: string; client: AgentClient; since: number }>();
  readonly #archivableRoutineSessions = new Set<string>();

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
    this.#mailbox.useTaskRunsInProvider((agentId, taskId) => this.#taskRunsInProvider(agentId, taskId));
  }

  failedTurns(): ReadonlyMap<string, string> {
    return this.#failedTurns;
  }

  subagentTurns(agentIds: ReadonlySet<string>): Array<{ agentId: string; turnId: string }> {
    const turns: Array<{ agentId: string; turnId: string }> = [];
    for (const [agentId, turnIds] of this.#subagentTurns) {
      const turnId = [...turnIds].at(-1);
      if (turnId && agentIds.has(agentId)) turns.push({ agentId, turnId });
    }
    return turns;
  }

  backgroundWork(agentIds: ReadonlySet<string>): Array<{ agentId: string; taskId: string | null; since: number }> {
    const work: Array<{ agentId: string; taskId: string | null; since: number }> = [];
    for (const [threadId, { agentId, since }] of this.#waitingThreads) {
      if (!agentIds.has(agentId)) continue;
      const taskId = this.#taskForThread(agentId, threadId);
      const ownChat =
        !this.#conversation.isRoutineSession(threadId) &&
        this.#conversation.publicThreadId(agentId, threadId) === this.#store.get(agentId)?.threadId;
      if (taskId !== null || ownChat) work.push({ agentId, taskId, since });
    }
    return work.slice(-INPUT_LIMITS.agents);
  }

  forgetAgent(agentId: string): void {
    this.fileHistory.forgetAgent(agentId);
    this.#failedTurns.delete(agentId);
    this.#subagentTurns.delete(agentId);
    for (const [threadId, work] of this.#waitingThreads)
      if (work.agentId === agentId) this.#waitingThreads.delete(threadId);
    this.#lastEventAt.delete(agentId);
    for (const key of this.#lastResults.keys()) if (key.startsWith(`${agentId}\u0000`)) this.#lastResults.delete(key);
    for (const [childId, parent] of this.#codexChildren)
      if (parent.agentId === agentId) this.#codexChildren.delete(childId);
  }

  deliveriesStarting(deliveryIds: readonly string[], start: DeliveryStart): void {
    for (const id of deliveryIds) keepBounded(this.#deliveryStarts, id, start);
  }

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

  turnStartedAt(turnId: string): number | null {
    return this.#runningTurns.get(turnId)?.startedAt ?? null;
  }

  startedTask(turnId: string): void {
    if (this.#runningTurns.has(turnId)) this.#taskStartTurns.add(turnId);
  }

  earliestRunningTurnStartedAt(): number | null {
    let earliest: number | null = null;
    for (const turn of this.#runningTurns.values()) earliest = Math.min(earliest ?? turn.startedAt, turn.startedAt);
    return earliest;
  }

  lastEventAt(agentId: string): number | null {
    return this.#lastEventAt.get(agentId) ?? null;
  }

  trackItem(itemId: string, turnId: string): void {
    this.#itemTurns.set(itemId, turnId);
  }

  continuesAfterProviderExit(agentId: string, turnId: string, deliveryIds: readonly string[]): boolean {
    const contexts = deliveryIds.flatMap((id) => this.#mailbox.getDelivery(id) ?? []);
    return (
      contexts.length === deliveryIds.length &&
      this.#planContinues(agentId, null, turnId, contexts, undefined) === "allowed"
    );
  }

  markFailedTurn(agentId: string, turnId: string): void {
    this.#failedTurns.set(agentId, turnId);
    this.#hooks.emitRuntimeSnapshot();
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
    this.#turnCauses.clear();
    this.#turnRetries.clear();
    this.#capacityNotices.clear();
    this.#limitedTurns.clear();
    this.#unreadReports.clear();
    this.#selfStartedOrigins.clear();
    this.#lastResults.clear();
    this.#quietTurns.clear();
    this.#followUpTurns.clear();
    this.#failoverTurns.clear();
    this.#failoverRetries.clear();
    this.#runningTurns.clear();
    this.#noUpdateTurns.clear();
    this.#taskStartTurns.clear();
    this.#quietChannelTurns.clear();
    this.#quietEmptyAnswers.clear();
    for (const timer of this.#quietEndTimers.values()) clearTimeout(timer);
    this.#quietEndTimers.clear();
    this.#quietStops.clear();
    this.#quietRepeats.clear();
    this.#reportedFailures.clear();
    this.#endedTurns.clear();
    this.#channelResultNotes.clear();
    this.#refusedRetries.clear();
    this.#safetyBlockedTurns.clear();
    this.#sessionFailures.clear();
    this.#lastEventAt.clear();
    this.#codexChildren.clear();
    this.#codexChildTurns.clear();
    this.#waitingThreads.clear();
    this.#itemTurns.clear();
    this.#traces.clear();
    this.#noUpdateSteps.clear();
    this.#observedCompactions.clear();
    this.#compactionFailures.clear();
    for (const timer of this.#compactionDeadlines.values()) clearTimeout(timer);
    this.#compactionDeadlines.clear();
  }).bind(this);

  readonly interruptTurnsOf = Effect.fn("TurnLifecycle.interruptTurnsOf")(function* (
    this: TurnLifecycle,
    client: AgentClient,
    options: { keepRecoverable?: boolean } = {},
  ) {
    const endedChildren: string[] = [];
    for (const [threadId, live] of this.#codexChildTurns)
      if (live.client === client) {
        this.#codexChildTurns.delete(threadId);
        endedChildren.push(threadId);
      }
    const lostThreads = [...this.#waitingThreads].filter(([, work]) => work.client === client);
    for (const [threadId, work] of lostThreads) this.#loseBackgroundWork(threadId, work.agentId);
    if (lostThreads.length > 0) this.#hooks.emitRuntimeSnapshot();
    for (const [turnId, turn] of this.#runningTurns) {
      if (turn.client !== client) continue;
      this.#runningTurns.delete(turnId);
      this.#turnRetries.delete(turnId);
      this.#capacityNotices.delete(turnId);
      const compactionFailure = this.#compactionFailures.get(turnId);
      this.#compactionFailures.delete(turnId);
      const quietStop = this.#quietStops.has(turnId) && !this.#turnErrors.has(turnId);
      this.#clearQuietEnd(turnId);
      if (
        options.keepRecoverable &&
        !this.#conversation.isRoutineSession(turn.threadId) &&
        this.#mailbox
          .findDeliveriesByTurn(turn.agentId, turnId)
          .some(({ delivery }) => delivery.status === "starting" || delivery.status === "running")
      ) {
        this.#traces.drop(turnId);
        this.#noUpdateSteps.delete(turnId);
        this.#instructions.dropTurn(turn.agentId, turnId);
        this.#browser.endControl(this.#conversation.publicThreadId(turn.agentId, turn.threadId), turnId);
        const failover = this.#failoverTurns.get(turnId);
        this.#failoverTurns.delete(turnId);
        if (failover) this.#showFailoverError(turn.agentId, turn.threadId, failover);
        else if (compactionFailure) this.#showFailoverError(turn.agentId, turn.threadId, compactionFailure);
        this.#showKeptSafetyBlock(turn.agentId, turnId);
        continue;
      }
      this.#attention.clearForTurn(turn.threadId, turnId, false);
      if (this.#observedCompactions.get(turn.threadId) === turnId) {
        this.#observedCompactions.delete(turn.threadId);
        this.#clearCompactionDeadline(turn.threadId);
      }
      this.#compaction.abandonCompaction(turn.threadId);
      this.#keepTurnTiming(turnId, turn);
      yield* this.#completeTurn(turn.agentId, turn.threadId, turnId, quietStop ? "completed" : "interrupted").pipe(
        Effect.catchCause((cause) =>
          reportOriginalFailure(cause, (failure) =>
            this.#hooks.emitError("turn_completion_failed", failure, turn.agentId),
          ),
        ),
      );
    }
    for (const threadId of endedChildren) this.#endCodexChild(threadId, "interrupted");
  }).bind(this);

  hasEnded(turnId: string): boolean {
    return this.#endedTurns.has(turnId);
  }

  forgetEnded(turnId: string): void {
    this.#endedTurns.delete(turnId);
  }

  isCompleting(turnId: string): boolean {
    return this.#completingTurns.has(turnId);
  }

  #taskForThread(agentId: string, externalThreadId: string): string | null {
    const threadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    return this.#conversation.isTaskThread(threadId) ? this.#hooks.taskForThread(threadId) : null;
  }

  #teammateWorksInBackground(agentId: string, taskId: string | null): boolean {
    return [...this.#waitingThreads].some(([threadId, work]) => {
      const last = this.#lastResults.get(
        `${work.agentId}\u0000${this.#conversation.publicThreadId(work.agentId, threadId)}`,
      );
      return (
        last?.interim === true &&
        last.requests.some(
          ({ delivery, senderTaskId }) =>
            delivery.sender.kind === "agent" &&
            delivery.sender.agentId === agentId &&
            (senderTaskId ?? null) === taskId,
        )
      );
    });
  }

  #loseBackgroundWork(threadId: string, agentId: string): void {
    this.#waitingThreads.delete(threadId);
    const taskId = this.#taskForThread(agentId, threadId);
    if (taskId !== null && this.#hooks.taskOpen(taskId)) this.#hooks.taskBackgroundLost(taskId);
  }

  #taskRunsInProvider(agentId: string, taskId: string): boolean {
    if (!this.#hooks.taskOpen(taskId)) return false;
    if (this.#hooks.taskReporting(taskId)) return true;
    const threadIds = [
      ...[...this.#waitingThreads].flatMap(([threadId, work]) => (work.agentId === agentId ? [threadId] : [])),
      ...[...this.#runningTurns.values()].flatMap((turn) => (turn.agentId === agentId ? [turn.threadId] : [])),
    ];
    return threadIds.some((threadId) => this.#taskForThread(agentId, threadId) === taskId);
  }

  #laneForThread(agentId: string, externalThreadId: string): string | null {
    const taskId = this.#taskForThread(agentId, externalThreadId);
    if (taskId !== null) return taskId;
    const threadId = this.#conversation.publicThreadId(agentId, externalThreadId);
    const channelId = this.#conversation.channelForThread(threadId);
    if (channelId !== null) return channelLane(channelId);
    return this.#hooks.inMessagingLane(agentId, threadId) ? MESSAGING_LANE : null;
  }

  #planContinues(
    agentId: string,
    taskId: string | null,
    turnId: string,
    deliveries: readonly DeliveryContext[],
    answer: string | undefined,
  ): FinishCheckMode {
    if (deliveries.length === 0 || this.#planContinuation.limit <= 0) return "no";
    if (
      !deliveries.every(
        ({ delivery, channelId }) =>
          channelId === undefined &&
          (delivery.sender.kind === "user" ||
            (delivery.sender.kind === "agent" &&
              (delivery.sender.agentId === agentId || this.#mailbox.answersRequestOf(agentId, delivery.messageId)))),
      )
    )
      return "no";
    if (!this.#mayContinue(agentId, taskId, turnId, deliveries)) return "no";
    return waitsForUser(answer) ? "only" : "allowed";
  }

  #mayContinue(
    agentId: string,
    taskId: string | null,
    turnId: string,
    deliveries: readonly DeliveryContext[],
  ): boolean {
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

  #checkFinish(
    agentId: string,
    taskId: string | null,
    turnId: string,
    snapshot: ConversationSnapshot,
    deliveries: readonly DeliveryContext[],
    steps: readonly ConversationTraceStep[],
    outcomes: ReadonlyMap<string, ToolOutcome>,
    plan: ConversationPlan | null,
    answer: string,
    continuations: number,
    awaitsTeammate: boolean,
  ): Effect.Effect<string | null> {
    const check = this.#hooks.checkFinish;
    if (!check) return Effect.succeed(null);
    const redact = (text: string) => redactText(this.#hooks.redactMcp(text));
    const request = deliveries.map(({ delivery }) => redact(delivery.text)).filter((text) => text.trim().length > 0);
    if (request.length === 0) return Effect.succeed(null);
    const deliveryIds = new Set(deliveries.map(({ delivery }) => delivery.id));
    const requestIndex = snapshot.messages.findIndex(
      (message) => message.delivery !== undefined && deliveryIds.has(message.delivery.id),
    );
    const context = (requestIndex < 0 ? [] : snapshot.messages.slice(0, requestIndex))
      .filter(
        (message) =>
          message.text.trim().length > 0 &&
          (message.author === "user" || (message.author === "assistant" && message.itemType !== "commentary")),
      )
      .slice(-FINISH_CHECK_CONTEXT_MESSAGES)
      .map((message) => ({ author: message.author, text: redact(message.text) }));
    const input: FinishCheckInput = {
      request,
      context,
      steps: steps.map((step) => {
        const outcome = outcomes.get(step.id);
        return {
          ...step,
          ...(step.text === undefined ? {} : { text: redact(step.text) }),
          ...(step.command === undefined ? {} : { command: redact(step.command) }),
          ...(step.error === undefined ? {} : { error: redact(step.error) }),
          ...(outcome?.tool ? { tool: outcome.tool } : {}),
          ...(outcome?.result ? { result: redact(outcome.result) } : {}),
        };
      }),
      plan: plan && { ...plan, steps: plan.steps.map((step) => ({ ...step, text: redact(step.text) })) },
      answer: redact(answer),
      continuations,
      ...(awaitsTeammate ? { awaitsTeammate } : {}),
    };
    const mayContinue = () =>
      this.#planContinuation.waitsForCheck(agentId, taskId) && this.#mayContinue(agentId, taskId, turnId, deliveries);
    const aborted = Effect.sync(() => !mayContinue()).pipe(
      Effect.repeat({ until: (stop) => stop, schedule: Schedule.spaced(FINISH_CHECK_ABORT_POLL) }),
      Effect.as(null),
    );
    return Effect.raceFirst(
      Effect.suspend(() => check(agentId, input)).pipe(
        Effect.timeoutOption(FINISH_CHECK_DEADLINE_MS),
        Effect.map((result) => (result._tag === "None" ? null : result.value)),
      ),
      aborted,
    ).pipe(
      Effect.map((result) => (result === null || !mayContinue() ? null : finishCheckGap(result))),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn("The finish check of a turn failed.", { error: Cause.squash(cause) });
          return null;
        }),
      ),
    );
  }

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
        client,
      );
      Effect.runFork(client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
    }, runMs);
    timer.unref?.();
    this.#compactionDeadlines.set(threadId, timer);
  }

  #stopCompactionLoop(agentId: string, threadId: string, turnId: string, client: AgentClient): void {
    this.#clearCompactionDeadline(threadId);
    if (this.#compactionFailures.get(turnId)?.loop) return;
    logger.warn("A provider compacted again and again; OpenBot stops its turn.", { provider: client.provider });
    this.#holdCompactionFailure(
      turnId,
      {
        causeCode: "context_too_long",
        provider: client.provider,
        model: this.#hooks.turnModel(agentId, turnId),
        turnId,
        severity: "error",
      },
      false,
      client,
      sourceText("error.agent.compactionLoopStopped", { provider: agentProviderName(client.provider) }),
    );
    Effect.runFork(client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
  }

  #clearCompactionDeadline(threadId: string): void {
    const timer = this.#compactionDeadlines.get(threadId);
    if (timer) clearTimeout(timer);
    this.#compactionDeadlines.delete(threadId);
  }

  #holdCompactionFailure(
    turnId: string,
    context: FailureContext & { causeCode: CauseCode },
    stalled: boolean,
    client: AgentClient,
    loopMessage?: string,
  ): void {
    const held = this.#compactionFailures.get(turnId);
    if (held?.loop) return;
    const loop = loopMessage !== undefined;
    const variable = client.modelAddressVariable;
    const message =
      loopMessage ??
      (variable
        ? sourceText("error.agent.compactionConnectionLostAddress", {
            provider: agentProviderName(client.provider),
            variable,
          })
        : sourceText("error.agent.compactionConnectionLost"));
    const stopped = stalled || loop || held?.stalled === true;
    this.#compactionFailures.set(turnId, {
      message,
      context,
      ...(stopped ? { stalled: true as const } : {}),
      ...(loop ? { loop: true as const } : {}),
    });
    this.#turnErrors.set(turnId, message);
    this.#turnCauses.set(turnId, context.causeCode);
  }

  #showFailoverError(agentId: string, threadId: string, failover: HeldProviderError, showQuiet = false): void {
    const taskId = this.#taskForThread(agentId, threadId);
    if (taskId === null && (!failover.quiet || showQuiet)) {
      this.#hooks.emitError("agent_error", failover.message, agentId, failover.context, failover.link);
      return;
    }
    this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
    if (taskId !== null) this.#hooks.taskFailed(taskId, failover.message);
  }

  #showsRefusedCredential(agentId: string, threadId: string, failover: HeldProviderError): boolean {
    return (
      failover.context.causeCode === "authentication" &&
      !failover.quiet &&
      this.#taskForThread(agentId, threadId) === null
    );
  }

  #holdNoAnswer(agentId: string, threadId: string, turnId: string, source: AgentClient): boolean {
    const running = this.#runningTurns.get(turnId);
    if (
      running === undefined ||
      (running.startedBackgroundWork && this.#waitingThreads.has(threadId)) ||
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
      deliveries.some(({ planContinuation }) => planContinuation !== undefined) ||
      deliveries.every(({ delivery }) => this.#quietTeammateTurnDelivery(delivery)) ||
      (this.#noUpdateTurns.has(turnId) && this.#quietRoutineTurn(agentId, threadId, deliveries, true))
    )
      return false;
    const snapshot = this.#conversation.ensureSnapshot(agentId, this.#conversation.publicThreadId(agentId, threadId));
    const { messages } = snapshot;
    if (
      messages.some(
        (message) => message.turnId === turnId && (message.id === `${turnId}:plan` || isAgentAnswer(message)),
      )
    )
      return false;
    if (
      this.#conversation.channelForThread(snapshot.threadId) === null &&
      deliveries.every(({ channelId }) => channelId === undefined) &&
      this.#answerWithNarration(messages, turnId, running.narration)
    ) {
      logger.info("A turn's last narration became its answer.", { agentId, turnId, provider: source.provider });
      return false;
    }
    if (
      this.#hooks.hasOpenWait(
        agentId,
        deliveries.map(({ delivery }) => delivery.id),
      )
    ) {
      logger.info("A turn that keeps a wait open ended with no answer.", {
        agentId,
        turnId,
        provider: source.provider,
      });
      return false;
    }
    if (!NO_ANSWER_CHECKED_PROVIDERS.has(source.provider)) return false;
    if (deliveries.every(({ delivery }) => this.#mailbox.answersHandledRequest(delivery.id))) {
      logger.info("A turn for another teammate result to a handled request ended quietly.", {
        agentId,
        turnId,
        provider: source.provider,
      });
      return false;
    }
    if (deliveries.every(replaysStartedResult)) {
      logger.info("A turn for a teammate result that a restart gave again ended quietly.", {
        agentId,
        turnId,
        provider: source.provider,
      });
      return false;
    }
    if (running.acted) {
      this.#noteNoAnswerAfterSteps(
        agentId,
        threadId,
        turnId,
        source,
        deliveries,
        messages,
        running.workedBesidesReaction,
      );
      return false;
    }
    if (deliveries.every(({ delivery }) => this.#mailbox.isAgentSetupDelivery(delivery.id))) return false;
    const channelTask = this.#channelTask(snapshot.threadId, deliveries);
    const message = sourceText(channelTask ? "error.provider.channelNoAnswer" : "error.provider.acpNoAnswer", {
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
    this.#turnErrors.set(turnId, message);
    this.#turnCauses.set(turnId, context.causeCode);
    this.#failoverTurns.set(turnId, { message, context });
    return true;
  }

  #channelTask(threadId: string | null, deliveries: readonly DeliveryContext[]): boolean {
    return (
      this.#conversation.channelForThread(threadId) !== null ||
      deliveries.some(({ channelId }) => channelId !== undefined)
    );
  }

  #noteNoAnswerAfterSteps(
    agentId: string,
    threadId: string,
    turnId: string,
    source: AgentClient,
    deliveries: readonly DeliveryContext[],
    messages: readonly ConversationMessage[],
    workedBesidesReaction: boolean,
  ): void {
    if (
      this.#conversation.isExecutionThread(this.#conversation.publicThreadId(agentId, threadId)) ||
      !deliveries.every(({ delivery, channelId }) => delivery.sender.kind === "user" && channelId === undefined) ||
      messages.some((message) => message.turnId === turnId && showsOutput(message)) ||
      (!workedBesidesReaction &&
        deliveries.some(
          ({ delivery }) => this.#mailbox.reactionFor(agentId, delivery.id, { kind: "agent", agentId }) !== null,
        ))
    )
      return;
    logger.info("A turn ended with no answer after its steps.", { agentId, turnId, provider: source.provider });
    this.#hooks.emitError(
      "agent_error",
      sourceText("error.provider.noAnswerAfterSteps", {
        provider: agentProviderDescriptor(source.provider).displayName,
      }),
      agentId,
      {
        causeCode: "empty_answer",
        provider: source.provider,
        model: this.#hooks.turnModel(agentId, turnId),
        turnId,
        severity: "warning",
      },
    );
  }

  #answerWithNarration(messages: ConversationMessage[], turnId: string, narrationId: string | null): boolean {
    const narration = messages.find((message) => message.id === narrationId && message.turnId === turnId);
    if (narration?.itemType !== "commentary" || !narration.text.trim()) return false;
    narration.itemType = "final_answer";
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const row = message?.itemType === "final_answer" ? { ...message, itemType: "agentMessage" } : message;
      if (isEmptyAttemptText(row, turnId)) messages.splice(index, 1);
    }
    return true;
  }

  #mayHoldError(agentId: string, turnId: string, causeCode: CauseCode): boolean {
    return (
      this.#hooks.mayFailOver(agentId) ||
      (causeCode === "usage_limit" &&
        this.#carriesWork(agentId, turnId, this.#runningTurns.get(turnId)) &&
        this.#hooks.mayContinueOnBackup(agentId))
    );
  }

  #carriesWork(agentId: string, turnId: string, running: { acted: boolean } | undefined): boolean {
    return (
      running !== undefined &&
      (running.acted ||
        this.#mailbox
          .findDeliveriesByTurn(agentId, turnId)
          .some((context) => context.resumeAfterUsageLimit !== undefined))
    );
  }

  #backgroundWork(
    agentId: string,
    turnId: string,
    snapshot: ConversationSnapshot,
    unread: ReadonlyMap<string, string>,
  ): { deliveries: DeliveryContext[]; continuations: Map<string, UsageLimitContinuation> } | null {
    const reports = new Map<string, string[]>();
    for (const [subagentId, earlier] of unread) {
      const subagent = snapshot.messages
        .find((message) => message.id === `${earlier}:subagents`)
        ?.subagents?.find((candidate) => candidate.id === subagentId);
      if (!subagent) continue;
      const text = subagent.steps.findLast((step) => step.kind === "text")?.text ?? null;
      const report = subagent.status === "completed" ? text : (subagent.error ?? text);
      const line = `Background subagent "${subagent.title}" ${subagent.status}${report ? `: ${report}` : "."}`;
      reports.set(earlier, [...(reports.get(earlier) ?? []), this.#hooks.redactMcp(line)]);
    }
    const deliveries: DeliveryContext[] = [];
    const continuations = new Map<string, UsageLimitContinuation>();
    for (const [earlier, lines] of reports) {
      const { requests, turns } = this.#requestsBehindTurn(agentId, earlier);
      for (const context of requests) {
        if (context.channelId !== undefined || context.delivery.sender.kind === "routine") continue;
        const known = continuations.get(context.delivery.id);
        if (!known) deliveries.push(context);
        continuations.set(context.delivery.id, {
          turnId: known?.turnId ?? earlier,
          previousTurnIds: [
            ...new Set([...(known?.previousTurnIds ?? [context.delivery.turnId ?? earlier]), ...turns, turnId]),
          ],
          workSteps: [known?.workSteps, ...lines].filter(Boolean).join("\n\n").slice(-6000),
        });
      }
    }
    return deliveries.length > 0 ? { deliveries, continuations } : null;
  }

  #requestsBehindTurn(agentId: string, turnId: string): { requests: DeliveryContext[]; turns: string[] } {
    const requests: DeliveryContext[] = [];
    const turns = new Set<string>();
    let pending = [turnId];
    while (pending.length > 0 && turns.size < REQUEST_SEARCH_TURN_LIMIT) {
      const origins: string[] = [];
      for (const candidate of pending) {
        if (turns.has(candidate)) continue;
        turns.add(candidate);
        const found = this.#mailbox.completedDeliveriesOfTurn(agentId, candidate);
        if (found.length > 0) requests.push(...found);
        else origins.push(...(this.#selfStartedOrigins.get(candidate) ?? []));
      }
      pending = origins;
    }
    return { requests, turns: [...turns] };
  }

  #noteSelfStartedOrigins(turnId: string, origins: readonly string[]): void {
    this.#selfStartedOrigins.delete(turnId);
    if (origins.length === 0) return;
    this.#selfStartedOrigins.set(turnId, origins);
    for (const oldest of this.#selfStartedOrigins.keys()) {
      if (this.#selfStartedOrigins.size <= SELF_STARTED_ORIGIN_LIMIT) break;
      this.#selfStartedOrigins.delete(oldest);
    }
  }

  #markFailed(agentId: string, model: string | null, failover: HeldProviderError): void {
    const resetDelayMs = providerResetDelayMs(failover.message);
    const spent = failover.quiet === true && resetDelayMs === null && isBalanceDiagnostic(failover.message);
    const { causeCode, provider } = failover.context;
    const notOffered = causeCode === "model_not_found" && provider === "claude";
    this.#usageLimits.failed(agentId, model, resetDelayMs, spent, causeCode === "authentication", notOffered);
  }

  #noteEvent(params: unknown): { threadId: string | null; agentId: string | undefined } {
    const threadId = getString(params, "threadId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    if (agentId) this.#lastEventAt.set(agentId, Date.now());
    const eventTurn = this.#runningTurns.get(getString(params, "turnId") ?? "");
    if (eventTurn) eventTurn.lastEventAt = Date.now();
    return { threadId, agentId };
  }

  handleStreamingDelta(notification: AppServerNotification): void {
    perfCount("turn.streamingDelta");
    const params = notification.params;
    const { threadId, agentId } = this.#noteEvent(params);
    if (!threadId || !agentId) return;
    const turnId = getString(params, "turnId");
    const itemId = getString(params, "itemId");
    const delta = notification.method === "item/reasoning/summaryPartAdded" ? "\n\n" : getString(params, "delta");
    if (!turnId || !itemId || delta === null || this.#compaction.isCompactionTurn(threadId, turnId)) return;
    this.#itemTurns.set(itemId, turnId);
    const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
    const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
    let message = snapshot.messages.find((candidate) => candidate.id === itemId);
    if (!message) {
      message = newAssistantMessage(itemId, turnId);
      snapshot.messages.push(message);
    }
    this.#markProduced(
      turnId,
      notification.method === "item/agentMessage/delta" && delta.trim() !== "" && message.itemType !== "commentary",
      delta.trim() !== "",
    );
    this.#traces.observe(
      turnId,
      itemId,
      notification.method.startsWith("item/reasoning/") || message.itemType === "commentary" ? "reasoning" : "message",
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
  }

  readonly handleNotification = Effect.fn("TurnLifecycle.handleNotification")(function* (
    this: TurnLifecycle,
    notification: AppServerNotification,
    source: AgentClient,
  ) {
    if (isStreamingDelta(notification.method)) {
      this.handleStreamingDelta(notification);
      return;
    }
    const params = notification.params;
    const { threadId, agentId } = this.#noteEvent(params);

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
        if (threadId && !agentId && source.provider === "codex") {
          const childTurnId = getString(getRecord(params, "turn"), "id");
          if (childTurnId) this.#codexChildTurns.set(threadId, { turnId: childTurnId, client: source });
          return;
        }
        if (!threadId || !agentId) return;
        const turn = getRecord(params, "turn");
        const turnId = getString(turn, "id");
        if (!turnId) return;
        if (this.#compaction.claimTurn(agentId, threadId, turnId)) return;
        this.#compaction.beginTurn(threadId);
        const unprompted = isRecord(params) && params.unprompted === true;
        const laneId = this.#laneForThread(agentId, threadId);
        const starting = unprompted
          ? undefined
          : (
              this.#mailbox.findDeliveriesByTurn(agentId, turnId)[0] ??
              this.#mailbox.startingDeliveryForAgent(agentId, laneId)
            )?.delivery;
        const sentAt = starting ? Date.parse(starting.createdAt) : Number.NaN;
        const start = starting ? (this.#deliveryStarts.get(starting.id) ?? null) : null;
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
          carriedHistory: false,
          workedBesidesReaction: false,
          compacted: false,
          startedBackgroundWork: false,
          narration: null,
          narrationStepKnown: false,
          narrationOpenTools: new Set(),
          openTools: new Set(),
          failureReports: new Set(),
          lastEventAt: Date.now(),
          unprompted,
          reports: new Map(),
          continues:
            unprompted && isRecord(params) && Array.isArray(params.continues) ? params.continues.filter(isString) : [],
        });
        this.#traces.begin(turnId, new Date().toISOString());
        const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
        const reportsKey = `${agentId}\u0000${publicThreadId}`;
        const reports = this.#unreadReports.get(reportsKey);
        this.#unreadReports.delete(reportsKey);
        const started = this.#runningTurns.get(turnId);
        if (started && reports && unprompted) started.reports = reports;
        if (started?.unprompted) this.#noteSelfStartedOrigins(turnId, started.continues);
        const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
        snapshot.activeTurnId = turnId;
        if (laneId === null || laneId === MESSAGING_LANE) this.#failedTurns.delete(agentId);
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
        const workspace = this.#store.get(agentId)?.workspacePath;
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
        this.fileHistory.record(
          agentId,
          this.#conversation.publicThreadId(agentId, threadId),
          [...getArray(params, "filePaths"), ...shellReadPaths(item)],
          [...getArray(params, "folderPaths"), ...shellWorkFolders(item)],
        );
        const itemId = getString(item, "id");
        if (itemId) this.#itemTurns.set(itemId, turnId);
        if (itemId && item.failureReport === true) this.#runningTurns.get(turnId)?.failureReports.add(itemId);
        const running = this.#runningTurns.get(turnId);
        if (running && item.type === "userMessage" && carriesHandoff(item)) running.carriedHistory = true;
        if (item.type !== "userMessage" && (notification.method !== "item/completed" || !isEmptyAnswer(item))) {
          const acted = isRepeatedWork(item);
          this.#markProduced(turnId, acted, acted, acted && isUserReactionCall(item));
        }
        if (
          running?.narration &&
          !running.narrationStepKnown &&
          !(itemId !== null && running.narrationOpenTools.has(itemId))
        ) {
          const step = channelNoteStep(item);
          if (step === "result") this.#keepChannelResultNote(turnId, running.narration);
          if (step !== null) running.narrationStepKnown = true;
        }
        if (running && item.type === "agentMessage" && item.phase === "commentary") {
          if (
            notification.method === "item/completed" &&
            itemId !== null &&
            isNarrationItemId(itemId, source.provider) &&
            isString(item.text) &&
            item.text.trim()
          ) {
            running.narration = itemId;
            running.narrationStepKnown = false;
            running.narrationOpenTools = new Set(running.openTools);
          }
        } else if (running && isRepeatedWork(item) && !keepsNarration(item, notification.method === "item/completed"))
          running.narration = null;
        if (item.type === "contextCompaction") {
          if (running) running.compacted = true;
          if (this.#conversation.openClientFor(threadId) !== source) return;
          if (notification.method === "item/started") this.#observedCompactions.set(threadId, turnId);
          else this.#observedCompactions.delete(threadId);
          if (
            notification.method === "item/started" &&
            source.contextCompaction === "events" &&
            this.#runningTurns.has(turnId) &&
            !this.#compaction.isCompactionTurn(threadId, turnId)
          ) {
            if (this.#compaction.repeatsCompaction(threadId))
              this.#stopCompactionLoop(agentId, threadId, turnId, source);
            else this.#armCompactionDeadline(agentId, threadId, turnId, source);
          } else this.#clearCompactionDeadline(threadId);
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
        if (this.#compaction.isCompactionTurn(threadId, turnId)) return;
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
        if (item.type === "subAgentActivity") this.#applyCodexSubagentActivity(agentId, threadId, turnId, item);
        const threadItem = toThreadItem(item);
        if (!threadItem) return;
        yield* this.#applyItem(agentId, threadId, turnId, threadItem, notification.method === "item/completed");
        return;
      }
      case PLAN_UPDATED_METHOD: {
        if (!threadId || !agentId) return;
        const turnId = getString(params, "turnId");
        const plan = planFromNotification(params);
        if (!turnId || !this.#runningTurns.has(turnId)) return;
        if (plan) this.#applyPlan(agentId, threadId, turnId, plan);
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
        if (threadId && !agentId) {
          const turn = getRecord(params, "turn");
          if (this.#codexChildTurns.get(threadId)?.turnId === getString(turn, "id")) {
            this.#codexChildTurns.delete(threadId);
            this.#endCodexChild(threadId, getString(turn, "status"));
          }
          return;
        }
        if (!threadId || !agentId) return;
        const turn = getRecord(params, "turn");
        const turnId = getString(turn, "id");
        if (!turnId) return;
        const reported = getString(turn, "status") ?? "completed";
        const noAnswer =
          reported === "completed" &&
          turn?.handledCommand !== true &&
          this.#holdNoAnswer(agentId, threadId, turnId, source);
        const status =
          ((reported === "failed" && this.#quietEmptyAnswers.has(turnId)) ||
            (reported === "interrupted" && this.#quietStops.has(turnId))) &&
          !this.#turnErrors.has(turnId)
            ? "completed"
            : (reported === "interrupted" &&
                  (this.#compactionFailures.get(turnId)?.stalled || this.#failoverTurns.get(turnId)?.movesToBackup) &&
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
        this.#attention.clearForTurn(threadId, turnId, status === "completed");
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
        this.#compaction.threadIdle(agentId, threadId, source);
        yield* this.#requeueUnreadSteers(agentId, threadId, turnId, getArray(turn, "unreadSteers").filter(isString));
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
            source.contextCompaction === "native" || source.compactsItself === true,
            compactsOnRequest(source.contextCompaction) ? 0.8 : null,
            usage.estimated === true,
            isAgentContextCategories(usage.categories) ? usage.categories : undefined,
          );
        return;
      }
      case "openbot/turn-continues": {
        const turnId = getString(params, "turnId") ?? "";
        const running = this.#runningTurns.get(turnId);
        if (!running) return;
        const origin = isRecord(params) && isString(params.continues) ? params.continues : null;
        running.continues = origin !== null && running.continues.length > 0 ? [...running.continues, origin] : [];
        if (origin !== null)
          this.#noteSelfStartedOrigins(turnId, [...(this.#selfStartedOrigins.get(turnId) ?? []), origin]);
        return;
      }
      case "openbot/background-work": {
        if (!threadId || !agentId) return;
        const runs = isRecord(params) && params.running === true;
        if (runs)
          for (const turn of this.#runningTurns.values())
            if (turn.threadId === threadId && turn.client === source) turn.startedBackgroundWork = true;
        const waited = this.#waitingThreads.has(threadId);
        if (!runs && isRecord(params) && params.closed === true) this.#loseBackgroundWork(threadId, agentId);
        if (runs === waited) return;
        if (runs) this.#waitingThreads.set(threadId, { agentId, client: source, since: Date.now() });
        else this.#waitingThreads.delete(threadId);
        this.#hooks.emitRuntimeSnapshot();
        return;
      }
      case "openbot/context-compaction": {
        if (!threadId || !agentId || this.#conversation.openClientFor(threadId) !== source) return;
        const status = getString(params, "status");
        if (status !== "running" && status !== "completed" && status !== "failed") return;
        if (source.compactsOnDemand === true && this.#compaction.requested(threadId)) return;
        this.#compaction.observeCompaction(threadId, status, "none");
        return;
      }
      case "openbot/turn-progress": {
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
        const error = getRecord(params, "error");
        const message = getString(params, "message") ?? getString(error, "message") ?? "";
        const reportedCause = isRecord(params) && isCauseCode(params.causeCode) ? params.causeCode : null;
        const causeCode = reportedCause ?? classifyFailure(error ?? message);
        if (notification.method === "warning" && isNonActionableCodexWarning(message)) {
          logger.info("A provider warning needs no action.", {
            provider: source.provider,
            message: this.#hooks.redactMcp(message),
          });
          return;
        }
        if (isRecord(params) && params.willRetry === true) {
          const details = getString(error, "additionalDetails");
          this.#providerRetried(
            agentId,
            threadId,
            getString(params, "turnId"),
            source.provider,
            modelAtCapacity(error, details) ? (details ?? message) : null,
          );
          return;
        }
        const errorTurnId = getString(params, "turnId");
        if (
          notification.method === "error" &&
          causeCode === "empty_answer" &&
          agentId &&
          threadId &&
          errorTurnId &&
          this.#quietAfterNoUpdate(agentId, threadId, errorTurnId)
        ) {
          this.#quietEmptyAnswers.add(errorTurnId);
          logger.info("A quiet turn ended with no answer after its no-update call.", {
            agentId,
            turnId: errorTurnId,
            provider: source.provider,
          });
          return;
        }
        const accountSettingsFailure =
          notification.method === "error" && source.provider === "codex" && isCodexAccountSettingsFailure(message);
        if (accountSettingsFailure)
          logger.warn("Codex could not load the settings of its ChatGPT account.", {
            message: this.#hooks.redactMcp(message),
          });
        const shownMessage = accountSettingsFailure
          ? sourceText("error.provider.codexAccountSettingsUnreadable")
          : message;
        if (notification.method === "error" && errorTurnId && this.#runningTurns.has(errorTurnId)) {
          this.#turnErrors.set(errorTurnId, shownMessage);
          this.#turnCauses.set(errorTurnId, causeCode);
          if (refusedSessionFailure(source.provider, message) !== null) return;
          const errorInfo = error?.codexErrorInfo;
          if (source.provider === "codex" && typeof errorInfo === "string" && CODEX_SAFETY_BLOCKS.has(errorInfo)) {
            this.#safetyBlockedTurns.add(errorTurnId);
            return;
          }
        }
        if (
          notification.method === "error" &&
          causeCode === "rate_limit" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          !this.#limitedTurns.has(errorTurnId)
        ) {
          const backupReadyAt = this.#hooks.backupReadyAt(agentId);
          if (backupReadyAt !== null) this.#limitedTurns.set(errorTurnId, backupReadyAt);
        }
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
          const planLimit =
            isPlanLimitDiagnostic(message) ||
            (error?.codexErrorInfo === "usageLimitExceeded" && !isBalanceDiagnostic(message));
          if (planLimit && notification.method === "error" && errorTurnId && this.#runningTurns.has(errorTurnId)) {
            const resetDelayMs = agentProviderDescriptor(source.provider).reportsUsage
              ? null
              : providerResetDelayMs(message);
            const namedReset =
              resetDelayMs === null ? null : Math.ceil((Date.now() + resetDelayMs + TEXT_RESET_MARGIN_MS) / 1_000);
            this.#limitedTurns.set(errorTurnId, this.#limitedTurns.get(errorTurnId) ?? namedReset);
          }
          const context = {
            turnId: errorTurnId,
            provider: source.provider,
            model: agentId && errorTurnId ? this.#hooks.turnModel(agentId, errorTurnId) : null,
            causeCode,
            severity: notification.method === "warning" ? ("warning" as const) : ("error" as const),
          };
          yield* this.#providers.refreshUsageAfterLimit(source);
          if (
            notification.method === "error" &&
            agentId &&
            errorTurnId !== null &&
            this.#runningTurns.has(errorTurnId) &&
            !this.#limitedTurns.has(errorTurnId) &&
            this.#mayHoldError(agentId, errorTurnId, causeCode)
          ) {
            const link = accountLink(params);
            this.#failoverTurns.set(errorTurnId, { message, context, quiet: true, ...(link ? { link } : {}) });
            return;
          }
          const held = planLimit || (errorTurnId !== null && this.#limitedTurns.has(errorTurnId));
          const taskId =
            !held && notification.method === "error" && agentId && threadId
              ? this.#taskForThread(agentId, threadId)
              : null;
          if (
            taskId === null &&
            !held &&
            notification.method === "error" &&
            agentId &&
            errorTurnId !== null &&
            this.#runningTurns.has(errorTurnId)
          ) {
            this.#hooks.emitError("agent_error", message, agentId, context, accountLink(params));
            return;
          }
          this.#hooks.emitFailure?.({ code: "agent_error", ...(agentId !== undefined ? { agentId } : {}), ...context });
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
        if (
          notification.method === "error" &&
          agentId &&
          threadId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          this.#observedCompactions.get(threadId) === errorTurnId &&
          COMPACTION_RETRY_CAUSES.has(context.causeCode) &&
          !(this.#runningTurns.get(errorTurnId)?.acted === false && this.#hooks.mayFailOver(agentId))
        ) {
          logger.warn("A provider compaction failed.", {
            provider: source.provider,
            causeCode: context.causeCode,
            message: this.#hooks.redactMcp(message),
          });
          this.#holdCompactionFailure(errorTurnId, context, false, source);
          return;
        }
        if (
          notification.method === "error" &&
          source.provider === "claude" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          context.causeCode === "provider_exited"
        ) {
          const held = this.#compactionFailures.get(errorTurnId);
          const reason = held?.message ?? sourceText("error.agent.answerCutOff");
          if (!held) this.#compactionFailures.set(errorTurnId, { message: reason, context, exited: true });
          this.#turnErrors.set(errorTurnId, reason);
          return;
        }
        if (
          notification.method === "error" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          POOL_PASS_OVER_CAUSES.has(context.causeCode) &&
          !isRefusedGeminiToken(source.provider, message) &&
          this.#hooks.poolHasOtherAccount(agentId)
        )
          this.#markFailed(agentId, context.model, { message, context });
        if (
          notification.method === "error" &&
          agentId &&
          errorTurnId !== null &&
          this.#runningTurns.has(errorTurnId) &&
          FAILOVER_CAUSES.has(context.causeCode) &&
          ((context.causeCode === "empty_answer" &&
            !(threadId && this.#compaction.isCompactionTurn(threadId, errorTurnId))) ||
            isRefusedGeminiToken(source.provider, message) ||
            this.#mayHoldError(agentId, errorTurnId, context.causeCode))
        ) {
          this.#failoverTurns.set(errorTurnId, { message: shownMessage, context, ...(link ? { link } : {}) });
          return;
        }
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
        const backupsAtLimit =
          notification.method === "error" &&
          context.causeCode === "usage_limit" &&
          agentId !== undefined &&
          this.#hooks.backupsAtLimit(agentId);
        if (backupsAtLimit)
          logger.warn("A usage limit stopped an agent, and no backup model can take over.", {
            agentId,
            provider: source.provider,
            model: context.model,
            message: this.#hooks.redactMcp(message),
          });
        const shown = backupsAtLimit ? sourceText("error.agent.backupModelsAtLimit") : shownMessage;
        if (taskId !== null) {
          this.#hooks.emitFailure?.({ code: "agent_error", ...(agentId ? { agentId } : {}), ...context });
          this.#hooks.taskFailed(taskId, shown);
        } else this.#hooks.emitError(`agent_${notification.method}`, shown, agentId, context, link);
      }
    }
  }).bind(this);

  #providerRetried(
    agentId: string | null | undefined,
    threadId: string | null | undefined,
    turnId: string | null,
    provider: AgentClient["provider"],
    capacityMessage: string | null,
  ): void {
    if (!agentId || !threadId || !turnId || !this.#runningTurns.has(turnId)) return;
    const atCapacity = capacityMessage !== null;
    const attempts = (this.#turnRetries.get(turnId) ?? 0) + 1;
    this.#turnRetries.set(turnId, attempts);
    logger.info("A provider retries a request.", {
      provider,
      attempts,
      atCapacity,
      usedPercent: this.#compaction.usedPercent(threadId),
    });
    if (atCapacity) {
      if (this.#capacityNotices.has(turnId)) return;
      this.#capacityNotices.add(turnId);
      if (this.#movesToBackupAtCapacity(agentId, threadId, turnId, provider, capacityMessage)) return;
    } else if (attempts !== RETRY_NOTICE_ATTEMPTS) return;
    const compacts = !atCapacity && this.#compaction.retrying(threadId);
    const percent = this.#compaction.usedPercent(threadId);
    this.#hooks.emitError(
      "agent_warning",
      atCapacity
        ? sourceText("error.backend.providerModelAtCapacity")
        : compacts && percent !== null
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
        ...(atCapacity ? { causeCode: CAPACITY_CAUSE } : {}),
      },
    );
  }

  #movesToBackupAtCapacity(
    agentId: string,
    threadId: string,
    turnId: string,
    provider: AgentClient["provider"],
    message: string,
  ): boolean {
    const running = this.#runningTurns.get(turnId);
    const model = this.#hooks.turnModel(agentId, turnId);
    const failedKey = this.#usageLimits.failureKey(agentId, model);
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (
      running === undefined ||
      failedKey === null ||
      deliveries.length === 0 ||
      this.#limitedTurns.has(turnId) ||
      this.#failoverTurns.has(turnId) ||
      this.#observedCompactions.get(threadId) === turnId ||
      this.#compaction.isCompactionTurn(threadId, turnId) ||
      this.#channelTask(this.#conversation.publicThreadId(agentId, threadId), deliveries) ||
      deliveries.some(({ delivery }) => this.#failoverRetries.get(delivery.id)?.has(failedKey)) ||
      this.#hooks.turnStopped(agentId, this.#taskForThread(agentId, threadId), turnId) ||
      !this.#hooks.mayFailOver(agentId)
    )
      return false;
    logger.info("A model is at capacity, so OpenBot moves the turn to a backup model.", { provider, model });
    this.#turnErrors.set(turnId, message);
    this.#turnCauses.set(turnId, CAPACITY_CAUSE);
    this.#failoverTurns.set(turnId, {
      message,
      context: { causeCode: CAPACITY_CAUSE, provider, model, turnId, severity: "error" },
      movesToBackup: true,
    });
    Effect.runFork(
      running.client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore),
    );
    return true;
  }

  requestNoUpdate(
    agentId: string,
    threadId: string,
    turnId: string,
    channelRun = false,
  ): "quiet" | "shown" | "unanswered" | null {
    if (channelRun) {
      this.#quietChannelTurns.add(turnId);
      if (this.#reportedFailures.has(turnId)) return "shown";
      this.#armQuietEnd(agentId, turnId);
      return "quiet";
    }
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    const running = this.#runningTurns.get(turnId);
    if (this.#continuesQuietTurns(running?.continues, deliveries)) {
      this.#noUpdateTurns.add(turnId);
      if (this.#reportedFailures.has(turnId)) return "shown";
      this.#armQuietEnd(agentId, turnId);
      return "quiet";
    }
    if (deliveries.length === 0 && running?.unprompted && running.continues.length > 0) return "shown";
    if (
      !deliveries.some(
        ({ delivery }) =>
          delivery.sender.kind === "routine" ||
          quietTeammateDelivery(delivery) ||
          teammateRequest(delivery) ||
          this.#continuesQuietRun(delivery),
      )
    )
      return null;
    this.#noUpdateTurns.add(turnId);
    if (this.#reportedFailures.has(turnId)) return "shown";
    if (this.#quietRoutineTurn(agentId, threadId, deliveries, true)) {
      this.#armQuietEnd(agentId, turnId);
      return "quiet";
    }
    return this.#quietRoutineTurn(agentId, threadId, deliveries, true, () => true) ? "unanswered" : "shown";
  }

  #quietAfterNoUpdate(agentId: string, threadId: string, turnId: string): boolean {
    const running = this.#runningTurns.get(turnId);
    if (!running || this.#reportedFailures.has(turnId)) return false;
    if (this.#quietChannelTurns.has(turnId)) return true;
    if (!this.#noUpdateTurns.has(turnId)) return false;
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    return (
      this.#continuesQuietTurns(running.continues, deliveries) ||
      this.#quietRoutineTurn(agentId, threadId, deliveries, true)
    );
  }

  #continuesQuietTurns(continues: readonly string[] | undefined, deliveries: readonly DeliveryContext[]): boolean {
    return (
      deliveries.length === 0 &&
      continues !== undefined &&
      continues.length > 0 &&
      continues.every((turnId) => this.#quietTurns.has(turnId) || this.#followUpTurns.has(turnId))
    );
  }

  #armQuietEnd(agentId: string, turnId: string): void {
    const armed = this.#quietEndTimers.get(turnId);
    if (armed) {
      if (this.#quietRepeats.has(turnId)) return;
      this.#quietRepeats.add(turnId);
      clearTimeout(armed);
    }
    const repeated = armed !== undefined;
    const quietFor = repeated ? 0 : QUIET_END_MS;
    const calledAt = Date.now();
    const check = () => {
      this.#quietEndTimers.delete(turnId);
      const running = this.#runningTurns.get(turnId);
      if (!running || this.#quietStops.has(turnId)) return;
      const { client, threadId } = running;
      if (
        !this.#quietAfterNoUpdate(agentId, threadId, turnId) ||
        this.#hooks.turnStopped(agentId, this.#taskForThread(agentId, threadId), turnId)
      )
        return;
      const silentFor = Date.now() - Math.max(calledAt, running.lastEventAt);
      if (running.openTools.size > 0 || this.#attention.hasAttentionForTurn(threadId, turnId)) {
        wait(repeated ? QUIET_REPEAT_POLL_MS : QUIET_END_MS);
        return;
      }
      const sinceCall = Date.now() - calledAt;
      if (silentFor < quietFor && sinceCall < QUIET_END_MAX_MS) {
        wait(Math.min(quietFor - silentFor, QUIET_END_MAX_MS - sinceCall));
        return;
      }
      this.#quietStops.add(turnId);
      logger.info(
        repeated
          ? "A quiet turn called the no-update tool again; OpenBot ends it."
          : silentFor < quietFor
            ? "A quiet turn did not end in time after its no-update call; OpenBot ends it."
            : "A quiet turn sent nothing after its no-update call; OpenBot ends it.",
        { agentId, turnId, provider: client.provider },
      );
      Effect.runFork(client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(Effect.ignore));
    };
    const wait = (ms: number) => {
      const timer = setTimeout(check, ms);
      timer.unref?.();
      this.#quietEndTimers.set(turnId, timer);
    };
    wait(quietFor);
  }

  #clearQuietEnd(turnId: string): void {
    const timer = this.#quietEndTimers.get(turnId);
    if (timer) clearTimeout(timer);
    this.#quietEndTimers.delete(turnId);
    this.#quietStops.delete(turnId);
    this.#quietRepeats.delete(turnId);
  }

  quietChannelTurn(turnId: string): boolean {
    return this.#quietChannelTurns.has(turnId) && !this.#reportedFailures.has(turnId);
  }

  channelNote(turnId: string, messageId: string): "result" | "pending" | "running" | null {
    if (this.#channelResultNotes.get(turnId)?.has(messageId)) return "result";
    const running = this.#runningTurns.get(turnId);
    if (!running) return null;
    return running.narration === messageId && !running.narrationStepKnown ? "pending" : "running";
  }

  #keepChannelResultNote(turnId: string, messageId: string): void {
    const notes = this.#channelResultNotes.get(turnId);
    if (notes) {
      notes.add(messageId);
      return;
    }
    this.#channelResultNotes.set(turnId, new Set([messageId]));
    if (this.#channelResultNotes.size > ENDED_TURN_LIMIT) {
      const [oldest] = this.#channelResultNotes.keys();
      if (oldest !== undefined) this.#channelResultNotes.delete(oldest);
    }
  }

  keepChannelTurnAnswers(turnId: string): void {
    this.#quietChannelTurns.delete(turnId);
  }

  reportRoutineFailure(agentId: string, turnId: string, reason: string, channelRun = false): boolean {
    const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
    if (!channelRun && !deliveries.some(({ delivery }) => delivery.sender.kind === "routine")) return false;
    this.#reportedFailures.set(turnId, reason);
    return true;
  }

  #quietRoutineTurn(
    agentId: string,
    threadId: string | null,
    deliveries: readonly DeliveryContext[],
    noUpdateCalled = false,
    answered: (delivery: QueueDelivery) => boolean = () => false,
  ): boolean {
    const publicThreadId = threadId === null ? null : this.#conversation.publicThreadId(agentId, threadId);
    return (
      deliveries.length > 0 &&
      (!this.#conversation.isExecutionThread(publicThreadId) ||
        (publicThreadId !== null && this.#hooks.isRoutineThread(publicThreadId))) &&
      deliveries.every(
        ({ delivery }) =>
          (teammateRequest(delivery) && answered(delivery)) ||
          this.#quietTeammateTurnDelivery(delivery) ||
          (delivery.sender.kind === "routine" && this.#hooks.quietRoutineDelivery(delivery.id)) ||
          (noUpdateCalled && this.#continuesQuietRun(delivery)),
      )
    );
  }

  #continuesQuietRun(delivery: DeliveryContext["delivery"]): boolean {
    const requestId = answeredRequestId(delivery);
    const run = requestId ? this.#mailbox.routineDeliveryOfRequest(delivery.recipientAgentId, requestId) : null;
    return run !== null && this.#hooks.quietRoutineDelivery(run.delivery.id);
  }

  #quietTeammateTurnDelivery(delivery: QueueDelivery): boolean {
    return quietTeammateTurnDelivery(delivery, (request) => this.#mailbox.hasOwnReplyFrom(request.id));
  }

  readonly #completeTurn = Effect.fn("TurnLifecycle.completeTurn")(
    function* (this: TurnLifecycle, agentId: string, threadId: string, turnId: string, status: string) {
      const running = this.#runningTurns.get(turnId);
      this.#runningTurns.delete(turnId);
      this.#markEnded(turnId);
      this.#completingTurns.add(turnId);
      const toolOutcomes = this.#traces.toolOutcomes(turnId);
      const trace = this.#traces.take(turnId, new Date().toISOString());
      const noUpdateSteps = this.#noUpdateSteps.get(turnId);
      this.#noUpdateSteps.delete(turnId);
      const noUpdateCalled = this.#noUpdateTurns.delete(turnId);
      const taskStarted = this.#taskStartTurns.delete(turnId);
      const quietChannelRun = this.#quietChannelTurns.has(turnId);
      this.#quietEmptyAnswers.delete(turnId);
      this.#clearQuietEnd(turnId);
      const reportedFailure = this.#reportedFailures.get(turnId);
      this.#reportedFailures.delete(turnId);
      if (running) {
        this.#keepTurnTiming(turnId, running);
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
      const failureCause = this.#turnCauses.get(turnId);
      this.#turnCauses.delete(turnId);
      this.#turnRetries.delete(turnId);
      this.#capacityNotices.delete(turnId);
      const refusedFailure =
        running !== undefined && status === "failed" && reportedError !== undefined
          ? refusedSessionFailure(
              running.client.provider,
              reportedError,
              running.client.contextWindow?.(threadId) ?? null,
            )
          : null;
      const refused = running !== undefined && refusedFailure !== null;
      const safetyBlock = this.#safetyBlockedTurns.delete(turnId)
        ? yield* this.#dropSafetyBlockedTurn(
            running?.acted === false && !running.carriedHistory ? running.client : null,
            threadId,
            turnId,
            reportedError ?? "",
          )
        : null;
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
      const workspace = this.#store.get(agentId)?.workspacePath;
      const instructionsChange = yield* this.#instructions.finishTurn(agentId, turnId, workspace);
      const routineSession = this.#conversation.isRoutineSession(threadId);
      const failedOnProvider = failover !== undefined && !limited && status === "failed" && running !== undefined;
      const mayRunAgain = failedOnProvider && !running.acted;
      const tokenRefused = failover !== undefined && isRefusedGeminiToken(failover.context.provider, failover.message);
      const stoppedAfterWork = failedOnProvider && this.#carriesWork(agentId, turnId, running);
      const spentAfterWork = stoppedAfterWork && failover.context.causeCode === "usage_limit";
      const failedAfterWork = stoppedAfterWork && CONTINUE_CAUSES.has(failover.context.causeCode);
      const mayContinue = spentAfterWork || failedAfterWork;
      const failingSession =
        running !== undefined &&
        !refused &&
        this.#countSessionFailure(
          running,
          threadId,
          status,
          !limited &&
            failover?.context.causeCode !== "usage_limit" &&
            compactionFailure === undefined &&
            !routineSession,
        );
      const shouldCompact =
        !refused &&
        !failingSession &&
        !limited &&
        !mayRunAgain &&
        !mayContinue &&
        !routineSession &&
        this.#compaction.reserve(agentId, threadId, false, turnId);
      const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
      this.#browser.endControl(publicThreadId, turnId);
      const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
      if (snapshot.activeTurnId === turnId || !this.#runningTurns.has(snapshot.activeTurnId ?? ""))
        snapshot.activeTurnId = null;
      const deliveries = this.#mailbox.findDeliveriesByTurn(agentId, turnId);
      const taskTurn = this.#conversation.isTaskThread(snapshot.threadId);
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
      const compactionContinuation =
        compactionFailure !== undefined &&
        !compactionFailure.loop &&
        failover === undefined &&
        status === "failed" &&
        running !== undefined &&
        !limited &&
        !channelTurn &&
        !routineSession &&
        (!taskTurn || laneTaskId !== null) &&
        this.#planContinues(agentId, laneTaskId, turnId, deliveries, undefined) === "allowed"
          ? this.#planContinuation[compactionFailure.exited ? "afterProviderExit" : "afterFailedCompaction"]({
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
      const resumed =
        limited && running?.unprompted === true && deliveries.length === 0 && !channelTurn && !routineSession
          ? this.#backgroundWork(agentId, turnId, snapshot, running.reports)
          : null;
      const model = this.#hooks.turnModel(agentId, turnId);
      const failedKey = this.#usageLimits.failureKey(agentId, model);
      const channelTask = this.#channelTask(snapshot.threadId, deliveries);
      const backupTakes = () =>
        ((mayRunAgain || failedAfterWork) && this.#hooks.mayFailOver(agentId)) ||
        (spentAfterWork && this.#hooks.mayContinueOnBackup(agentId));
      const failedOver =
        (mayRunAgain || mayContinue) &&
        failedKey !== null &&
        deliveries.length > 0 &&
        !channelTask &&
        deliveries.every(({ delivery }) => !this.#failoverRetries.get(delivery.id)?.has(failedKey)) &&
        backupTakes();
      const mayRunHere =
        !failedOver &&
        (mayRunAgain || (failedOnProvider && tokenRefused)) &&
        failedKey !== null &&
        deliveries.length > 0 &&
        deliveries.every(({ delivery }) => !this.#failoverRetries.get(delivery.id)?.has(failedKey));
      const [onlyDelivery] = deliveries;
      const channelRunsAgain =
        mayRunHere &&
        channelTask &&
        deliveries.length === 1 &&
        onlyDelivery !== undefined &&
        failover.context.causeCode === "empty_answer" &&
        (yield* this.#hooks.keepChannelDelivery(onlyDelivery.delivery.id));
      const runsAgainHere =
        channelRunsAgain ||
        (mayRunHere &&
          this.#conversation.channelForThread(snapshot.threadId) === null &&
          (tokenRefused ||
            (failover.context.causeCode === "empty_answer" &&
              deliveries.every(
                ({ delivery }) => delivery.sender.kind === "agent" && Boolean(delivery.replyToMessageId),
              ))));
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
      const subagents = snapshot.messages.find((message) => message.id === `${turnId}:subagents`);
      const ownChat = !routineSession && snapshot.threadId === this.#store.get(agentId)?.threadId;
      const working = new Set(ownChat ? this.#workingCodexChildren(turnId).map(({ threadId: child }) => child) : []);
      stopRunningSubagents(subagents?.subagents, new Date().toISOString(), { background: false, keep: working });
      if (this.#trackSubagents(agentId, turnId, subagents?.subagents)) this.#hooks.emitRuntimeSnapshot();
      if (routineSession && !this.#subagentsWork(agentId, turnId)) this.#archivableRoutineSessions.add(threadId);
      for (const [childId, parent] of this.#codexChildren)
        if (parent.turnId === turnId && !working.has(childId)) this.#codexChildren.delete(childId);
      for (const message of snapshot.messages) {
        if (this.#itemTurns.get(message.id) !== turnId || message.status !== "streaming") continue;
        message.status = normalizeCompletionStatus(
          repeatable || resumed || failedOver || runsAgainHere || compactionContinuation ? "interrupted" : status,
        );
        markIncompleteMediaGeneration(message, message.status);
      }
      for (const [itemId, itemTurnId] of this.#itemTurns) if (itemTurnId === turnId) this.#itemTurns.delete(itemId);
      if (resumed) {
        const steps = running?.acted ? (yield* continuedWork).workSteps : "";
        if (steps)
          for (const continuation of resumed.continuations.values())
            continuation.workSteps = `${continuation.workSteps}\n\n${steps}`.slice(-6000);
        yield* this.#requeueTurn(
          agentId,
          threadId,
          turnId,
          snapshot,
          resumed.deliveries,
          undefined,
          undefined,
          resumed.continuations,
        );
        yield* this.#usageLimits.reached(agentId, resetsAt, model);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      if (requeue) {
        yield* this.#requeueTurn(
          agentId,
          threadId,
          turnId,
          snapshot,
          deliveries,
          continuing ? yield* continuedWork : undefined,
          running?.failureReports,
        );
        yield* this.#usageLimits.reached(agentId, resetsAt, model);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      if (failover && (failedOver || runsAgainHere) && failedKey !== null) {
        if (failedOver && this.#showsRefusedCredential(agentId, threadId, failover))
          this.#hooks.emitError("agent_error", failover.message, agentId, failover.context, failover.link);
        else this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...failover.context });
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
          (failedOver && mayContinue) || (runsAgainHere && !mayRunAgain) ? yield* continuedWork : undefined,
          running?.failureReports,
        );
        if (failedOver || (channelRunsAgain && backupTakes())) this.#markFailed(agentId, model, failover);
        if (failingSession) yield* this.#dropFailingSession(agentId, threadId, running.client.provider);
        this.#hooks.scheduleDrain(agentId);
        return;
      }
      if (
        failover &&
        failedKey !== null &&
        ((mayRunAgain && taskTurn && this.#hooks.mayFailOver(agentId)) || (channelTask && backupTakes()))
      )
        this.#markFailed(agentId, model, failover);
      if (failover) this.#showFailoverError(agentId, threadId, failover, status === "failed" && !limited);
      if (compactionFailure && compactionContinuation)
        this.#hooks.emitFailure?.({ code: "agent_error", agentId, ...compactionFailure.context });
      else if (compactionFailure && status === "failed" && !failover)
        this.#showFailoverError(agentId, threadId, compactionFailure);
      if (limited) yield* this.#usageLimits.reached(agentId, resetsAt, model);
      else if (status === "completed") yield* this.#usageLimits.completed(agentId, model);
      let requeued = repeatable && channelTurn;
      for (const { delivery } of requeued ? deliveries : []) {
        if (yield* this.#hooks.requeueChannelDelivery(delivery.id)) continue;
        requeued = false;
        break;
      }
      const outcome = requeued || compactionContinuation ? "interrupted" : status;
      const ownLane = !taskTurn && this.#conversation.channelForThread(snapshot.threadId) === null;
      if (ownLane && outcome === "failed") this.#failedTurns.set(agentId, turnId);
      else if (ownLane) this.#failedTurns.delete(agentId);
      const failure = refusedFailure ?? safetyBlock ?? reportedError;
      if (refused) yield* this.#hooks.dropRefusedSession(agentId, threadId);
      if (refused || safetyBlock !== null) {
        const context =
          safetyBlock === null
            ? undefined
            : { causeCode: "content_blocked" as const, provider: "codex" as const, model, turnId };
        if (laneTaskId !== null && failure !== undefined) {
          this.#hooks.emitFailure?.({ code: "agent_error", agentId, causeCode: classifyFailure(failure), ...context });
          this.#hooks.taskFailed(laneTaskId, failure);
        } else this.#hooks.emitError("agent_error", failure, agentId, context);
      }
      if (failingSession) yield* this.#dropFailingSession(agentId, threadId, running.client.provider);
      if (deliveries.some((delivery) => delivery.delivery.sender.kind === "agent")) {
        dropPlaceholderAnswers(snapshot, turnId);
      }
      const answerText = latestTurnAnswer(snapshot.messages, turnId)?.text;
      const resultSent = (delivery: QueueDelivery) =>
        !this.#conversation.isExecutionThread(snapshot.threadId) &&
        this.#sendsResult(agentId, turnId, delivery, deliveries, answerText);
      const settles = outcome === "completed" && reportedFailure === undefined;
      const quietTurn =
        settles &&
        (this.#continuesQuietTurns(running?.continues, deliveries) ||
          this.#quietRoutineTurn(agentId, snapshot.threadId, deliveries, noUpdateCalled, resultSent));
      const quiet =
        settles &&
        (quietTurn
          ? settleQuietRoutineTurn(
              snapshot,
              turnId,
              noUpdateCalled || answeredRequestTurn(deliveries, snapshot, turnId),
              running?.client.provider ?? this.#store.get(agentId)?.provider,
            )
          : quietChannelRun && settleQuietChannelTurn(snapshot, turnId));
      if (quiet && quietTurn) keepNewest(this.#quietTurns, turnId);
      if (settles && running?.unprompted && deliveries.length === 0 && running.continues.length > 0)
        keepNewest(this.#followUpTurns, turnId);
      if (!quiet) this.#quietChannelTurns.delete(turnId);
      const latestAssistant = latestTurnAnswer(snapshot.messages, turnId);
      const markerAnswer =
        latestAssistant !== undefined &&
        deliveries.some(({ delivery }) => delivery.sender.kind === "routine") &&
        isNoUpdateAnswer(latestAssistant.text);
      const routineDelivery = deliveries[0]?.delivery.id;
      if (routineSession && routineDelivery && outcome === "completed" && !quiet && !markerAnswer && latestAssistant)
        yield* this.#hooks.routineAnswered(agentId, routineDelivery, latestAssistant.text);
      const planMode: FinishCheckMode =
        outcome === "completed" &&
        reportedFailure === undefined &&
        running !== undefined &&
        !channelTurn &&
        !routineSession &&
        (!taskTurn || laneTaskId !== null) &&
        !this.#mailbox.awaitsTeammate(
          agentId,
          laneTaskId,
          new Set([
            turnId,
            ...deliveries.flatMap(({ resumeAfterUsageLimit, planContinuation }) => [
              ...(resumeAfterUsageLimit?.previousTurnIds ?? []),
              ...(planContinuation?.turnIds ?? []),
            ]),
          ]),
        )
          ? this.#planContinues(agentId, laneTaskId, turnId, deliveries, latestAssistant?.text)
          : "no";
      const continueMode: FinishCheckMode =
        planMode !== "no" &&
        (taskStarted ||
          (running?.startedBackgroundWork === true &&
            (yield* (running.client.wakesAfterBackgroundWork?.(threadId) ?? Effect.succeed(false)).pipe(
              Effect.orElseSucceed(() => false),
            ))))
          ? "no"
          : planMode;
      const awaitsEarlierRequest =
        continueMode !== "no" &&
        (this.#mailbox.awaitsTeammate(agentId, laneTaskId, null) ||
          this.#teammateWorksInBackground(agentId, laneTaskId));
      const turnPlan = snapshot.messages.find((message) => message.id === `${turnId}:plan`)?.plan ?? null;
      const toolSteps = trace?.steps.filter((step) => step.kind === "tool") ?? [];
      const finishCheck: FinishCheckMode =
        latestAssistant === undefined ||
        this.#hooks.checkFinish === undefined ||
        (toolSteps.length === 0 && !promisesWork(latestAssistant.text) && !awaitsEarlierRequest)
          ? "no"
          : continueMode;
      const proposed =
        continueMode === "no" || (continueMode === "only" && finishCheck === "no")
          ? null
          : this.#planContinuation.consider({
              agentId,
              taskId: laneTaskId,
              deliveryIds: deliveries.map(({ delivery }) => delivery.id),
              plan: turnPlan,
              earlierPlan:
                snapshot.messages.findLast(
                  (message) => message.itemType === CONVERSATION_PLAN_ITEM_TYPE && message.turnId !== turnId,
                )?.plan ?? null,
              answer: latestAssistant?.text,
              finishCheck,
              nextStep: !awaitsEarlierRequest,
            });
      let considered = proposed?.kind === "check" ? null : proposed;
      if (proposed?.kind === "check" && latestAssistant) {
        const gap = yield* this.#checkFinish(
          agentId,
          laneTaskId,
          turnId,
          snapshot,
          deliveries,
          toolSteps,
          toolOutcomes,
          turnPlan,
          latestAssistant.text,
          proposed.continuations,
          awaitsEarlierRequest,
        );
        considered = gap === null ? null : this.#planContinuation.afterFinishCheck(agentId, laneTaskId, gap);
      }
      const continuation = compactionContinuation ?? (considered && considered.kind !== "stopped" ? considered : null);
      const planStopped = considered?.kind === "stopped" && latestAssistant === undefined;
      if (!continuation)
        this.#planContinuation.cancel(
          agentId,
          laneTaskId ?? (this.#laneForThread(agentId, threadId) === MESSAGING_LANE ? MESSAGING_LANE : null),
        );
      const resultsKey = `${agentId}\u0000${publicThreadId}`;
      if (deliveries.length > 0) {
        const terminal = outcome === "failed" ? "failed" : outcome === "interrupted" ? "interrupted" : "completed";
        const resulted: DeliveryContext[] = [];
        for (const delivery of deliveries) {
          this.#refusedRetries.delete(delivery.delivery.id);
          this.#failoverRetries.delete(delivery.delivery.id);
          if (continuation) {
            yield* this.#mailbox.requeueForPlan(delivery.delivery.id, turnId).pipe(toTurnOperationFailed);
            continue;
          }
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
        if (!continuation && !this.#conversation.isExecutionThread(snapshot.threadId) && terminal === "completed") {
          const resultText = quiet ? answerText : latestAssistant?.text;
          const noResult =
            resultText !== undefined
              ? ""
              : noResultNote(snapshot.messages, turnId, trace, subagents?.subagents, (text) =>
                  redactText(this.#hooks.redactMcp(text)),
                );
          for (const delivery of deliveries)
            if (yield* this.#relayAgentResult(agentId, turnId, delivery, deliveries, resultText, noResult))
              resulted.push(delivery);
          yield* this.#relayTaskResults(agentId, turnId, deliveries, resultText ?? noResult);
        }
        if (resulted.length > 0)
          keepBounded(this.#lastResults, resultsKey, {
            turnIds: [turnId],
            requests: resulted,
            ...(running?.startedBackgroundWork ? { interim: true as const } : {}),
          });
        else this.#lastResults.delete(resultsKey);
        if (!continuation && (terminal === "failed" || terminal === "interrupted")) {
          const temporary =
            !refused &&
            !limited &&
            (tokenRefused || (failureCause !== undefined && TEMPORARY_REQUEST_CAUSES.has(failureCause)));
          for (const { delivery } of deliveries) yield* this.#answerFailedRequest(agentId, delivery.id, temporary);
          yield* this.#relayTaskResults(
            agentId,
            turnId,
            deliveries,
            endedTaskReportNote(
              terminal === "failed" && failure ? this.#hooks.redactMcp(failure) : null,
              terminal === "failed" ? "The provider gave no reason." : "The turn was stopped.",
            ),
          );
        }
        for (const { delivery } of deliveries) {
          if (delivery.sender.kind === "agent") this.#hooks.scheduleDrain(delivery.sender.agentId);
        }
      } else if (
        running?.unprompted &&
        outcome === "completed" &&
        !continuation &&
        !noUpdateCalled &&
        answerText?.trim()
      ) {
        const last = this.#lastResults.get(resultsKey);
        if (last && (running.continues.length === 0 || running.continues.some((id) => last.turnIds.includes(id)))) {
          const kept: DeliveryContext[] = [];
          for (const request of last.requests)
            if (yield* this.#relayLaterResult(agentId, turnId, request, answerText)) kept.push(request);
          if (kept.length > 0)
            this.#lastResults.set(resultsKey, {
              turnIds: [...last.turnIds, turnId],
              requests: kept,
              ...(running.startedBackgroundWork ? { interim: true as const } : {}),
            });
          else this.#lastResults.delete(resultsKey);
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
      const quietRunSteps =
        trace &&
        quiet &&
        quietTurn &&
        deliveries.some(({ delivery }) => delivery.sender.kind === "routine") &&
        traceMessage(snapshot.messages, turnId) === undefined
          ? quietRunStepsMessage(turnId, trace, noUpdateSteps)
          : null;
      if (quietRunSteps) snapshot.messages.push(quietRunSteps);
      if (trace) this.#attachTrace(snapshot.messages, agentId, turnId, trace);
      const memoryLine = memoryChangesMessage(turnId, memoryChanges, (text) => this.#hooks.redactMcp(text));
      if (memoryLine) snapshot.messages.push(memoryLine);
      if (instructionsChange) snapshot.messages.push(instructionsChangeMessage(turnId, instructionsChange));
      if (continuation) {
        if (continuation.kind !== "finishCheck")
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
                : continuation.kind === "providerExit"
                  ? sourceText("status.agent.providerExitContinues")
                  : sourceText(
                      continuation.kind === "plan" ? "status.agent.planContinues" : "status.agent.nextStepContinues",
                      {
                        current: continuation.current,
                        limit: continuation.limit,
                      },
                    ),
          });
      } else if (planStopped) {
        snapshot.messages.push({
          id: `${turnId}:plan-stopped`,
          author: "system",
          source: "system",
          status: "completed",
          createdAt: new Date().toISOString(),
          itemType: PLAN_CONTINUATION_ITEM_TYPE,
          text: sourceText("status.agent.planStopped"),
        });
      }
      const provider = running?.client.provider;
      if (
        ownLane &&
        outcome === "failed" &&
        !this.#hooks.inMessagingLane(agentId, publicThreadId) &&
        provider !== undefined &&
        failure === sourceText("error.provider.signInExpired", { provider: agentProviderName(provider) })
      )
        snapshot.messages.push({
          id: `${turnId}:sign-in-failure`,
          author: "system",
          source: "system",
          status: "completed",
          createdAt: new Date().toISOString(),
          itemType: `${SIGN_IN_FAILURE_ITEM_TYPE_PREFIX}${provider}`,
          text: failure,
        });
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
      if (proposed?.kind === "check") this.#hooks.emitRuntimeSnapshot();
      if (!channelTurn && !routineSession) {
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
            Effect.sync(() => {
              this.#completingTurns.delete(turnId);
              this.#quietChannelTurns.delete(turnId);
            }),
            () => this.#hooks.closeRoutineSession(threadId, this.#archivableRoutineSessions.delete(threadId)),
          ),
        ),
      ),
  );

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
    this.#showKeptSafetyBlock(agentId, turnId);
    this.#runningTurns.delete(turnId);
    this.#turnRetries.delete(turnId);
    this.#capacityNotices.delete(turnId);
    this.#reportedFailures.delete(turnId);
    this.#quietEmptyAnswers.delete(turnId);
    this.#clearQuietEnd(turnId);
    this.#markEnded(turnId);
    this.#instructions.dropTurn(agentId, turnId);
    const trace = this.#traces.take(turnId, new Date().toISOString());
    this.#noUpdateSteps.delete(turnId);
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
        stopRunningSubagents(message.subagents, now, { background: false });
        if (message.subagents && this.#trackSubagents(agentId, turnId, message.subagents))
          this.#hooks.emitRuntimeSnapshot();
        message.status = status;
        markIncompleteMediaGeneration(message, status);
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
    if (runningThreadId && this.#conversation.isRoutineSession(runningThreadId))
      yield* this.#hooks.closeRoutineSession(runningThreadId, !this.#subagentsWork(agentId, turnId));
    yield* turnStep(() => this.#mailboxSync.emitQueue(agentId)).pipe(Effect.catchCause(report));
    yield* turnStep(() => {
      for (const { delivery } of deliveries) {
        if (delivery.sender.kind === "agent") this.#hooks.scheduleDrain(delivery.sender.agentId);
      }
      this.#hooks.scheduleDrain(agentId);
    }).pipe(Effect.catchCause(report));
  }, Effect.uninterruptible);

  #countSessionFailure(running: { client: AgentClient }, threadId: string, status: string, count: boolean): boolean {
    if (running.client.provider !== "antigravity") return false;
    if (status === "completed") this.#sessionFailures.delete(threadId);
    if (status !== "failed" || !count) return false;
    const failures = (this.#sessionFailures.get(threadId) ?? 0) + 1;
    if (failures >= SESSION_FAILURE_LIMIT) {
      this.#sessionFailures.delete(threadId);
      return true;
    }
    this.#sessionFailures.set(threadId, failures);
    if (this.#sessionFailures.size > ENDED_TURN_LIMIT) {
      const [oldest] = this.#sessionFailures.keys();
      if (oldest !== undefined) this.#sessionFailures.delete(oldest);
    }
    return false;
  }

  readonly #dropFailingSession = Effect.fn("TurnLifecycle.dropFailingSession")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    provider: AgentClient["provider"],
  ) {
    logger.warn("A provider session failed turns in a row; OpenBot opens a new one.", {
      provider,
      failures: SESSION_FAILURE_LIMIT,
    });
    yield* this.#hooks.dropRefusedSession(agentId, threadId);
  });

  #markEnded(turnId: string): void {
    this.#endedTurns.add(turnId);
    if (this.#endedTurns.size > ENDED_TURN_LIMIT) {
      const [oldest] = this.#endedTurns;
      if (oldest !== undefined) this.#endedTurns.delete(oldest);
    }
  }

  readonly #dropSafetyBlockedTurn = Effect.fn("TurnLifecycle.dropSafetyBlockedTurn")(function* (
    this: TurnLifecycle,
    client: AgentClient | null,
    threadId: string,
    turnId: string,
    reason: string,
  ) {
    const dropped =
      client !== null &&
      (yield* client
        .request(
          "thread/revert",
          { threadId, beforeTurnId: turnId },
          decodeRecordResponse,
          SAFETY_BLOCK_REVERT_TIMEOUT_MS,
        )
        .pipe(
          Effect.as(true),
          Effect.catch((error) => {
            logger.warn("Codex kept a turn that its safety check blocked.", {
              provider: client.provider,
              error: this.#hooks.redactMcp(error.message),
            });
            return Effect.succeed(false);
          }),
        ));
    return safetyBlockText(reason, dropped);
  });

  #showKeptSafetyBlock(agentId: string, turnId: string): void {
    if (!this.#safetyBlockedTurns.delete(turnId)) return;
    this.#hooks.emitError("agent_error", safetyBlockText(this.#turnErrors.get(turnId) ?? "", false), agentId, {
      causeCode: "content_blocked",
      provider: "codex",
      turnId,
    });
  }

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

  readonly #requeueTurn = Effect.fn("TurnLifecycle.requeueTurn")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    snapshot: ConversationSnapshot,
    deliveries: readonly DeliveryContext[],
    resumeAfterUsageLimit?: UsageLimitContinuation,
    failureReports?: ReadonlySet<string>,
    finished?: ReadonlyMap<string, UsageLimitContinuation>,
  ) {
    if (!resumeAfterUsageLimit)
      for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
        const message = snapshot.messages[index];
        if (isEmptyAttemptText(message, turnId) || (message && failureReports?.has(message.id)))
          snapshot.messages.splice(index, 1);
      }
    for (const context of deliveries) {
      const { delivery } = context;
      const finishedWork = finished?.get(delivery.id);
      const continuation = finishedWork
        ? {
            ...finishedWork,
            previousTurnIds: [
              ...new Set([...(context.resumeAfterUsageLimit?.previousTurnIds ?? []), ...finishedWork.previousTurnIds]),
            ],
          }
        : resumeAfterUsageLimit
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
      yield* this.#mailbox
        .requeueRefused(delivery.id, continuation, finishedWork !== undefined)
        .pipe(toTurnOperationFailed);
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

  #markProduced(turnId: string, acted: boolean, streamed = acted, reaction = false): void {
    const running = this.#runningTurns.get(turnId);
    if (!running) return;
    running.produced = true;
    if (acted) running.acted = true;
    if (acted && !reaction) running.workedBesidesReaction = true;
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

  readonly #requeueUnreadSteers = Effect.fn("TurnLifecycle.requeueUnreadSteers")(function* (
    this: TurnLifecycle,
    agentId: string,
    threadId: string,
    turnId: string,
    reported: readonly string[],
  ) {
    const deliveryIds = reported.filter((deliveryId) => this.#mailbox.steeredIntoOtherWork(deliveryId));
    if (deliveryIds.length === 0) return;
    for (const deliveryId of deliveryIds)
      yield* this.#mailbox
        .restoreUnsteered(deliveryId, turnId)
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("delivery_turn_association_failed", failure.cause, agentId)),
          ),
        );
    yield* turnStep(() => {
      const restored = new Set(
        deliveryIds.filter((deliveryId) => this.#mailbox.getDelivery(deliveryId)?.delivery.status === "queued"),
      );
      if (restored.size === 0) return;
      const snapshot = this.#conversation.ensureSnapshot(agentId, this.#conversation.publicThreadId(agentId, threadId));
      for (let index = snapshot.messages.length - 1; index >= 0; index -= 1)
        if (restored.has(snapshot.messages[index]?.id ?? "")) snapshot.messages.splice(index, 1);
      this.#mailboxSync.syncMailboxMessages(snapshot);
      this.#mailboxSync.emitQueue(agentId);
    }).pipe(
      Effect.catchCause((cause) =>
        reportOriginalFailure(cause, (failure) => this.#hooks.emitError("turn_completion_failed", failure, agentId)),
      ),
    );
  });

  #answerFailedRequest(agentId: string, deliveryId: string, temporary: boolean): Effect.Effect<void> {
    return this.#mailbox
      .answerFailedRequest(
        deliveryId,
        (taskId) => this.#hooks.taskOpen(taskId),
        (id) => this.#store.has(id),
        false,
        temporary,
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

  #sendsResult(
    agentId: string,
    turnId: string,
    delivery: QueueDelivery,
    turnDeliveries: readonly DeliveryContext[],
    text: string | undefined,
  ): boolean {
    if (delivery.sender.kind !== "agent") return false;
    const messageId = delivery.messageId;
    const originAgentId = this.#mailbox.chainOriginAgentId(messageId);
    const recipientAgentId = delivery.sender.agentId;
    if (!this.#store.has(recipientAgentId)) return false;
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
    return !(
      !originAgentId ||
      originAgentId === agentId ||
      !this.#mailbox.expectsReply(messageId) ||
      this.#mailbox.hasReplyFrom(agentId, messageId) ||
      this.#mailbox.heldByTask(agentId, messageId) ||
      this.#mailbox.hasAgentMessageFromTurnTo(agentId, turnId, recipientAgentId, requestIds) ||
      (text === undefined && this.#mailbox.hasRequestFromTurn(agentId, turnId)) ||
      this.#mailbox.steeredIntoOtherWork(delivery.id)
    );
  }

  readonly #relayAgentResult = Effect.fn("TurnLifecycle.relayAgentResult")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    delivery: DeliveryContext,
    turnDeliveries: readonly DeliveryContext[],
    text: string | undefined,
    noResult: string,
  ) {
    if (!this.#sendsResult(agentId, turnId, delivery.delivery, turnDeliveries, text)) return false;
    if (delivery.delivery.sender.kind !== "agent") return false;
    yield* this.#sendResult(
      agentId,
      turnId,
      delivery.delivery.messageId,
      delivery.delivery.sender.agentId,
      text ?? noResult,
    );
    return true;
  });

  readonly #relayLaterResult = Effect.fn("TurnLifecycle.relayLaterResult")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    { delivery }: DeliveryContext,
    text: string,
  ) {
    if (delivery.sender.kind !== "agent" || !this.#store.has(delivery.sender.agentId)) return false;
    if (this.#mailbox.hasAgentMessageFromTurnTo(agentId, turnId, delivery.sender.agentId, new Set())) return false;
    yield* this.#sendResult(agentId, turnId, delivery.messageId, delivery.sender.agentId, text);
    return true;
  });

  readonly #relayTaskResults = Effect.fn("TurnLifecycle.relayTaskResults")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    deliveries: readonly DeliveryContext[],
    text: string,
  ) {
    const reportedTaskIds = new Set(
      deliveries.flatMap(({ delivery, senderTaskId }) =>
        senderTaskId && delivery.sender.kind === "agent" && delivery.sender.agentId === agentId ? [senderTaskId] : [],
      ),
    );
    const finishedTaskIds = new Set(
      [...reportedTaskIds].filter((taskId) => !this.#mailbox.taskStillWorks(agentId, taskId)),
    );
    const requestIds = new Set(
      [...finishedTaskIds].flatMap((taskId) => this.#mailbox.requestsHeldByTask(agentId, taskId)),
    );
    const turnRequestIds = new Set(deliveries.map(({ delivery }) => delivery.messageId));
    for (const requestId of requestIds) {
      const requesterId = this.#mailbox.requestSenderAgentId(requestId);
      if (
        !requesterId ||
        !this.#store.has(requesterId) ||
        this.#mailbox.hasReplyFrom(agentId, requestId) ||
        this.#mailbox.hasAgentMessageFromTurnTo(agentId, turnId, requesterId, turnRequestIds) ||
        this.#mailbox.heldByTask(agentId, requestId, finishedTaskIds)
      )
        continue;
      yield* this.#sendResult(agentId, turnId, requestId, requesterId, text);
    }
  });

  readonly #sendResult = Effect.fn("TurnLifecycle.sendResult")(function* (
    this: TurnLifecycle,
    agentId: string,
    turnId: string,
    messageId: string,
    recipientAgentId: string,
    text: string,
  ) {
    const answerTaskId = this.#mailbox.answerTaskId(agentId, messageId, [recipientAgentId]);
    const taskId = answerTaskId && this.#hooks.taskOpen(answerTaskId) ? answerTaskId : undefined;
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId },
        requesterIds: this.#mailbox.requesterIds(messageId),
        recipientAgentIds: [recipientAgentId],
        text,
        replyToMessageId: messageId,
        ...(taskId ? { taskId } : {}),
        expectsReply: false,
        idempotencyKey: `${AUTO_RESULT_KEY_PREFIX}${turnId}:${messageId}`,
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

  #usageSession(agentId: string, threadId: string, source: AgentClient) {
    const agent = this.#store.get(agentId);
    if (!agent) return undefined;
    const session =
      this.#store.database
        .listProviderSessions(this.#conversation.publicThreadId(agentId, threadId))
        .find((entry) => entry.externalSessionId === threadId && entry.provider === source.provider) ??
      (this.#conversation.isRoutineSession(threadId)
        ? { id: `routine:${threadId}`, provider: source.provider, createdAt: new Date().toISOString() }
        : undefined);
    return session ? { agent, session } : undefined;
  }

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

  #applySubagents(agentId: string, threadId: string, turnId: string, subagents: ConversationSubagent[]): void {
    const snapshot = this.#conversation.ensureSnapshot(agentId, threadId);
    const id = `${turnId}:subagents`;
    let message = snapshot.messages.find((candidate) => candidate.id === id);
    if (!message && !this.#runningTurns.has(turnId)) {
      message = this.#store.database.readConversationMessages(agentId, snapshot.threadId, [id])[0];
      if (!message) {
        if (this.#trackSubagents(agentId, turnId, subagents)) this.#hooks.emitRuntimeSnapshot();
        return;
      }
      snapshot.messages.push(message);
    }
    if (!message) {
      message = newAssistantMessage(id, turnId);
      snapshot.messages.push(message);
      this.#itemTurns.set(id, turnId);
    }
    const previous = message.subagents;
    if (
      ![...this.#runningTurns.values()].some(
        (running) =>
          running.agentId === agentId &&
          this.#conversation.publicThreadId(agentId, running.threadId) === snapshot.threadId,
      )
    ) {
      const key = `${agentId}\u0000${snapshot.threadId}`;
      for (const subagent of subagents)
        if (
          subagent.background &&
          subagent.status !== "running" &&
          previous?.find((candidate) => candidate.id === subagent.id)?.status === "running"
        )
          this.#unreadReports.set(key, (this.#unreadReports.get(key) ?? new Map()).set(subagent.id, turnId));
    }
    message.itemType = CONVERSATION_SUBAGENTS_ITEM_TYPE;
    message.text = conversationSubagentsText(subagents);
    message.subagents = subagents;
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

  #subagentsWork(agentId: string, turnId: string): boolean {
    if (this.#subagentTurns.get(agentId)?.has(turnId)) return true;
    for (const parent of this.#codexChildren.values()) if (parent.turnId === turnId) return true;
    return false;
  }

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

  #applyCodexSubagentActivity(agentId: string, threadId: string, turnId: string, item: DynamicRecord): void {
    const childThreadId = getString(item, "agentThreadId");
    if (!childThreadId) return;
    const kind = getString(item, "kind");
    if (kind === "started" || kind === "interacted")
      this.#codexChildren.set(childThreadId, { agentId, threadId, turnId });
    else this.#codexChildren.delete(childThreadId);
  }

  workingCodexChildren(
    agentId: string,
    turnId: string,
  ): Array<{ threadId: string; turnId: string; client: AgentClient }> {
    const turnIds = new Set(
      [...this.#codexChildren.values()]
        .filter((parent) => parent.agentId === agentId && !this.#runningTurns.has(parent.turnId))
        .map((parent) => parent.turnId),
    );
    if (!turnIds.has(turnId)) return [];
    const children = [...turnIds].flatMap((ended) => this.#workingCodexChildren(ended));
    return children.some((child) => this.#codexChildren.get(child.threadId)?.turnId === turnId) ? children : [];
  }

  #workingCodexChildren(turnId: string): Array<{ threadId: string; turnId: string; client: AgentClient }> {
    return [...this.#codexChildren]
      .filter(([, parent]) => parent.turnId === turnId)
      .flatMap(([threadId]) => {
        const live = this.#codexChildTurns.get(threadId);
        return live ? [{ threadId, ...live }] : [];
      });
  }

  #endCodexChild(childThreadId: string, turnStatus: string | null): void {
    const parent = this.#codexChildren.get(childThreadId);
    if (!parent || this.#runningTurns.has(parent.turnId)) return;
    this.#codexChildren.delete(childThreadId);
    const snapshot = this.#conversation.ensureSnapshot(parent.agentId, parent.threadId);
    const id = `${parent.turnId}:subagents`;
    const current =
      snapshot.messages.find((candidate) => candidate.id === id)?.subagents ??
      this.#store.database.readConversationMessages(parent.agentId, snapshot.threadId, [id])[0]?.subagents;
    if (!current) {
      const working = this.#workingCodexChildren(parent.turnId).length > 0;
      if (!working && this.#trackSubagents(parent.agentId, parent.turnId, [])) this.#hooks.emitRuntimeSnapshot();
      return;
    }
    const subagents = endCodexChild(current, childThreadId, turnStatus, new Date().toISOString());
    if (subagents) this.#applySubagents(parent.agentId, parent.threadId, parent.turnId, subagents);
  }

  codexSubagentParent(childThreadId: string): CodexSubagentParent | undefined {
    return this.#codexChildren.get(childThreadId);
  }

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
    snapshot.messages.splice(index, 1);
    this.#itemTurns.delete(`${turnId}:plan`);
    this.#conversation.emitConversation(snapshot);
  }

  #observeTraceStep(
    turnId: string,
    item: ThreadItem,
    completed: boolean,
    toolProgress: string | null,
    failure: string | null,
  ): void {
    if (!isString(item.id)) return;
    if (isToolItem(item)) {
      if (isNoUpdateToolCall(item))
        this.#noUpdateSteps.set(turnId, (this.#noUpdateSteps.get(turnId) ?? new Set()).add(item.id));
      const failed = completed && toolFailed(item);
      this.#traces.observe(turnId, item.id, "tool", {
        completed,
        failed,
        text: toolProgress,
        error: failure,
        ...toolTraceDetail(item),
        ...(this.#hooks.checkFinish === undefined
          ? {}
          : {
              tool: toolCallName(item),
              result: completed ? toolResultText(item, (text) => redactText(this.#hooks.redactMcp(text))) : null,
            }),
      });
    } else if (item.type === "agentMessage")
      this.#traces.observe(turnId, item.id, item.phase === "commentary" ? "reasoning" : "message", { completed });
  }

  #attachTrace(
    messages: ConversationMessage[],
    agentId: string,
    turnId: string,
    trace: ConversationTurnTrace,
  ): ConversationMessage | undefined {
    const message = traceMessage(messages, turnId);
    if (!message) return undefined;
    let usage: { tokens: number; cachedInput: number; costUsd: number | null } | null = null;
    try {
      const since = new Date(Date.parse(trace.startedAt) - TURN_USAGE_MARGIN_MS).toISOString();
      usage = this.#store.database.usage.readTurnTotals(agentId, turnId, since);
    } catch (error) {
      logger.warn("The usage of a turn could not be read for its trace.", { error });
    }
    message.trace = usage
      ? { ...trace, tokens: usage.tokens, cachedInput: usage.cachedInput, costUsd: usage.costUsd }
      : trace;
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

function answeredRequestTurn(
  deliveries: readonly DeliveryContext[],
  snapshot: ConversationSnapshot,
  turnId: string,
): boolean {
  return (
    deliveries.length > 0 &&
    deliveries.every(({ delivery }) => teammateRequest(delivery)) &&
    writesNoAnswer(snapshot, turnId)
  );
}

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
    if (message.attachments?.length || message.imageGeneration || message.videoGeneration) continue;
    if (!message.text.trim() || /[\p{L}\p{N}]/u.test(message.text)) continue;
    snapshot.messages.splice(index, 1);
  }
}

function isEmptyAttemptText(message: ConversationMessage | undefined, turnId: string): boolean {
  return (
    message?.author === "assistant" &&
    message.turnId === turnId &&
    (message.itemType === "agentMessage" || message.itemType === "commentary") &&
    !message.text.trim() &&
    !message.attachments?.length &&
    !message.imageGeneration &&
    !message.videoGeneration
  );
}

export class TurnOperationFailed extends Schema.TaggedError<TurnOperationFailed>()("TurnOperationFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: turnStep, rewrap: toTurnOperationFailed } = causeHelpers(TurnOperationFailed);

const NO_RESULT_STEP_LIMIT = 6;
const NO_RESULT_FILE_LIMIT = 8;
const NO_RESULT_TEXT_LIMIT = 160;

function noResultNote(
  messages: readonly ConversationMessage[],
  turnId: string,
  trace: ConversationTurnTrace | null,
  subagents: readonly ConversationSubagent[] | undefined,
  redact: (text: string) => string,
): string {
  const line = (text: string) => redact(text).replace(/\s+/gu, " ").trim().slice(0, NO_RESULT_TEXT_LIMIT);
  const steps = trace?.steps.filter((step) => step.kind === "tool") ?? [];
  const files = messages
    .filter((message) => message.author === "assistant" && message.turnId === turnId)
    .flatMap((message) => message.attachments ?? [])
    .map((file) => line(file.name));
  const running = (subagents ?? []).filter((subagent) => subagent.status === "running");
  const evidence: string[] = [];
  if (steps.length > 0) {
    const failed = steps.filter((step) => step.failed).length;
    const shown = steps
      .slice(-NO_RESULT_STEP_LIMIT)
      .map(
        (step) =>
          `${line(step.command ?? step.text ?? "") || "tool"} (${step.endedAt === null ? "not finished" : step.failed ? "failed" : "completed"})`,
      );
    evidence.push(`Tool steps in the turn: ${steps.length}, failed: ${failed}. Last steps: ${shown.join("; ")}.`);
  }
  if (files.length > 0)
    evidence.push(`Files that the turn made (${files.length}): ${files.slice(-NO_RESULT_FILE_LIMIT).join(", ")}.`);
  if (running.length > 0)
    evidence.push(
      `Background work of the turn still runs (${running.length}): ${running
        .slice(0, NO_RESULT_STEP_LIMIT)
        .map((subagent) => line(subagent.title) || "subagent")
        .join("; ")}.`,
    );
  const unblock =
    running.length > 0
      ? "Do not send the same request again while the background work runs. Wait for it, or ask the teammate for its state."
      : evidence.length > 0
        ? "Do not send the same request again. Check the steps and files above first, then finish the rest yourself or ask the teammate only for the part that is missing."
        : "Check what is done, then finish the rest yourself or send the teammate a narrower request.";
  return [
    "Status: blocked",
    "Result: OpenBot note, not written by this teammate: the teammate's turn ended with no written result and no error. The requested work can be unfinished.",
    `Evidence: ${evidence.length > 0 ? evidence.join(" ") : "none"}`,
    `Unblock: ${unblock}`,
  ].join("\n");
}

function isRepeatedWork(item: { type?: unknown; phase?: unknown; text?: unknown; failureReport?: unknown }): boolean {
  if (item.type === "userMessage" || item.type === "reasoning" || item.type === "contextCompaction") return false;
  if (item.type !== "agentMessage") return true;
  if (item.failureReport === true) return false;
  return item.phase !== "commentary" && hasText(item);
}

const NO_ANSWER_CHECKED_PROVIDERS: ReadonlySet<AgentProviderId> = new Set([
  "codex",
  "claude",
  "pi",
  ...KEY_ONLY_PROVIDERS,
]);

const NARRATION_KEEPING_TOOLS = new Set([
  "messaging_history",
  "messaging_list_places",
  "messaging_remember",
  "messaging_forget_memory",
  "remember",
  "forget_memory",
  "search_memories",
  "history_read",
  "history_search",
  "react_to_user_message",
]);

function keepsNarration(item: DynamicRecord, completed: boolean): boolean {
  const threadItem = toThreadItem(item);
  if (threadItem === null) return false;
  const tool = openBotTool(threadItem);
  if (tool !== null) return NARRATION_KEEPING_TOOLS.has(tool);
  if (threadItem.type !== "toolCall" || getString(threadItem, "name") !== "execute") return false;
  if (!completed) return true;
  const calls = getArray(getRecord(getRecord(threadItem, "result"), "metadata"), "toolCalls");
  return calls.length > 0 && calls.every((call) => NARRATION_KEEPING_TOOLS.has(codeModeOpenBotTool(call) ?? ""));
}

const CHANNEL_RESULT_NAME = /(?:^|[._])channel_result$/u;
const BRIDGE_TOOL = /(?:^|[._])(?:tool_call|use_tool)$/u;
const CODE_CHANNEL_RESULT_CALL = /\bchannel_result\s*\(|["'`]openbot\.channel_result["'`]/u;

function channelNoteStep(item: DynamicRecord): "result" | "other" | null {
  const threadItem = toThreadItem(item);
  if (threadItem === null || !isToolItem(threadItem)) return null;
  if (openBotTool(threadItem) === "channel_result") return "result";
  if (threadItem.type !== "toolCall") return "other";
  const name = getString(threadItem, "name") ?? "";
  if (name === "execute") {
    const code = getString(getRecord(threadItem, "arguments"), "code");
    if (!code) return null;
    return CODE_CHANNEL_RESULT_CALL.test(code) ? "result" : "other";
  }
  if (!BRIDGE_TOOL.test(name)) return CHANNEL_RESULT_NAME.test(name) ? "result" : "other";
  const args = threadItem.arguments;
  const called = getString(args, "name") ?? getString(args, "tool") ?? getString(args, "tool_name");
  if (called === null) return null;
  return CHANNEL_RESULT_NAME.test(called) ? "result" : "other";
}

function codeModeOpenBotTool(call: unknown): string | null {
  const tool = getString(call, "tool");
  const name = tool === "openbot.tool_call" ? getString(getRecord(call, "input"), "name") : tool;
  return name?.startsWith("openbot.") ? name.slice("openbot.".length) : null;
}

function isUserReactionCall(item: DynamicRecord): boolean {
  const threadItem = toThreadItem(item);
  return threadItem !== null && openBotTool(threadItem) === "react_to_user_message";
}

function isEmptyAnswer(item: { type?: unknown; phase?: unknown; text?: unknown }): boolean {
  return item.type === "agentMessage" && item.phase !== "commentary" && !hasText(item);
}

function hasText(item: { text?: unknown }): boolean {
  return isString(item.text) && item.text.trim() !== "";
}

function replaysStartedResult({ delivery, restartedResult, restartedTurnId }: DeliveryContext): boolean {
  return restartedResult === true && restartedTurnId !== undefined && answeredRequestId(delivery) !== null;
}

function showsOutput(message: ConversationMessage): boolean {
  return (
    message.author !== "user" &&
    message.itemType !== "commentary" &&
    (message.text.trim() !== "" ||
      (message.attachments?.length ?? 0) > 0 ||
      message.imageGeneration !== undefined ||
      message.videoGeneration !== undefined ||
      message.questionPrompt !== undefined ||
      message.uiBlock !== undefined)
  );
}

function subagentStates(subagents: readonly ConversationSubagent[]): string {
  return subagents.map((subagent) => `${subagent.id}:${subagent.status}`).join("\n");
}

const ENDED_TASK_REPORT_REASON_LIMIT = 2_000;

function endedTaskReportNote(reason: string | null, fallback: string): string {
  return [
    "Status: blocked",
    `Result: OpenBot note, not written by this teammate: the task for this request ended, but the teammate's turn that read its result ended before the teammate answered. ${(reason ?? fallback).slice(0, ENDED_TASK_REPORT_REASON_LIMIT)}`,
    "Evidence: none",
    "Unblock: The teammate's chat has the task result. Send the request again if you still need the answer.",
  ].join("\n");
}
