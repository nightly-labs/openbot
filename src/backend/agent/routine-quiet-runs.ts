import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { isNarrationItemId, showsNarration } from "@openbot/contracts/conversation-narration";
import {
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  type ConversationSnapshot,
  type ConversationTurnTrace,
  type QueueDelivery,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type RoutineRun,
  routineQuietStepsItemId,
} from "@openbot/contracts/ipc";
import { bridgedToolName, getString, type ThreadItem } from "../protocol";

export const ROUTINE_NO_UPDATE_MARKER = "[[no-update]]";

const HERMES_SILENT_MARKER = "[silent]";

export const ROUTINE_NO_UPDATE_TOOL = "routine_no_update";

export const ROUTINE_REPORT_FAILURE_TOOL = "routine_report_failure";

export function isNoUpdateToolCall(item: ThreadItem): boolean {
  if (bridgedToolName(item) === `openbot.${ROUTINE_NO_UPDATE_TOOL}`) return true;
  if (item.type === "toolCall") return getString(item, "name") === `mcp__openbot__${ROUTINE_NO_UPDATE_TOOL}`;
  return (
    (item.type === "dynamicToolCall" || item.type === "mcpToolCall") &&
    getString(item, "tool") === ROUTINE_NO_UPDATE_TOOL
  );
}

export function quietRoutineRun(run: Pick<RoutineRun, "kind" | "source">): boolean {
  return run.kind === "scheduled" || run.source === "script" || run.source === "webhook";
}

export type FollowsUpOwnAnswer = (delivery: QueueDelivery) => boolean;

function newTeammateMessage(delivery: QueueDelivery, followsUpOwnAnswer: FollowsUpOwnAnswer): boolean {
  return (
    delivery.sender.kind === "agent" &&
    delivery.sender.agentId !== delivery.recipientAgentId &&
    (!delivery.replyToMessageId || followsUpOwnAnswer(delivery))
  );
}

export function quietTeammateDelivery(delivery: QueueDelivery, followsUpOwnAnswer: FollowsUpOwnAnswer): boolean {
  return delivery.expectsReply === false && newTeammateMessage(delivery, followsUpOwnAnswer);
}

export function answeredRequestId(delivery: QueueDelivery): string | null {
  return delivery.sender.kind === "agent" &&
    delivery.sender.agentId !== delivery.recipientAgentId &&
    delivery.expectsReply === false &&
    delivery.replyToMessageId
    ? delivery.replyToMessageId
    : null;
}

export function teammateRequest(delivery: QueueDelivery, followsUpOwnAnswer: FollowsUpOwnAnswer): boolean {
  return delivery.expectsReply !== false && newTeammateMessage(delivery, followsUpOwnAnswer);
}

export function quietTeammateTurnDelivery(
  delivery: QueueDelivery,
  answered: (delivery: QueueDelivery) => boolean,
  followsUpOwnAnswer: FollowsUpOwnAnswer,
): boolean {
  return (
    quietTeammateDelivery(delivery, followsUpOwnAnswer) ||
    (teammateRequest(delivery, followsUpOwnAnswer) && answered(delivery))
  );
}

export function isNoUpdateAnswer(text: string): boolean {
  const answer = text.trim();
  return answer === ROUTINE_NO_UPDATE_MARKER || answer.toLowerCase() === HERMES_SILENT_MARKER;
}

export function settleQuietRoutineTurn(
  snapshot: ConversationSnapshot,
  turnId: string,
  noUpdateCalled: boolean,
  provider: AgentProviderRef | undefined,
): boolean {
  const turnMessages = snapshot.messages.filter(
    (message) => message.author === "assistant" && message.turnId === turnId,
  );
  const markers = new Set(
    turnMessages.filter((message) => isTextAnswer(message) && (noUpdateCalled || isNoUpdateAnswer(message.text))),
  );
  if (markers.size === 0 && !noUpdateCalled) return false;
  const reported = turnMessages.some(
    (message) => !markers.has(message) && !isWorkNote(message) && carriesContent(message),
  );
  const narration = quietNarration(provider);
  const dropped = reported
    ? markers
    : new Set(turnMessages.filter((message) => !keptQuietAnswer(message) && !narration(message)));
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message) continue;
    if (dropped.has(message)) snapshot.messages.splice(index, 1);
    else if (!reported && message.turnId === turnId && message.author === "assistant") {
      snapshot.messages[index] = { ...message, itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE };
    }
  }
  return !reported;
}

export function quietRunStepsMessage(
  turnId: string,
  trace: ConversationTurnTrace,
  noUpdateSteps: ReadonlySet<string> = new Set(),
): ConversationMessage | null {
  if (!trace.steps.some((step) => step.kind === "tool" && step.text?.trim() && !noUpdateSteps.has(step.id)))
    return null;
  return {
    id: routineQuietStepsItemId(turnId),
    turnId,
    author: "assistant",
    itemType: "commentary",
    text: "",
    createdAt: trace.startedAt,
    status: "completed",
  };
}

export function quietNarration(provider: AgentProviderRef | undefined): (message: ConversationMessage) => boolean {
  const shown = new Set<string>();
  return (message) =>
    message.author === "assistant" &&
    message.itemType === "commentary" &&
    isNarrationItemId(message.id, provider) &&
    !isNoUpdateAnswer(message.text) &&
    showsNarration(message.text, shown);
}

export function settleQuietChannelTurn(snapshot: ConversationSnapshot, turnId: string): boolean {
  const answers = new Set(
    snapshot.messages.filter(
      (message) => message.author === "assistant" && message.turnId === turnId && !isWorkNote(message),
    ),
  );
  if ([...answers].some((message) => !isTextAnswer(message))) return false;
  for (const [index, message] of snapshot.messages.entries()) {
    if (answers.has(message)) snapshot.messages[index] = { ...message, itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE };
  }
  return true;
}

export function writesNoAnswer(snapshot: ConversationSnapshot, turnId: string): boolean {
  return snapshot.messages.every(
    (message) =>
      message.author !== "assistant" ||
      message.turnId !== turnId ||
      isWorkNote(message) ||
      (isTextAnswer(message) && !keptQuietAnswer(message)),
  );
}

export function keptQuietAnswer(message: ConversationMessage): boolean {
  return isTextAnswer(message) && message.text.trim() !== "" && !isNoUpdateAnswer(message.text);
}

export function isTextAnswer(message: ConversationMessage): boolean {
  return (
    !isWorkNote(message) &&
    message.itemType !== "question_prompt" &&
    !message.attachments?.length &&
    !message.imageGeneration &&
    !message.videoGeneration
  );
}

function isWorkNote(message: ConversationMessage): boolean {
  return (
    message.itemType === "commentary" ||
    message.itemType === CONVERSATION_PLAN_ITEM_TYPE ||
    message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE
  );
}

function carriesContent(message: ConversationMessage): boolean {
  return (
    message.itemType === "question_prompt" ||
    message.text.trim() !== "" ||
    Boolean(message.attachments?.length) ||
    Boolean(message.imageGeneration) ||
    Boolean(message.videoGeneration)
  );
}
