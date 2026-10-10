import emojiRegex from "emoji-regex";

import { INPUT_LIMITS } from "./input-limits";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isBoundedString, isIdentifier, isRequestId } from "./ipc-bounded-values";
import { CONVERSATION_PLAN_ITEM_TYPE, type ConversationPlan, isConversationPlan } from "./ipc-conversation-plan";
import { QUEUE_DELIVERY_STATUSES, type QueueDelivery } from "./ipc-queue";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type ConversationMessageAuthor = "user" | "assistant" | "agent" | "system";

export const IMAGE_GENERATION_ASPECT_RATIOS = ["square", "portrait", "landscape"] as const;
export type ImageGenerationAspectRatio = (typeof IMAGE_GENERATION_ASPECT_RATIOS)[number];

export interface ImageGenerationInfo {
  prompt?: string;
  resolution: string;
  aspectRatio: ImageGenerationAspectRatio;
  error?: string;
}

export function isImageGenerationAspectRatio(value: unknown): value is ImageGenerationAspectRatio {
  return isOneOf(IMAGE_GENERATION_ASPECT_RATIOS, value);
}

export function isImageGenerationInfo(value: unknown): value is ImageGenerationInfo {
  return (
    isDynamicRecord(value) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    isString(value.resolution) &&
    isImageGenerationAspectRatio(value.aspectRatio) &&
    (value.error === undefined || isString(value.error))
  );
}

export interface AgentPromptQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
}

export function isAgentPromptQuestion(value: unknown): value is AgentPromptQuestion {
  if (!isDynamicRecord(value)) return false;
  return (
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.header, INPUT_LIMITS.promptHeader) &&
    isBoundedString(value.question, INPUT_LIMITS.promptQuestion) &&
    isBoolean(value.isSecret) &&
    (value.options === null ||
      (Array.isArray(value.options) &&
        value.options.length <= INPUT_LIMITS.promptOptions &&
        value.options.every(
          (option) =>
            isDynamicRecord(option) &&
            isBoundedString(option.label, INPUT_LIMITS.promptOptionLabel) &&
            isBoundedString(option.description, INPUT_LIMITS.promptOptionDescription),
        )))
  );
}

export type AgentPromptQuestionResolution = { status: "answered"; answers?: string[] } | { status: "skipped" };

export type AgentPromptResolution =
  | { status: "answered"; responses: Record<string, AgentPromptQuestionResolution> }
  | { status: "cancelled" }
  | { status: "expired" };

function isAgentPromptResolution(value: unknown): value is AgentPromptResolution {
  if (!isDynamicRecord(value)) return false;
  if (value.status === "cancelled" || value.status === "expired") return true;
  if (value.status !== "answered" || !isDynamicRecord(value.responses)) return false;
  return Object.values(value.responses).every(
    (response) =>
      isDynamicRecord(response) &&
      (response.status === "skipped" ||
        (response.status === "answered" &&
          (response.answers === undefined || (Array.isArray(response.answers) && response.answers.every(isString))))),
  );
}

export interface ConversationQuestionPrompt {
  requestId: string | number;
  questions: AgentPromptQuestion[];
  resolution: AgentPromptResolution | null;
}

function isConversationQuestionPrompt(value: unknown): value is ConversationQuestionPrompt {
  if (!isDynamicRecord(value)) return false;
  return (
    isRequestId(value.requestId) &&
    Array.isArray(value.questions) &&
    value.questions.length <= INPUT_LIMITS.promptQuestions &&
    value.questions.every(isAgentPromptQuestion) &&
    (value.resolution === null || isAgentPromptResolution(value.resolution))
  );
}

export const MESSAGE_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;
export const MORE_MESSAGE_REACTIONS = ["🔥", "👏", "🙏", "🤔", "👀", "✅", "🚀", "💯"] as const;
export type MessageReaction = string;

export type ConversationReactionActor = { kind: "user" } | { kind: "agent"; agentId: string };

export interface ConversationReaction {
  emoji: MessageReaction;
  actor: ConversationReactionActor;
}

const RGI_EMOJI_PATTERN = emojiRegex();

