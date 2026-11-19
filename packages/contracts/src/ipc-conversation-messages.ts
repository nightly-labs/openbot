import emojiRegex from "emoji-regex";

import { INPUT_LIMITS } from "./input-limits";
import { type AgentInstructionsChange, isAgentInstructionsChange } from "./ipc-agent-instructions";
import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isBoundedString, isIdentifier, isRequestId } from "./ipc-bounded-values";
import { type ConversationMemoryChange, isConversationMemoryChanges } from "./ipc-conversation-memory-changes";
import { CONVERSATION_PLAN_ITEM_TYPE, type ConversationPlan, isConversationPlan } from "./ipc-conversation-plan";
import {
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationSubagent,
  isConversationSubagents,
} from "./ipc-conversation-subagents";
import { type ConversationTurnTrace, isConversationTurnTrace } from "./ipc-conversation-trace";
import { QUEUE_DELIVERY_STATUSES, type QueueDelivery } from "./ipc-queue";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";
import { type ConversationSkillSuggestion, isConversationSkillSuggestion } from "./skill-suggestion-events";
import { type ConversationUiBlock, isConversationUiBlock } from "./ui-blocks";

export type ConversationMessageAuthor = "user" | "assistant" | "agent" | "system";

export const IMAGE_GENERATION_ASPECT_RATIOS = ["square", "portrait", "landscape"] as const;
export type ImageGenerationAspectRatio = (typeof IMAGE_GENERATION_ASPECT_RATIOS)[number];

export interface ImageGenerationInfo {
  prompt?: string | undefined;
  resolution: string;
  aspectRatio: ImageGenerationAspectRatio;
  error?: string;
}

export function isImageGenerationAspectRatio(value: unknown): value is ImageGenerationAspectRatio {
  return isOneOf(IMAGE_GENERATION_ASPECT_RATIOS, value);
}

export interface ImagePixelSize {
  width: number;
  height: number;
}

