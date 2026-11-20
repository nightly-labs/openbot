import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import { isNarrationItemId, showsNarration } from "@openbot/contracts/conversation-narration";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { itemTypeCountsAsUnread } from "@openbot/contracts/conversation-read";
import type {
  AgentExchangeSummary,
  AttachmentSummary,
  ChannelMessage,
  ChannelRoutingConversationEvent,
  ChannelTask,
  ConversationMemoryChange,
  ConversationMessage,
  ConversationMessageSender,
  ConversationQuestionPrompt,
  ConversationReaction,
  ConversationSubagent,
  ImageGenerationInfo,
  QueueDelivery,
  RoutineConversationEventAction,
  RoutineRunStatus,
  VideoGenerationInfo,
} from "@openbot/contracts/ipc";
import {
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  channelRoutineRequest,
  channelRoutingConversationEvent,
  isAgentAnswer,
  isContextResetMarker,
  marketplaceSuggestionEvent,
  mcpSignInEvent,
  parseConversationPlanText,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  replacedConversationPlans,
  routineConversationEvent,
  routineRunConversationEvent,
  SETTING_LINK_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { coordinatorText } from "@/features/channels/model/coordinator-text";
import { MOBILE_PLUGINS } from "@/features/marketplace/model/plugin-catalog.generated";
import { isMobileConnectorId } from "@/features/servers/model/connectors";
import { thinkingRowId } from "./turn-thinking";

export type RoutineMarkerEvent = RoutineConversationEventAction | RoutineRunStatus;

export type ChatPlanStepState = "pending" | "active" | "done";

export type ChatMessage =
  | {
      id: string;
      kind: "channel-routing";
      event:
        | ChannelRoutingConversationEvent
        | {
            action: ChannelRoutingConversationEvent["action"];
            agentId: null;
            agentName: string;
          };
    }
  | {
      id: string;
      kind: "exchange";
      exchange: AgentExchangeSummary;
      standalone: boolean;
    }
  | { id: string; kind: "context-reset" }
  | { id: string; kind: "app-suggestion"; appId: string }
  | { id: string; kind: "mcp-sign-in"; mcpServerId: string }
  | {
      id: string;
      kind: "routine";
      event: RoutineMarkerEvent;
      label: MobileTextKey;
      routineId: string;
      routineName: string;
    }
  | {
      id: string;
      kind: "question";
      turnId: string | undefined;
      prompt: ConversationQuestionPrompt;
      uiBlock?: ConversationUiBlock | undefined;
    }
  | {
      id: string;
      kind: "message";
      author: "agent" | "user";
      speaker?: ChannelMessage["author"];
      sender?: ConversationMessageSender;
      mine?: boolean;
      superseded?: boolean;
      body: string;
      streaming: boolean;
      status?: ConversationMessage["status"];
      replyToMessageId?: string | null;
      attachments?: AttachmentSummary[];
      visual?: { height?: number };
      imageGeneration?: ImageGenerationInfo;
      videoGeneration?: VideoGenerationInfo;
      failureReason?: string;
      createdAt?: string;
      reactions?: readonly ConversationReaction[];
      progress?: true;
    }
  | {
      id: string;
      kind: "plan";
      heading: string | null;
      explanation: string | null;
      stopped: boolean;
      steps: { id: string; text: string; state: ChatPlanStepState }[];
    }
  | {
      id: string;
      kind: "subagents";
      subagents: ConversationSubagent[];
    }
  | {
      id: string;
      kind: "memory-changes";
      changes: ConversationMemoryChange[];
    }
  | {
      id: string;
      kind: "thinking";
      turnId: string | undefined;
      steps: { id: string; text: string; progress?: true; createdAt?: string }[];
    };

export type ChatBubbleMessage = Extract<ChatMessage, { kind: "message" }>;

export type ExchangeMarker = Extract<ChatMessage, { kind: "exchange" }>;

export type RoutineMarker = Extract<ChatMessage, { kind: "routine" }>;

function messageReactions(message: ConversationMessage): readonly ConversationReaction[] | undefined {
  if (message.reactions?.length) return message.reactions;
  return message.reaction ? [{ emoji: message.reaction, actor: { kind: "user" } }] : undefined;
}

export interface ExchangeGroup {
  id: string;
  kind: "exchange-group";
  exchanges: ExchangeMarker[];
}

export interface PendingChatMessage {
  message: Extract<ChatMessage, { kind: "message" }>;
  baseline: ReadonlySet<string> | null;
  serverId: string | null;
}

export function indexChatMessages(
  messages: readonly ChatMessage[],
  aliases: ReadonlyMap<string, string>,
  references: readonly ChatMessage[] = [],
) {
  const index = new Map([...references, ...messages].map((message) => [message.id, message]));
  for (const [hostId, localId] of aliases) {
    const message = index.get(localId);
    if (message) index.set(hostId, message);
  }
  return index;
}

export function presentChatMessages(
  messages: ChatMessage[],
  pending: readonly PendingChatMessage[],
  aliases: ReadonlyMap<string, string>,
): ChatMessage[] {
  if (pending.length === 0 && aliases.size === 0) return messages;
  const baseline = pending.find((item) => !item.serverId && item.baseline)?.baseline;
  const visible = baseline ? messages.filter((message) => baseline.has(message.id)) : messages;
  const received = new Map<string, PendingChatMessage["message"]>();
  for (const item of pending) if (item.serverId) received.set(item.serverId, item.message);
  const result = visible.map((message) => {
    const local = received.get(message.id);
    if (local) return local;
    const alias = aliases.get(message.id);
    if (alias === undefined) return message;
    let aliased = aliasedMessages.get(message);
    if (aliased?.id !== alias) {
      aliased = { ...message, id: alias };
      aliasedMessages.set(message, aliased);
    }
    return aliased;
  });
  const drawn = new Set(visible.map((message) => message.id));
  for (const item of pending) if (!item.serverId || !drawn.has(item.serverId)) result.push(item.message);
  return result;
}

const projectedBubbles = new WeakMap<
  ConversationMessage,
  { readerKey: string; replaced: boolean; bubble: ChatMessage }
>();
const projectedExchanges = new WeakMap<ConversationMessage, ChatMessage>();
const projectedQuestions = new WeakMap<ConversationMessage, ChatMessage>();
const projectedMemoryChanges = new WeakMap<ConversationMessage, ChatMessage>();
const projectedRoutines = new WeakMap<ConversationMessage, ChatMessage>();
const projectedResets = new WeakMap<ConversationMessage, ChatMessage>();
const projectedUpdates = new WeakMap<ConversationMessage, ChatMessage>();

export interface ProgressUpdates {
  provider: (agentId: string | undefined) => AgentProviderRef | undefined;
}

function shownProgressUpdate(
  message: ConversationMessage,
  provider: AgentProviderRef | undefined,
  shown: Set<string>,
): boolean {
  return (
    message.status !== "streaming" && isNarrationItemId(message.id, provider) && showsNarration(message.text, shown)
  );
}

function turnShownNotes(): (turnKey: string) => Set<string> {
  const byTurn = new Map<string, Set<string>>();
  return (turnKey) => {
    let shown = byTurn.get(turnKey);
    if (!shown) {
      shown = new Set();
      byTurn.set(turnKey, shown);
    }
    return shown;
  };
}

function answerTimes(messages: Iterable<ConversationMessage>): ReadonlyMap<string, string> {
  const times = new Map<string, string>();
  for (const message of messages)
    if (message.turnId && isAgentAnswer(message) && !times.has(message.turnId))
      times.set(message.turnId, message.createdAt);
  return times;
}

function beforeAnswer(message: ConversationMessage, answered: ReadonlyMap<string, string>): boolean {
  const answer = message.turnId ? answered.get(message.turnId) : undefined;
  return !answer || message.createdAt <= answer;
}

function progressBubble(id: string, message: ConversationMessage): Extract<ChatMessage, { kind: "message" }> {
  return {
    id,
    kind: "message",
    author: "agent",
    body: message.text,
    streaming: false,
    status: message.status,
    createdAt: message.createdAt,
    progress: true,
  };
}

const projectedSuggestions = new WeakMap<ConversationMessage, ChatMessage>();
const projectedSignIns = new WeakMap<ConversationMessage, ChatMessage>();

function suggestedApp(message: ConversationMessage): string | null {
  const appId = marketplaceSuggestionEvent(message)?.appId;
  if (!appId) return null;
  return isMobileConnectorId(appId) || MOBILE_PLUGINS.some((plugin) => plugin.slug === appId) ? appId : null;
}

function settingLinkMessage(message: ConversationMessage): boolean {
  return message.author === "system" && message.itemType?.startsWith(SETTING_LINK_ITEM_TYPE_PREFIX) === true;
}

const ROUTINE_RUN_LABELS = {
  queued: "mobile.chat.routine.invoked",
  running: "mobile.chat.routine.running",
  "needs-attention": "mobile.chat.routine.needsAttention",
  succeeded: "mobile.chat.routine.completed",
  failed: "mobile.chat.routine.failed",
  interrupted: "mobile.chat.routine.interrupted",
  cancelled: "mobile.chat.routine.cancelled",
} as const satisfies Record<RoutineRunStatus, MobileTextKey>;

const ROUTINE_ACTION_LABELS = {
  created: "mobile.chat.routine.created",
  updated: "mobile.chat.routine.updated",
  deleted: "mobile.chat.routine.deleted",
} as const satisfies Record<RoutineConversationEventAction, MobileTextKey>;

function routineMarker(message: ConversationMessage) {
  const lifecycle = routineConversationEvent(message);
  if (lifecycle) {
    return {
      runId: null,
      routineId: lifecycle.routineId,
      event: lifecycle.action,
      label: ROUTINE_ACTION_LABELS[lifecycle.action],
      routineName: lifecycle.routineName,
    };
  }
  const run = routineRunConversationEvent(message);
  if (run)
    return {
      runId: run.runId,
      routineId: run.routineId,
      event: run.status,
      label: ROUTINE_RUN_LABELS[run.status],
      routineName: run.routineName,
    };
  if (message.routine)
    return {
      runId: message.routine.runId,
      routineId: message.routine.routineId,
      event: "queued" as const,
      label: ROUTINE_RUN_LABELS.queued,
      routineName: message.routine.name,
    };
  return null;
}

function latestRoutineRunMessages(messages: readonly ConversationMessage[]) {
  const latest = new Map<string, string>();
  for (const message of messages) {
    const runId = routineMarker(message)?.runId;
    if (runId) latest.set(runId, message.id);
  }
  return new Set(latest.values());
}

function projectRoutineMarker(message: ConversationMessage, latestRuns: ReadonlySet<string>): ChatMessage | null {
  const marker = routineMarker(message);
  if (!marker || (marker.runId && !latestRuns.has(message.id))) return null;
  return projectedMarker(projectedRoutines, message, () => ({
    id: `routine:${message.id}`,
    kind: "routine",
    event: marker.event,
    label: marker.label,
    routineId: marker.routineId,
    routineName: marker.routineName,
  }));
}
const aliasedMessages = new WeakMap<ChatMessage, ChatMessage>();

const PLAN_HEADING_LIMIT = 80;

function projectPlan(message: ConversationMessage, replaced: boolean): ChatMessage | null {
  if (message.author !== "assistant" || message.itemType !== CONVERSATION_PLAN_ITEM_TYPE) return null;
  const streaming = message.status === "streaming";
  const lastLine = message.text.lastIndexOf("\n");
  const plan =
    message.plan ??
    parseConversationPlanText(message.text) ??
    (streaming && lastLine > 0 ? parseConversationPlanText(message.text.slice(0, lastLine)) : null);
  if (!plan?.steps.length) return null;
  const steps = plan.steps.map((step) => {
    const state: ChatPlanStepState =
      step.status === "completed" ? "done" : step.status === "inProgress" && streaming ? "active" : "pending";
    return { id: step.id, text: state === "active" ? (step.activeText ?? step.text) : step.text, state };
  });
  const short = plan.explanation !== null && plan.explanation.length <= PLAN_HEADING_LIMIT;
  return {
    id: message.id,
    kind: "plan",
    heading: short ? plan.explanation : null,
    explanation: short ? null : plan.explanation,
    stopped:
      !replaced &&
      (message.status === "interrupted" || message.status === "failed") &&
      steps.some((step) => step.state !== "done"),
    steps,
  };
}

function projectSubagents(message: ConversationMessage): ChatMessage | null {
  if (message.author !== "assistant" || message.itemType !== CONVERSATION_SUBAGENTS_ITEM_TYPE) return null;
  if (!message.subagents?.length) return null;
  return { id: message.id, kind: "subagents", subagents: message.subagents };
}

function projectedMarker(
  cache: WeakMap<ConversationMessage, ChatMessage>,
  message: ConversationMessage,
  project: () => ChatMessage,
) {
  let item = cache.get(message);
  if (!item) {
    item = project();
    cache.set(message, item);
  }
  return item;
}

let lastOrder: { input: readonly ConversationMessage[]; order: number[] } | null = null;

function sameSortFields(before: ConversationMessage | undefined, after: ConversationMessage): boolean {
  if (before === after) return true;
  return (
    before !== undefined &&
    before.id === after.id &&
    before.turnId === after.turnId &&
    before.createdAt === after.createdAt &&
    before.author === after.author &&
    before.itemType === after.itemType &&
    before.exchange?.direction === after.exchange?.direction
  );
}

export function sortedConversationMessages(messages: readonly ConversationMessage[]) {
  const last = lastOrder;
  if (last && last.input.length === messages.length) {
    const { input } = last;
    if (messages.every((message, index) => sameSortFields(input[index], message))) {
      lastOrder = { input: messages, order: last.order };
      return last.order.flatMap((index) => messages[index] ?? []);
    }
  }
  const sorted = sortConversationMessages([...messages]);
  const indices = new Map(messages.map((message, index) => [message, index]));
  const order = sorted.flatMap((message) => indices.get(message) ?? []);
  lastOrder = order.length === messages.length && indices.size === messages.length ? { input: messages, order } : null;
  return sorted;
}

export function projectChatMessages(
  messages: ConversationMessage[],
  memberId: string | null = null,
  accountUserId: string | null = null,
  progressUpdates?: ProgressUpdates,
): ChatMessage[] {
  const reader = memberId || null;
  const readerAccount = accountUserId ? `local-user:${accountUserId}` : null;
  const readerKey = `${reader ?? ""}\n${readerAccount ?? ""}`;
  const result: ChatMessage[] = [];
  const thinkingByTurn = new Map<string, Extract<ChatMessage, { kind: "thinking" }>>();
  const sorted = sortedConversationMessages(messages);
  const latestRuns = latestRoutineRunMessages(sorted);
  const answered = progressUpdates ? answerTimes(sorted) : undefined;
  const shownNotes = turnShownNotes();
  const replacedIds = replacedConversationPlans(
    sorted.map((message) => ({
      id: message.id,
      turnId: message.turnId,
      agent:
        message.author === "assistant" && !message.exchange && !message.routine ? (message.senderAgentId ?? "") : null,
      plan: message.itemType === CONVERSATION_PLAN_ITEM_TYPE,
    })),
  );
  for (const message of sorted) {
    const routine = projectRoutineMarker(message, latestRuns);
    if (routine) result.push(routine);
    if (message.routine) continue;
    if (isContextResetMarker(message)) {
      result.push(
        projectedMarker(projectedResets, message, () => ({ id: `context-reset:${message.id}`, kind: "context-reset" })),
      );
      continue;
    }
    if (marketplaceSuggestionEvent(message)) {
      const appId = suggestedApp(message);
      if (appId)
        result.push(
          projectedMarker(projectedSuggestions, message, () => ({ id: message.id, kind: "app-suggestion", appId })),
        );
      continue;
    }
    const signIn = mcpSignInEvent(message);
    if (signIn) {
      result.push(
        projectedMarker(projectedSignIns, message, () => ({
          id: message.id,
          kind: "mcp-sign-in",
          mcpServerId: signIn.mcpServerId,
        })),
      );
      continue;
    }
    if (settingLinkMessage(message)) continue;
    if (message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE) continue;
    if (message.delivery?.status === "queued" || message.delivery?.status === "cancelled") continue;
    if (message.exchange) {
      const { exchange } = message;
      result.push(
        projectedMarker(projectedExchanges, message, () => ({
          id: `exchange:${message.id}`,
          kind: "exchange",
          exchange,
          standalone: exchange.direction === "incoming" && Boolean(message.attachments?.length),
        })),
      );
      if (message.exchange.direction !== "incoming" || !message.attachments?.length) continue;
    }
    if (message.questionPrompt) {
      const prompt = message.questionPrompt;
      result.push(
        projectedMarker(projectedQuestions, message, () => ({
          id: message.id,
          kind: "question",
          turnId: message.turnId,
          prompt,
          uiBlock: message.uiBlock,
        })),
      );
      continue;
    }
    if (
      message.author === "system" &&
      message.itemType === CONVERSATION_MEMORY_CHANGES_ITEM_TYPE &&
      message.memoryChanges?.length
    ) {
      const changes = message.memoryChanges;
      result.push(
        projectedMarker(projectedMemoryChanges, message, () => ({ id: message.id, kind: "memory-changes", changes })),
      );
      continue;
    }
    if (
      (!message.text.trim() && !message.attachments?.length && !message.imageGeneration && !message.videoGeneration) ||
      message.author === "system"
    )
      continue;
    if (message.author === "assistant" && message.itemType === "commentary") {
      const key = message.turnId ?? message.id;
      let thinking = thinkingByTurn.get(key);
      if (!thinking) {
        thinking = { id: thinkingRowId(key), kind: "thinking", turnId: message.turnId, steps: [] };
        thinkingByTurn.set(key, thinking);
        result.push(thinking);
      }
      const update =
        progressUpdates && answered
          ? beforeAnswer(message, answered) &&
            shownProgressUpdate(message, progressUpdates.provider(undefined), shownNotes(key))
          : false;
      thinking.steps.push({
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        ...(update ? { progress: true as const } : {}),
      });
      if (update) result.push(projectedMarker(projectedUpdates, message, () => progressBubble(message.id, message)));
    } else {
      const cached = projectedBubbles.get(message);
      const replaced = replacedIds.has(message.id);
      let bubble = cached?.readerKey === readerKey && cached.replaced === replaced ? cached.bubble : undefined;
      if (!bubble) {
        const sender = message.author === "user" ? message.senderMember : undefined;
        const ownSender = sender !== undefined && (sender.id === reader || sender.id === readerAccount);
        const otherMember = sender !== undefined && reader !== null && !ownSender;
        bubble = projectPlan(message, replaced) ??
          projectSubagents(message) ?? {
            id: message.id,
            kind: "message",
            author: message.author === "user" ? "user" : "agent",
            ...(otherMember ? { sender } : {}),
            ...(ownSender ? { mine: true } : {}),
            body: message.exchange ? "" : message.text,
            streaming: message.status === "streaming",
            status: message.status,
            attachments: message.attachments,
            ...visualReply(message),
            imageGeneration: message.imageGeneration,
            videoGeneration: message.videoGeneration,
            replyToMessageId: message.replyToMessageId,
            createdAt: message.createdAt,
            reactions: messageReactions(message),
          };
        projectedBubbles.set(message, { readerKey, replaced, bubble });
      }
      result.push(bubble);
    }
  }
  return progressUpdates ? withStepsAfterUpdates(result, thinkingByTurn) : result;
}

function withStepsAfterUpdates(
  rows: ChatMessage[],
  thinkingByTurn: ReadonlyMap<string, Extract<ChatMessage, { kind: "thinking" }>>,
): ChatMessage[] {
  const afterUpdate = new Map<string, ChatMessage>();
  const moved = new Set<ChatMessage>();
  for (const thinking of thinkingByTurn.values()) {
    const lastUpdate = thinking.steps.findLast((step) => step.progress)?.id;
    if (!lastUpdate) continue;
    afterUpdate.set(lastUpdate, thinking);
    moved.add(thinking);
  }
  if (moved.size === 0) return rows;
  const placed: ChatMessage[] = [];
  for (const row of rows) {
    if (moved.has(row)) continue;
    placed.push(row);
    const thinking = afterUpdate.get(row.id);
    if (thinking) placed.push(thinking);
  }
  return placed;
}

export function withQuestionContext(rows: ChatMessage[], activeTurnId: string | null | undefined): ChatMessage[] {
  if (!activeTurnId) return rows;
  const at = rows.findLastIndex(
    (row) => row.kind === "question" && !row.prompt.resolution && row.turnId === activeTurnId,
  );
  if (at < 0) return rows;
  const thinking = rows.findLast((row) => row.kind === "thinking" && row.turnId === activeTurnId);
  if (thinking?.kind !== "thinking") return rows;
  const step = thinking.steps.findLast((item) => item.text.trim() && isNarrationItemId(item.id, "codex"));
  if (!step || step.progress) return rows;
  const context: ChatBubbleMessage = {
    id: step.id,
    kind: "message",
    author: "agent",
    body: step.text,
    streaming: false,
    status: "completed",
    ...(step.createdAt ? { createdAt: step.createdAt } : {}),
    progress: true,
  };
  return [...rows.slice(0, at), context, ...rows.slice(at)];
}

const exchangeGroups = new WeakMap<ExchangeMarker, ExchangeGroup>();

export function groupExchangeMarkers<T extends ChatMessage>(messages: readonly T[]): (T | ExchangeGroup)[] {
  const rows: (T | ExchangeGroup)[] = [];
  let run: (T & ExchangeMarker)[] = [];
  const closeRun = () => {
    const [first] = run;
    if (first) rows.push(run.length === 1 ? first : exchangeGroup(first, run));
    run = [];
  };
  for (const message of messages) {
    if (groupableExchange(message)) {
      run.push(message);
      continue;
    }
    closeRun();
    rows.push(message);
  }
  closeRun();
  return rows;
}

export interface RoutineRunGroup {
  id: string;
  kind: "routine-run-group";
  routineName: string | null;
  runs: RoutineMarker[];
}

export type ChatMarkerGroup = ExchangeGroup | RoutineRunGroup;

type ChatRow = ChatMessage | ChatMarkerGroup;

function rowMarkers(row: ChatRow): readonly { id: string }[] {
  return row.kind === "exchange-group" ? row.exchanges : row.kind === "routine-run-group" ? row.runs : [row];
}

const routineRunGroups = new WeakMap<RoutineMarker, RoutineRunGroup>();
const routineRowIds = new Map<string, string>();

export interface RoutineRunGroupStops {
  unreadMessageIds?: ReadonlySet<string> | null;
  focusMessageId?: string | null;
  branchRowId?: string | null;
}

export function groupRoutineRunMarkers<T extends ChatRow>(
  rows: readonly T[],
  { unreadMessageIds = null, focusMessageId = null, branchRowId = null }: RoutineRunGroupStops = {},
): (T | RoutineRunGroup)[] {
  const starts = new Set<number>();
  if (unreadMessageIds) starts.add(firstChatRowOf(rows, unreadMessageIds));
  if (focusMessageId) {
    const focus = chatRowIndex(rows, focusMessageId);
    if (focus >= 0) starts.add(focus).add(focus + 1);
  }
  if (branchRowId) {
    const branch = chatRowHolding(rows, branchRowId);
    if (branch >= 0) starts.add(branch + 1);
  }
  const result: (T | RoutineRunGroup)[] = [];
  const markerIds = new Set(rows.flatMap((row) => (row.kind === "routine" ? [row.id] : [])));
  const usedIds = new Set<string>();
  let run: (T & RoutineMarker)[] = [];
  const closeRun = () => {
    const [first] = run;
    if (!first) return;
    const id = run.length === 1 ? first.id : routineRowId(first, run, markerIds, usedIds);
    usedIds.add(id);
    for (const marker of run) routineRowIds.set(marker.id, id);
    result.push(run.length === 1 ? first : routineRunGroup(id, first, run));
    run = [];
  };
  rows.forEach((row, index) => {
    if (!groupableRoutine(row)) {
      closeRun();
      result.push(row);
      return;
    }
    if (starts.has(index)) closeRun();
    run.push(row);
  });
  closeRun();
  return result;
}

const LIVE_ROUTINE_EVENTS: ReadonlySet<RoutineMarkerEvent> = new Set(["queued", "running", "needs-attention"]);

function groupableRoutine<T extends ChatRow>(row: T): row is T & RoutineMarker {
  return row.kind === "routine" && !LIVE_ROUTINE_EVENTS.has(row.event);
}

function routineRowId(
  first: RoutineMarker,
  run: readonly RoutineMarker[],
  markerIds: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
): string {
  for (const marker of run) {
    const id = routineRowIds.get(marker.id);
    if (id === undefined || usedIds.has(id)) continue;
    if (!markerIds.has(id) || run.some((item) => item.id === id)) return id;
  }
  return first.id;
}

function routineRunGroup(id: string, first: RoutineMarker, runs: RoutineMarker[]): RoutineRunGroup {
  const cached = routineRunGroups.get(first);
  if (
    cached?.id === id &&
    cached.runs.length === runs.length &&
    cached.runs.every((item, index) => item === runs[index])
  )
    return cached;
  const newest = runs.at(-1) ?? first;
  const group: RoutineRunGroup = {
    id,
    kind: "routine-run-group",
    routineName: runs.every((item) => item.routineId === first.routineId) ? newest.routineName : null,
    runs,
  };
  routineRunGroups.set(first, group);
  return group;
}

export function chatRowIndex(rows: readonly ChatRow[], messageId: string): number {
  const ids = new Set([messageId, `exchange:${messageId}`, `routine:${messageId}`, `context-reset:${messageId}`]);
  return rows.findIndex((row) => rowMarkers(row).some((marker) => ids.has(marker.id)));
}

export function chatRowHolding(rows: readonly ChatRow[], id: string): number {
  return rows.findIndex((row) => rowMarkers(row).some((marker) => marker.id === id));
}

const MARKER_ROW_PREFIX = /^(?:exchange|routine|context-reset):/u;

export function firstChatRowOf(rows: readonly ChatRow[], messageIds: ReadonlySet<string>): number {
  return rows.findIndex((row) =>
    rowMarkers(row).some((marker) => messageIds.has(marker.id.replace(MARKER_ROW_PREFIX, ""))),
  );
}

function groupableExchange<T extends ChatMessage>(message: T): message is T & ExchangeMarker {
  return message.kind === "exchange" && !message.standalone;
}

function exchangeGroup(first: ExchangeMarker, exchanges: ExchangeMarker[]): ExchangeGroup {
  const cached = exchangeGroups.get(first);
  if (
    cached?.exchanges.length === exchanges.length &&
    cached.exchanges.every((item, index) => item === exchanges[index])
  )
    return cached;
  const group: ExchangeGroup = { id: first.id, kind: "exchange-group", exchanges };
  exchangeGroups.set(first, group);
  return group;
}

const failedBubbles = new WeakMap<ChatMessage, ChatMessage>();

export function withFailureReasons(messages: ChatMessage[], deliveries: readonly QueueDelivery[]): ChatMessage[] {
  const reasons = new Map<string, string>();
  for (const delivery of deliveries) {
    if (delivery.status === "failed" && delivery.error) reasons.set(delivery.id, delivery.error);
  }
  if (reasons.size === 0) return messages;
  return messages.map((message) => {
    if (message.kind !== "message" || message.author !== "user" || message.status !== "failed") return message;
    const failureReason = reasons.get(message.id);
    if (!failureReason) return message;
    let failed = failedBubbles.get(message);
    if (failed?.kind !== "message" || failed.failureReason !== failureReason) {
      failed = { ...message, failureReason };
      failedBubbles.set(message, failed);
    }
    return failed;
  });
}

function visualReply(message: Parameters<typeof chatVisualReply>[0]): { visual?: { height?: number } } {
  const visual = chatVisualReply(message);
  if (!visual) return {};
  return { visual: visual.height === undefined ? {} : { height: visual.height } };
}

export function latestReadBoundaryMessage(messages: ConversationMessage[]) {
  return messages.findLast((message) => message.author !== "user" && itemTypeCountsAsUnread(message.itemType));
}

const projectedChannelMessages = new WeakMap<
  ChannelMessage,
  {
    self: boolean;
    latest: boolean;
    progress: boolean;
    replaced: boolean;
    run: RoutineRunStatus | null;
    localize: (text: string) => string;
    rows: readonly ChatMessage[];
  }
>();

function projectChannelMessage(
  entry: ChannelMessage,
  self: boolean,
  latestRuns: ReadonlySet<string>,
  progress: boolean,
  replaced: boolean,
  request: ReturnType<typeof channelRoutineRequest>,
  localize: (text: string) => string,
): ChatMessage | null {
  if (request)
    return {
      id: entry.id,
      kind: "routine",
      event: request.status,
      label: ROUTINE_RUN_LABELS[request.status],
      routineId: request.routineId,
      routineName: request.routineName,
    };
  const routine = routineMarker(entry.message);
  if (routine) {
    if (routine.runId && !latestRuns.has(entry.message.id)) return null;
    return {
      id: entry.id,
      kind: "routine",
      event: routine.event,
      label: routine.label,
      routineId: routine.routineId,
      routineName: routine.routineName,
    };
  }
  if (entry.message.questionPrompt) {
    return {
      id: entry.id,
      kind: "question",
      turnId: entry.message.turnId,
      uiBlock: entry.message.uiBlock,
      prompt:
        entry.superseded && !entry.message.questionPrompt.resolution
          ? { ...entry.message.questionPrompt, resolution: { status: "expired" } }
          : entry.message.questionPrompt,
    };
  }
  if (marketplaceSuggestionEvent(entry.message)) {
    const appId = suggestedApp(entry.message);
    return appId ? { id: entry.id, kind: "app-suggestion", appId } : null;
  }
  if (settingLinkMessage(entry.message)) return null;
  const routing = channelRoutingConversationEvent(entry.message);
  if (routing) return { id: entry.id, kind: "channel-routing", event: routing };
  if (
    !entry.message.itemType &&
    entry.author.kind === "agent" &&
    entry.message.author === "system" &&
    entry.message.status === "completed" &&
    entry.taskId
  ) {
    const assigned = /^Assigned to (.+)\.$/.exec(entry.message.text);
    const continued = /^Continuing existing work with (.+)\.$/.exec(entry.message.text);
    const name = assigned?.[1] ?? continued?.[1];
    if (name)
      return {
        id: entry.id,
        kind: "channel-routing",
        event: { action: assigned ? "assigned" : "continued", agentId: null, agentName: name },
      };
  }
  const plan = entry.author.kind === "agent" ? projectPlan(entry.message, replaced) : null;
  if (plan) return { ...plan, id: entry.id };
  if (entry.author.kind === "agent" && entry.message.itemType === "commentary" && !entry.superseded) {
    if (progress) return { ...progressBubble(entry.id, entry.message), speaker: entry.author };
    return {
      id: entry.id,
      kind: "thinking",
      turnId: entry.message.turnId,
      steps: [{ id: entry.id, text: entry.message.text }],
    };
  }
  return {
    id: entry.id,
    kind: "message",
    author: self ? "user" : "agent",
    ...(self ? { mine: true } : {}),
    speaker: entry.author,
    superseded: entry.superseded,
    body: coordinatorText(entry.author, entry.message.text, localize),
    streaming: entry.message.status === "streaming",
    status: entry.message.status,
    replyToMessageId: entry.message.replyToMessageId,
    attachments: entry.message.attachments,
    ...visualReply(entry.message),
    imageGeneration: entry.message.imageGeneration,
    videoGeneration: entry.message.videoGeneration,
    createdAt: entry.message.createdAt,
  };
}

export function projectChannelMessages(
  messages: ChannelMessage[],
  tasks: readonly ChannelTask[],
  memberId: string | null,
  localize: (text: string) => string,
  progressUpdates?: ProgressUpdates,
): ChatMessage[] {
  const latestRuns = latestRoutineRunMessages(messages.map((entry) => entry.message));
  const answered = progressUpdates ? answerTimes(messages.map((entry) => entry.message)) : undefined;
  const shownNotes = turnShownNotes();
  const replacedIds = replacedConversationPlans(
    messages.map((entry) => ({
      id: entry.id,
      turnId: entry.message.turnId,
      agent: entry.author.kind === "agent" && !entry.message.routine ? entry.author.id : null,
      plan: entry.message.itemType === CONVERSATION_PLAN_ITEM_TYPE,
    })),
  );
  const showsUpdate = (entry: ChannelMessage) =>
    Boolean(progressUpdates && answered) &&
    entry.author.kind === "agent" &&
    !entry.superseded &&
    entry.message.itemType === "commentary" &&
    (!answered || beforeAnswer(entry.message, answered)) &&
    shownProgressUpdate(
      entry.message,
      progressUpdates?.provider(entry.author.id),
      shownNotes(entry.message.turnId ?? entry.message.id),
    );
  return messages
    .filter(
      (entry) =>
        entry.message.questionPrompt ||
        entry.message.imageGeneration ||
        entry.message.videoGeneration ||
        entry.message.text.trim() ||
        entry.message.attachments?.length,
    )
    .flatMap((entry) => {
      const self = entry.author.kind === "member" && entry.author.id === memberId;
      const cached = projectedChannelMessages.get(entry);
      const latest = latestRuns.has(entry.message.id);
      const progress = showsUpdate(entry);
      const replaced = replacedIds.has(entry.id);
      const request = channelRoutineRequest(entry, tasks);
      const run = request?.status ?? null;
      if (
        cached &&
        cached.self === self &&
        cached.latest === latest &&
        cached.progress === progress &&
        cached.replaced === replaced &&
        cached.run === run &&
        cached.localize === localize
      )
        return cached.rows;
      const message = projectChannelMessage(entry, self, latestRuns, progress, replaced, request, localize);
      const rows: readonly ChatMessage[] = !message
        ? []
        : progress
          ? [
              message,
              {
                id: `${entry.id}:step`,
                kind: "thinking",
                turnId: entry.message.turnId,
                steps: [{ id: entry.id, text: entry.message.text, progress: true }],
              },
            ]
          : [message];
      projectedChannelMessages.set(entry, { self, latest, progress, replaced, run, localize, rows });
      return rows;
    });
}

export function keptIdSet(previous: ReadonlySet<string> | null, ids: readonly string[]): ReadonlySet<string> {
  if (previous && previous.size === ids.length && ids.every((id) => previous.has(id))) return previous;
  return new Set(ids);
}