export function isMessageReaction(value: unknown): value is MessageReaction {
  if (!isString(value)) return false;
  const matches = value.match(RGI_EMOJI_PATTERN);
  return matches?.length === 1 && matches[0] === value;
}

export function isConversationReaction(value: unknown): value is ConversationReaction {
  if (!isDynamicRecord(value) || !isMessageReaction(value.emoji) || !isDynamicRecord(value.actor)) return false;
  return (
    value.actor.kind === "user" ||
    (value.actor.kind === "agent" && isString(value.actor.agentId) && value.actor.agentId.length > 0)
  );
}

export interface AgentExchangeSummary {
  direction: "incoming" | "outgoing";
  messageId: string;
  senderAgentId: string;
  recipientAgentIds: string[];
  replyToMessageId: string | null;
  deliveries: Array<Pick<QueueDelivery, "id" | "recipientAgentId" | "status" | "position" | "error">>;
  /** Absent means the sender waits for an answer. See `QueueDelivery.expectsReply`. */
  expectsReply?: boolean;
}

function isAgentExchangeSummary(value: unknown): value is AgentExchangeSummary {
  return (
    isDynamicRecord(value) &&
    isOneOf(["incoming", "outgoing"] as const, value.direction) &&
    isIdentifier(value.messageId) &&
    isIdentifier(value.senderAgentId) &&
    Array.isArray(value.recipientAgentIds) &&
    value.recipientAgentIds.length <= INPUT_LIMITS.messageRecipients &&
    value.recipientAgentIds.every(isIdentifier) &&
    (value.replyToMessageId === null || isIdentifier(value.replyToMessageId)) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.length <= INPUT_LIMITS.messageRecipients &&
    value.deliveries.every(
      (delivery) =>
        isDynamicRecord(delivery) &&
        isIdentifier(delivery.id) &&
        isIdentifier(delivery.recipientAgentId) &&
        isOneOf(QUEUE_DELIVERY_STATUSES, delivery.status) &&
        (delivery.position === null ||
          (isNumber(delivery.position) && Number.isInteger(delivery.position) && delivery.position >= 1)) &&
        (delivery.error === null || isBoundedString(delivery.error, INPUT_LIMITS.messageText)),
    ) &&
    (value.expectsReply === undefined || isBoolean(value.expectsReply))
  );
}

/**
 * The person who wrote a user message, as the host saw them when it arrived. The host stamps it;
 * the sender never names itself. `name` is the name at send time, for a member who has since left.
 */
export interface ConversationMessageSender {
  id: string;
  name: string;
}

export function isConversationMessageSender(value: unknown): value is ConversationMessageSender {
  return isDynamicRecord(value) && isIdentifier(value.id) && isBoundedString(value.name, INPUT_LIMITS.accountName);
}

/** The sender the host stamps, with the name cut to the bound every reader checks. */
export function conversationMessageSender(id: string, name: string): ConversationMessageSender | undefined {
  return isIdentifier(id) ? { id, name: name.slice(0, INPUT_LIMITS.accountName) } : undefined;
}

export interface ConversationMessage {
  /**
   * Local host watermark for the latest hidden-to-visible cycle. This is a transactional
   * revision lower bound, not an event id. Released Team API projections omit it.
   */
  visibilityEpoch?: number;
  /** Local provenance for this visibility cycle; released projections omit it. */
  visibilityKind?: "created" | "revealed";
  id: string;
  turnId?: string;
  author: ConversationMessageAuthor;
  text: string;
  createdAt: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
  itemType?: string;
  source?: "user" | "assistant" | "agent" | "system" | "routine";
  senderAgentId?: string;
  /** Absent on a message from before senders were kept, and on one from an older host. */
  senderMember?: ConversationMessageSender;
  replyToMessageId?: string | null;
  attachments?: AttachmentSummary[];
  imageGeneration?: ImageGenerationInfo;
  delivery?: Pick<QueueDelivery, "id" | "status" | "position">;
  exchange?: AgentExchangeSummary;
  reaction?: MessageReaction | null;
  reactions?: ConversationReaction[];
  routine?: {
    routineId: string;
    runId: string;
    name: string;
    scheduledFor: string;
  };
  questionPrompt?: ConversationQuestionPrompt;
  /** Set on the one `plan` message of a turn. The text holds the same plan as a checklist. */
  plan?: ConversationPlan;
}

