import type { ClientAgentSummary, ConversationMessage, QueueDeliveryStatus } from "@openbot/contracts/ipc";
import {
  CONVERSATION_MEMORY_CHANGES_ITEM_TYPE,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  hostedSiteConversationEvent,
  isChannelChangeMarker,
  isContextResetMarker,
  isPlanContinuationMarker,
  isVaultChangeMarker,
  marketplaceSuggestionEvent,
  mcpSignInEvent,
  modelSwitchReason,
  parseConversationPlanText,
  routineConversationEvent,
  routineRunConversationEvent,
  skillConversationEvent,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { cleanAgentMessageText } from "@openbot/team-client/agent-message-text";
import type {
  AgentDeliveryMarkerStatus,
  AgentMessage,
  AgentMessagePlan,
  AgentProfile,
  ChatActionMarkerModel,
} from "@openbot/ui/data";
import { formatChatTimestamp } from "@openbot/ui/features/conversation/chat-timestamp";
import type { TaskListItem } from "@openbot/ui/features/conversation/TaskList";
import { currentText } from "@openbot/ui/text";
import { isRoutineEventItem } from "./features/conversation/conversation-read-state";

export function toAgentProfile(stored: ClientAgentSummary): AgentProfile {
  return {
    id: stored.id,
    name: stored.name,
    title: stored.title,
    description: stored.description,
    notifications: stored.notifications,
    provider: stored.provider,
    model: stored.model,
    reasoningEffort: stored.reasoningEffort,
    ...(stored.providerAccountId === undefined ? {} : { providerAccountId: stored.providerAccountId }),
    ...(stored.access === undefined ? {} : { access: stored.access }),
    ...(stored.computerUse === undefined ? {} : { computerUse: stored.computerUse }),
    ...(stored.allowAutomation === undefined ? {} : { allowAutomation: stored.allowAutomation }),
    ...(stored.allowNewChat === undefined ? {} : { allowNewChat: stored.allowNewChat }),
    ...(stored.quickAcknowledgement === undefined ? {} : { quickAcknowledgement: stored.quickAcknowledgement }),
    ...(stored.fastMode === undefined ? {} : { fastMode: stored.fastMode }),
    ...(stored.ownBrowserSession === undefined ? {} : { ownBrowserSession: stored.ownBrowserSession }),
    ...(stored.browserProfileId === undefined ? {} : { browserProfileId: stored.browserProfileId }),
    ...(stored.busyMessageMode === undefined ? {} : { busyMessageMode: stored.busyMessageMode }),
    ...(stored.taskLimit === undefined ? {} : { taskLimit: stored.taskLimit }),
    ...(stored.backupModels === undefined ? {} : { backupModels: stored.backupModels }),
    ...(stored.additionalFolders === undefined ? {} : { additionalFolders: stored.additionalFolders }),
    ...(stored.excludedFolders === undefined ? {} : { excludedFolders: stored.excludedFolders }),
    ...(stored.usageLimitReturn === undefined ? {} : { usageLimitReturn: stored.usageLimitReturn }),
    ...(stored.pendingRuntime === undefined ? {} : { pendingRuntime: stored.pendingRuntime }),
    threadId: stored.threadId,
    workspacePath: stored.workspacePath,
    avatarSeed: stored.avatarSeed,
    avatarHue: stored.avatarHue,
    avatarUrl: stored.avatarUrl,
    ...(stored.marketplaceSource === undefined ? {} : { marketplaceSource: stored.marketplaceSource }),
    updatedAt: stored.updatedAt,
    time: stored.updatedAt ? formatTime(stored.updatedAt) : currentText().t("chat.day.now"),
    preview: cleanPreview(stored.preview),
  };
}

export function toAgentMessage(message: ConversationMessage, ownerAgentId?: string): AgentMessage {
  const exchangeSenderId = message.senderAgentId ?? message.exchange?.senderAgentId;
  const routineEvent = routineConversationEvent(message);
  const routineRunEvent = routineRunConversationEvent(message);
  const hostedSiteEvent = hostedSiteConversationEvent(message);
  const actionMarker = chatActionMarker(message, ownerAgentId, routineEvent, routineRunEvent, hostedSiteEvent);
  const plan = messagePlan(message);
  const subagents = message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE ? message.subagents : undefined;
  const memoryChanges = message.author === "system" && message.itemType === CONVERSATION_MEMORY_CHANGES_ITEM_TYPE;
  const senderMember = message.author === "user" ? message.senderMember : undefined;
  const status =
    message.exchange || message.routine
      ? undefined
      : message.delivery?.status === "queued"
        ? `Queued #${message.delivery.position}`
        : message.delivery?.status === "cancelled"
          ? "Cancelled"
          : message.status === "failed"
            ? "Failed"
            : message.status === "interrupted"
              ? "Stopped"
              : undefined;
  return {
    id: message.id,
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    author: message.author === "user" ? "you" : "agent",
    body: message.author === "user" ? message.text : cleanAgentMessageText(message.text),
    time: formatMessageTime(message.createdAt),
    createdAt: message.createdAt,
    streaming: message.status === "streaming",
    ...(message.itemType === undefined ? {} : { itemType: message.itemType }),
    kind: message.questionPrompt
      ? "question"
      : actionMarker
        ? "action-marker"
        : plan
          ? "plan"
          : subagents?.length
            ? "subagents"
            : memoryChanges
              ? "memory-changes"
              : "text",
    ...(exchangeSenderId === undefined ? {} : { senderAgentId: exchangeSenderId }),
    ...(senderMember === undefined ? {} : { senderMember }),
    ...(message.replyToMessageId === undefined ? {} : { replyToMessageId: message.replyToMessageId }),
    ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
    ...(message.voiceRecording === undefined ? {} : { voiceRecording: message.voiceRecording }),
    ...(message.imageGeneration === undefined ? {} : { imageGeneration: message.imageGeneration }),
    ...(message.questionPrompt === undefined ? {} : { questionPrompt: message.questionPrompt }),
    ...(message.uiBlock ? { uiBlock: message.uiBlock } : {}),
    ...(message.exchange === undefined ? {} : { exchange: message.exchange }),
    ...(message.reaction === undefined ? {} : { reaction: message.reaction }),
    reactions:
      message.reactions ?? (message.reaction ? [{ emoji: message.reaction, actor: { kind: "user" as const } }] : []),
    ...(message.routine === undefined ? {} : { routine: message.routine }),
    ...(actionMarker ? { actionMarker } : {}),
    ...(plan ? { plan } : {}),
    ...(subagents?.length ? { subagents } : {}),
    ...(memoryChanges && message.memoryChanges ? { memoryChanges: message.memoryChanges } : {}),
    ...(message.trace === undefined ? {} : { trace: message.trace }),
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * The plan of a `plan` message. A peer on a released Team API protocol sends only the checklist
 * text, so the plan is read back from it.
 */
function messagePlan(message: ConversationMessage): AgentMessagePlan | null {
  if (message.author !== "assistant" || message.itemType !== CONVERSATION_PLAN_ITEM_TYPE) return null;
  const plan = message.plan ?? parseConversationPlanText(message.text);
  if (!plan?.steps.length) return null;
  return { ...plan, stopped: message.status === "interrupted" || message.status === "failed" };
}

/**
 * The rows of a plan block. A step runs only while its turn runs: after the turn ends, a step that
 * was not finished shows as not started.
 */
export function planItems(plan: AgentMessagePlan, streaming: boolean): TaskListItem[] {
  return plan.steps.map((step) => {
    const state =
      step.status === "completed" ? "done" : step.status === "inProgress" && streaming ? "active" : "pending";
    return { id: step.id, label: state === "active" ? (step.activeText ?? step.text) : step.text, state };
  });
}

const PLAN_TITLE_LIMIT = 80;

/** The header of a plan block: a short explanation, else "Tasks", or "Stopped" for a stopped plan. */
export function planTitle(plan: AgentMessagePlan): string {
  const { t } = currentText();
  if (plan.stopped && plan.steps.some((step) => step.status !== "completed")) return t("chat.taskList.stopped");
  if (plan.explanation && plan.explanation.length <= PLAN_TITLE_LIMIT) return plan.explanation;
  return t("chat.taskList.title");
}

/**
 * The chat rows of stored messages. `convert` gives the row of the message at an index; a caller
 * that keeps the rows of unchanged messages passes it.
 */
export function toAgentMessages(
  messages: readonly ConversationMessage[],
  ownerAgentId?: string,
  convert: (message: ConversationMessage, index: number) => AgentMessage = (message) =>
    toAgentMessage(message, ownerAgentId),
): AgentMessage[] {
  const result: AgentMessage[] = [];
  const thinkingByTurn = new Map<string, AgentMessage>();
  for (const [index, message] of messages.entries()) {
    if ((message.delivery?.status === "queued" || message.delivery?.status === "cancelled") && !message.routine) {
      continue;
    }
    if (message.author !== "assistant" || message.itemType !== "commentary") {
      result.push(convert(message, index));
      continue;
    }

    const key = message.turnId ?? message.id;
    const existing = thinkingByTurn.get(key);
    if (existing) {
      const text = cleanAgentMessageText(message.text);
      existing.items = [...(existing.items ?? []), text];
      existing.itemIds = [...(existing.itemIds ?? []), message.id];
      existing.itemCreatedAt = [...(existing.itemCreatedAt ?? []), message.createdAt];
      existing.streaming = existing.streaming || message.status === "streaming";
      if (message.trace) existing.trace = message.trace;
      continue;
    }

    const text = cleanAgentMessageText(message.text);
    const thinking: AgentMessage = {
      id: `thinking:${key}`,
      ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
      author: "agent",
      body: "",
      time: formatMessageTime(message.createdAt),
      createdAt: message.createdAt,
      streaming: message.status === "streaming",
      itemType: "commentary",
      kind: "thinking",
      items: [text],
      itemIds: [message.id],
      itemCreatedAt: [message.createdAt],
      ...(message.trace === undefined ? {} : { trace: message.trace }),
    };
    thinkingByTurn.set(key, thinking);
    result.push(thinking);
  }
  return result;
}

export function agentProfilesEqual(left: AgentProfile, right: AgentProfile): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.title === right.title &&
    left.description === right.description &&
    left.notifications === right.notifications &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    left.providerAccountId === right.providerAccountId &&
    JSON.stringify(left.backupModels) === JSON.stringify(right.backupModels) &&
    (left.additionalFolders ?? []).join("\n") === (right.additionalFolders ?? []).join("\n") &&
    (left.excludedFolders ?? []).join("\n") === (right.excludedFolders ?? []).join("\n") &&
    JSON.stringify(left.usageLimitReturn) === JSON.stringify(right.usageLimitReturn) &&
    JSON.stringify(left.pendingRuntime) === JSON.stringify(right.pendingRuntime) &&
    left.access === right.access &&
    left.computerUse === right.computerUse &&
    left.allowAutomation === right.allowAutomation &&
    left.allowNewChat === right.allowNewChat &&
    left.quickAcknowledgement === right.quickAcknowledgement &&
    left.fastMode === right.fastMode &&
    left.ownBrowserSession === right.ownBrowserSession &&
    left.browserProfileId === right.browserProfileId &&
    left.busyMessageMode === right.busyMessageMode &&
    left.taskLimit === right.taskLimit &&
    left.threadId === right.threadId &&
    left.avatarSeed === right.avatarSeed &&
    left.avatarHue === right.avatarHue &&
    left.avatarUrl === right.avatarUrl &&
    marketplaceSourcesEqual(left.marketplaceSource, right.marketplaceSource) &&
    left.updatedAt === right.updatedAt &&
    left.time === right.time &&
    left.preview === right.preview
  );
}

function marketplaceSourcesEqual(
  left: AgentProfile["marketplaceSource"],
  right: AgentProfile["marketplaceSource"],
): boolean {
  if (!left || !right) return left === right;
  return (
    left.listingId === right.listingId &&
    left.versionId === right.versionId &&
    left.version === right.version &&
    stringArraysEqual(left.skillIds, right.skillIds) &&
    stringArraysEqual(left.routineIds, right.routineIds)
  );
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function agentMessagesEqual(left: AgentMessage, right: AgentMessage): boolean {
  return (
    left.id === right.id &&
    left.turnId === right.turnId &&
    left.author === right.author &&
    left.body === right.body &&
    left.time === right.time &&
    left.kind === right.kind &&
    left.streaming === right.streaming &&
    left.itemType === right.itemType &&
    left.status === right.status &&
    left.senderAgentId === right.senderAgentId &&
    left.senderMember?.id === right.senderMember?.id &&
    left.senderMember?.name === right.senderMember?.name &&
    left.replyToMessageId === right.replyToMessageId &&
    left.reaction === right.reaction &&
    JSON.stringify(left.reactions) === JSON.stringify(right.reactions) &&
    JSON.stringify(left.reactionSummary) === JSON.stringify(right.reactionSummary) &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments) &&
    JSON.stringify(left.questionPrompt) === JSON.stringify(right.questionPrompt) &&
    JSON.stringify(left.exchange) === JSON.stringify(right.exchange) &&
    JSON.stringify(left.routine) === JSON.stringify(right.routine) &&
    JSON.stringify(left.actionMarker) === JSON.stringify(right.actionMarker) &&
    JSON.stringify(left.items) === JSON.stringify(right.items) &&
    JSON.stringify(left.itemIds) === JSON.stringify(right.itemIds) &&
    JSON.stringify(left.plan) === JSON.stringify(right.plan) &&
    JSON.stringify(left.subagents) === JSON.stringify(right.subagents)
  );
}

function chatActionMarker(
  message: ConversationMessage,
  ownerAgentId: string | undefined,
  routineEvent: ReturnType<typeof routineConversationEvent>,
  routineRunEvent: ReturnType<typeof routineRunConversationEvent>,
  hostedSiteEvent: ReturnType<typeof hostedSiteConversationEvent>,
): ChatActionMarkerModel | null {
  if (message.exchange) {
    const targetDeliveries = message.exchange.deliveries.map((delivery) => ({
      agentId: delivery.recipientAgentId,
      status: delivery.status,
    }));
    const status =
      message.exchange.direction === "incoming"
        ? deliveryStatus(message.delivery?.status ?? targetDeliveries[0]?.status)
        : aggregateDeliveryStatus(targetDeliveries.map((delivery) => delivery.status));
    return {
      kind: "agent-message",
      direction: message.exchange.direction,
      sourceAgentId: message.exchange.senderAgentId,
      targetDeliveries,
      status,
      timestamp: message.createdAt,
      messageId: message.exchange.messageId,
      replyToMessageId: message.exchange.replyToMessageId,
      expectsReply: message.exchange.expectsReply !== false,
    };
  }
  if (isContextResetMarker(message)) return { kind: "context-reset", timestamp: message.createdAt };
  const switchReason = modelSwitchReason(message);
  if (switchReason)
    return { kind: "model-switch", reason: switchReason, text: message.text, timestamp: message.createdAt };
  if (isChannelChangeMarker(message))
    return { kind: "channel-change", text: message.text, timestamp: message.createdAt };
  if (isVaultChangeMarker(message)) return { kind: "vault-change", text: message.text, timestamp: message.createdAt };
  if (isPlanContinuationMarker(message))
    return { kind: "plan-continuation", text: message.text, timestamp: message.createdAt };
  const skillEvent = skillConversationEvent(message);
  if (skillEvent) return { ...skillEvent, kind: "skill-lifecycle", timestamp: message.createdAt };
  const suggestion = marketplaceSuggestionEvent(message);
  if (suggestion) return { kind: "marketplace-suggestion", appId: suggestion.appId, timestamp: message.createdAt };
  const signIn = mcpSignInEvent(message);
  if (signIn) return { kind: "mcp-sign-in", mcpServerId: signIn.mcpServerId, timestamp: message.createdAt };
  if (routineEvent) {
    return {
      kind: "routine-lifecycle",
      action: routineEvent.action,
      sourceAgentId: ownerAgentId ?? null,
      routineId: routineEvent.routineId,
      routineName: routineEvent.routineName,
      status: "completed",
      timestamp: message.createdAt,
    };
  }
  if (routineRunEvent) {
    return {
      kind: "routine-run",
      sourceAgentId: ownerAgentId ?? null,
      routineId: routineRunEvent.routineId,
      runId: routineRunEvent.runId,
      routineName: routineRunEvent.routineName,
      status: routineRunEvent.status,
      timestamp: message.createdAt,
    };
  }
  if (message.routine) {
    return {
      kind: "routine-run",
      sourceAgentId: ownerAgentId ?? null,
      routineId: message.routine.routineId,
      runId: message.routine.runId,
      routineName: message.routine.name,
      status: "queued",
      timestamp: message.createdAt,
    };
  }
  if (hostedSiteEvent) {
    return {
      kind: "hosted-site",
      sourceAgentId: ownerAgentId ?? null,
      action: hostedSiteEvent.action,
      status: hostedSiteEvent.status,
      operationId: hostedSiteEvent.operationId,
      siteId: hostedSiteEvent.siteId,
      title: hostedSiteEvent.title,
      hostname: hostedSiteEvent.hostname,
      url: hostedSiteEvent.url,
      timestamp: message.createdAt,
    };
  }
  if (isRoutineEventItem(message)) {
    return { kind: "unavailable", label: currentText().t("app.action.unavailable"), timestamp: message.createdAt };
  }
  return null;
}

function aggregateDeliveryStatus(statuses: QueueDeliveryStatus[]): AgentDeliveryMarkerStatus {
  if (statuses.length === 0) return "unavailable";
  const normalized = statuses.map(deliveryStatus);
  if (normalized.every((status) => status === "queued")) return "queued";
  if (normalized.some((status) => status === "in-progress")) return "in-progress";
  if (normalized.every((status) => status === "completed")) return "completed";
  if (normalized.every((status) => status === "failed")) return "failed";
  if (normalized.every((status) => status === "interrupted")) return "interrupted";
  if (normalized.every((status) => status === "cancelled")) return "cancelled";
  if (normalized.every((status) => ["completed", "failed", "interrupted", "cancelled"].includes(status))) {
    return "partial";
  }
  return "in-progress";
}

function deliveryStatus(status: QueueDeliveryStatus | undefined): Exclude<AgentDeliveryMarkerStatus, "partial"> {
  if (!status) return "unavailable";
  if (status === "starting" || status === "running") return "in-progress";
  return status;
}

export function retainThinkingMessages(previous: AgentMessage[], next: AgentMessage[]): AgentMessage[] {
  const result = [...next];
  const nextIds = new Set(result.map((message) => message.id));
  for (const thinking of previous) {
    if (thinking.kind !== "thinking" || nextIds.has(thinking.id) || !thinking.turnId) continue;
    const sameTurnIndexes = result.flatMap((message, index) => (message.turnId === thinking.turnId ? [index] : []));
    if (sameTurnIndexes.length === 0) continue;
    const finalAnswerIndex = result.findIndex(
      (message) => message.turnId === thinking.turnId && message.author === "agent" && message.kind !== "thinking",
    );
    const insertionIndex = finalAnswerIndex >= 0 ? finalAnswerIndex : (sameTurnIndexes.at(-1) ?? result.length - 1) + 1;
    result.splice(insertionIndex, 0, { ...thinking, streaming: false });
    nextIds.add(thinking.id);
  }
  return result;
}

export function withoutAgent<T>(values: Record<string, T>, agentId: string): Record<string, T> {
  const next = { ...values };
  delete next[agentId];
  return next;
}

function cleanPreview(preview: string): string {
  // The stored preview is the start of the message as written, Markdown and all.
  const cleaned = markdownPreviewText(cleanAgentMessageText(preview))
    .replace(/\binbox\s+at\s+zero\b[:,]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || currentText().t("app.agent.noMessages");
}

function formatTime(value: string): string {
  const date = new Date(value);
  const { t, format } = currentText();
  if (Number.isNaN(date.getTime())) return t("chat.day.now");
  return format.date(date, { hour: "2-digit", minute: "2-digit" });
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  const { t, format } = currentText();
  if (Number.isNaN(date.getTime())) return t("chat.day.now");
  return formatChatTimestamp(date, format);
}