export function imagePixelSize(value: string | undefined): ImagePixelSize | null {
  const match = /^\s*(\d{1,5})\s*[×xX]\s*(\d{1,5})\s*$/.exec(value ?? "");
  const width = Number(match?.[1] ?? 0);
  const height = Number(match?.[2] ?? 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function imagePixelSizeText(size: ImagePixelSize): string {
  return `${size.width} × ${size.height}`;
}

export function imageAspectRatioOf(size: ImagePixelSize): ImageGenerationAspectRatio {
  const ratio = size.width / size.height;
  if (ratio > 1.05) return "landscape";
  if (ratio < 1 / 1.05) return "portrait";
  return "square";
}

export function mergeImageGenerationInfo(
  stored: ImageGenerationInfo | undefined,
  update: ImageGenerationInfo | undefined,
): ImageGenerationInfo | undefined {
  if (!stored || !update) return update ?? stored;
  const keepSize = imagePixelSize(stored.resolution) !== null && imagePixelSize(update.resolution) === null;
  return {
    ...update,
    ...(update.prompt === undefined && stored.prompt !== undefined ? { prompt: stored.prompt } : {}),
    ...(keepSize ? { resolution: stored.resolution, aspectRatio: stored.aspectRatio } : {}),
  };
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

export interface VideoGenerationInfo {
  prompt?: string | undefined;
  aspectRatio: ImageGenerationAspectRatio;
  durationSeconds?: number | undefined;
  resolution?: string | undefined;
  error?: string | undefined;
}

export function isVideoGenerationInfo(value: unknown): value is VideoGenerationInfo {
  return (
    isDynamicRecord(value) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    isImageGenerationAspectRatio(value.aspectRatio) &&
    (value.durationSeconds === undefined ||
      (isNumber(value.durationSeconds) && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0)) &&
    (value.resolution === undefined || isBoundedString(value.resolution, 40)) &&
    (value.error === undefined || isString(value.error))
  );
}

export const MCP_ELICITATION_DECISION_QUESTION_ID = "mcp-elicitation-decision";

export interface AgentPromptQuestion {
  id: string;
  header: string;
  question: string;
  detail?: string;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
  multiSelect?: boolean;
}

export function isAgentPromptQuestion(value: unknown): value is AgentPromptQuestion {
  if (!isDynamicRecord(value)) return false;
  return (
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.header, INPUT_LIMITS.promptHeader) &&
    isBoundedString(value.question, INPUT_LIMITS.promptQuestion) &&
    (value.detail === undefined || isBoundedString(value.detail, INPUT_LIMITS.promptQuestion)) &&
    isBoolean(value.isSecret) &&
    (value.multiSelect === undefined || isBoolean(value.multiSelect)) &&
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
  expectsReply?: boolean;
  senderTaskId?: string;
}

export function openExchangesOutside(
  loaded: readonly { id: string; exchange?: AgentExchangeSummary | undefined }[],
  page: readonly { id: string }[],
): string[] {
  const onPage = new Set(page.map((message) => message.id));
  return loaded.flatMap(({ id, exchange }) =>
    !onPage.has(id) &&
    exchange?.direction === "outgoing" &&
    exchange.expectsReply !== false &&
    exchange.deliveries.some(({ status }) => status === "queued" || status === "starting" || status === "running")
      ? [id]
      : [],
  );
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
    (value.expectsReply === undefined || isBoolean(value.expectsReply)) &&
    (value.senderTaskId === undefined || isIdentifier(value.senderTaskId))
  );
}

export interface ConversationMessageSender {
  id: string;
  name: string;
}

export function isConversationMessageSender(value: unknown): value is ConversationMessageSender {
  return isDynamicRecord(value) && isIdentifier(value.id) && isBoundedString(value.name, INPUT_LIMITS.accountName);
}

export function conversationMessageSender(id: string, name: string): ConversationMessageSender | undefined {
  return isIdentifier(id) ? { id, name: name.slice(0, INPUT_LIMITS.accountName) } : undefined;
}

export interface ConversationMessage {
  id: string;
  turnId?: string | undefined;
  author: ConversationMessageAuthor;
  text: string;
  createdAt: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
  itemType?: string | undefined;
  source?: "user" | "assistant" | "agent" | "system" | "routine" | undefined;
  senderAgentId?: string | undefined;
  senderMember?: ConversationMessageSender | undefined;
  replyToMessageId?: string | null | undefined;
  attachments?: AttachmentSummary[] | undefined;
  voiceRecording?: AttachmentSummary | undefined;
  imageGeneration?: ImageGenerationInfo | undefined;
  videoGeneration?: VideoGenerationInfo | undefined;
  remoteSender?: { agentId: string; agentName: string; serverName: string } | undefined;
  delivery?: Pick<QueueDelivery, "id" | "status" | "position"> | undefined;
  steered?: true | undefined;
  exchange?: AgentExchangeSummary | undefined;
  reaction?: MessageReaction | null | undefined;
  reactions?: ConversationReaction[] | undefined;
  routine?:
    | {
        routineId: string;
        runId: string;
        name: string;
        scheduledFor: string;
      }
    | undefined;
  questionPrompt?: ConversationQuestionPrompt | undefined;
  plan?: ConversationPlan | undefined;
  subagents?: ConversationSubagent[] | undefined;
  memoryChanges?: ConversationMemoryChange[] | undefined;
  instructionsChange?: AgentInstructionsChange | undefined;
  skillSuggestion?: ConversationSkillSuggestion | undefined;
  uiBlock?: ConversationUiBlock | undefined;
  trace?: ConversationTurnTrace | undefined;
}

export function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!isDynamicRecord(value)) return false;
  const author = value.author;
  const status = value.status;
  return (
    isIdentifier(value.id) &&
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
    (value.voiceRecording === undefined || isAttachmentSummary(value.voiceRecording)) &&
    (value.delivery === undefined || isConversationDelivery(value.delivery)) &&
    (value.steered === undefined || value.steered === true) &&
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
    (value.videoGeneration === undefined || isVideoGenerationInfo(value.videoGeneration)) &&
    (value.remoteSender === undefined ||
      (isDynamicRecord(value.remoteSender) &&
        isString(value.remoteSender.agentId) &&
        isString(value.remoteSender.agentName) &&
        isString(value.remoteSender.serverName))) &&
    (value.questionPrompt === undefined || isConversationQuestionPrompt(value.questionPrompt)) &&
    (value.plan === undefined || isConversationPlan(value.plan)) &&
    (value.subagents === undefined || isConversationSubagents(value.subagents)) &&
    (value.memoryChanges === undefined || isConversationMemoryChanges(value.memoryChanges)) &&
    (value.instructionsChange === undefined || isAgentInstructionsChange(value.instructionsChange)) &&
    (value.skillSuggestion === undefined || isConversationSkillSuggestion(value.skillSuggestion)) &&
    (value.uiBlock === undefined || isConversationUiBlock(value.uiBlock)) &&
    (value.trace === undefined || isConversationTurnTrace(value.trace))
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

export const ROUTINE_QUIET_ANSWER_ITEM_TYPE = "routine_quiet_answer";

export const AGENT_WELCOME_ITEM_TYPE = "agent_welcome";

export const CHANNEL_RESUME_ITEM_TYPE = "channel_resume";

export function isAgentAnswer(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    message.itemType !== CONVERSATION_SUBAGENTS_ITEM_TYPE &&
    message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE &&
    Boolean(message.text.trim())
  );
}

export function latestTurnAnswer(
  messages: readonly ConversationMessage[],
  turnId: string,
): ConversationMessage | undefined {
  return [...messages].reverse().find((message) => message.turnId === turnId && isAgentAnswer(message));
}