export function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!isDynamicRecord(value)) return false;
  const author = value.author;
  const status = value.status;
  return (
    isIdentifier(value.id) &&
    (value.visibilityEpoch === undefined ||
      (isNumber(value.visibilityEpoch) && Number.isSafeInteger(value.visibilityEpoch) && value.visibilityEpoch > 0)) &&
    (value.visibilityKind === undefined ||
      (value.visibilityEpoch !== undefined &&
        (value.visibilityKind === "created" || value.visibilityKind === "revealed"))) &&
    isString(value.text) &&
    isBoundedString(value.createdAt, 160) &&
    (author === "user" || author === "assistant" || author === "agent" || author === "system") &&
    (status === "streaming" || status === "completed" || status === "failed" || status === "interrupted") &&
    (value.turnId === undefined || isIdentifier(value.turnId)) &&
    (value.itemType === undefined || isBoundedString(value.itemType, INPUT_LIMITS.identifier)) &&
    (value.source === undefined ||
      value.source === "user" ||
      value.source === "assistant" ||
      value.source === "agent" ||
      value.source === "system" ||
      value.source === "routine") &&
    (value.senderAgentId === undefined || isIdentifier(value.senderAgentId)) &&
    (value.senderMember === undefined || isConversationMessageSender(value.senderMember)) &&
    (value.replyToMessageId === undefined || value.replyToMessageId === null || isIdentifier(value.replyToMessageId)) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.length <= INPUT_LIMITS.attachments &&
        value.attachments.every(isAttachmentSummary))) &&
    (value.delivery === undefined || isConversationDelivery(value.delivery)) &&
    (value.exchange === undefined || isAgentExchangeSummary(value.exchange)) &&
    (value.reaction === undefined || value.reaction === null || isMessageReaction(value.reaction)) &&
    (value.reactions === undefined ||
      (Array.isArray(value.reactions) &&
        value.reactions.length <= INPUT_LIMITS.teamMembers &&
        value.reactions.every(isConversationReaction))) &&
    (value.routine === undefined ||
      (isDynamicRecord(value.routine) &&
        isIdentifier(value.routine.routineId) &&
        isIdentifier(value.routine.runId) &&
        isBoundedString(value.routine.name, INPUT_LIMITS.routineName) &&
        isBoundedString(value.routine.scheduledFor, 160))) &&
    (value.imageGeneration === undefined || isImageGenerationInfo(value.imageGeneration)) &&
    (value.questionPrompt === undefined || isConversationQuestionPrompt(value.questionPrompt)) &&
    (value.plan === undefined || isConversationPlan(value.plan))
  );
}

/** Queue and cancellation projection; routine cards remain visible in both states. */
export function isConversationMessageVisible(message: ConversationMessage): boolean {
  return (
    message.routine !== undefined || (message.delivery?.status !== "queued" && message.delivery?.status !== "cancelled")
  );
}

function isConversationDelivery(value: unknown): boolean {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(QUEUE_DELIVERY_STATUSES, value.status) &&
    (value.position === null || (isNumber(value.position) && Number.isInteger(value.position) && value.position >= 1))
  );
}

/** A visibility cohort alone does not admit ordinary history before a page boundary. */
export function isConversationVisibilityAfter(
  message: { visibilityEpoch?: number; visibilityKind?: ConversationMessage["visibilityKind"] },
  floor: number | undefined,
): boolean {
  return (
    floor !== undefined &&
    message.visibilityEpoch !== undefined &&
    (message.visibilityEpoch > floor || (message.visibilityEpoch === floor && message.visibilityKind === "revealed"))
  );
}

/**
 * The answer an agent gave in one turn: its last message of that turn that says something to the
 * reader. Commentary, a question prompt and a plan are not the answer.
 */
export function latestTurnAnswer(
  messages: readonly ConversationMessage[],
  turnId: string,
): ConversationMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.author === "assistant" &&
        message.turnId === turnId &&
        message.itemType !== "commentary" &&
        message.itemType !== "question_prompt" &&
        message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
        message.text.trim(),
    );
}
