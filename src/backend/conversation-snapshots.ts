import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  AgentExchangeSummary,
  AgentProviderId,
  ConversationMessage,
  ConversationSnapshot,
  QueueDelivery,
} from "@openbot/contracts/ipc";
import {
  AGENT_EXCHANGE_ITEM_TYPE,
  mergeImageGenerationInfo,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { displayMessageReferences, type TeammatePrompt, teammatePrompts } from "./agent/delivery-content";
import {
  imageGenerationAspectRatio,
  imageGenerationFailure,
  isImageGenerationItem,
  isVideoGenerationItem,
} from "./agent/image-generation";
import type { DeliveryContext } from "./mailbox-store";
import type { ThreadItem } from "./protocol";

const REALTIME_DELEGATION = "<realtime_delegation>";

export interface ThreadTurnMessageContext {
  id: string;
  status?: string;
  startedAt?: number;
  baseTime?: number;
}

export function messagesFromThreadItems(
  agentId: string,
  turn: ThreadTurnMessageContext,
  items: readonly ThreadItem[],
  itemOffset: number,
  findDelivery: (deliveryId: string) => DeliveryContext | null,
  findMessageDelivery: (messageId: string) => DeliveryContext | null,
): ConversationMessage[] {
  const baseTime = turn.baseTime ?? threadTurnBaseTime(turn, items, findDelivery);
  const messages: ConversationMessage[] = [];
  for (const [pageIndex, item] of items.entries()) {
    const itemIndex = itemOffset + pageIndex;
    const createdAt = new Date(baseTime + itemIndex).toISOString();
    if (item.type === "userMessage" && isString(item.id)) {
      const text = (item.content ?? [])
        .filter((part) => part.type === "text" && isString(part.text))
        .map((part) => part.text)
        .join("\n");
      const delivery = item.clientId ? findDelivery(item.clientId) : null;
      if (!text) continue;
      const row = { id: item.id, turnId: turn.id, text, createdAt };
      if (delivery) messages.push(promptMessage(delivery, row));
      else if (text.trimStart().startsWith(REALTIME_DELEGATION)) continue;
      else {
        const teammates = teammatePrompts(text).map((teammate) => ({
          teammate,
          found: findMessageDelivery(teammate.messageId),
        }));
        const fromTeammates =
          teammates.length > 0 &&
          teammates.every(({ teammate, found }) => !found || isTeammatePromptOf(teammate, promptMessage(found, row)));
        if (!fromTeammates) messages.push(promptMessage(null, row));
        else
          for (const [index, { teammate, found }] of teammates.entries())
            messages.push(
              found
                ? promptMessage(found, row)
                : teammateMessage(agentId, teammate, {
                    id: index === 0 ? item.id : `${item.id}:${teammate.messageId}`,
                    turnId: turn.id,
                    createdAt,
                  }),
            );
      }
    }
    if (item.type === "agentMessage" && isString(item.id) && item.text) {
      messages.push({
        id: item.id,
        turnId: turn.id,
        author: "assistant",
        text: item.text,
        createdAt,
        status: normalizeCompletionStatus(turn.status ?? "completed"),
        itemType: isString(item.phase) ? item.phase : "agentMessage",
      });
    }
    if (isImageGenerationItem(item) && isString(item.id)) {
      const providerStatus = isString(item.status) ? item.status : turn.status;
      const failed = providerStatus === "failed";
      const failure = imageGenerationFailure(item);
      messages.push({
        id: item.id,
        turnId: turn.id,
        author: "assistant",
        text: "",
        createdAt,
        status: failed ? "failed" : providerStatus === "interrupted" ? "interrupted" : "completed",
        itemType: "image_generation",
        imageGeneration: {
          ...(isString(item.revisedPrompt)
            ? { prompt: item.revisedPrompt }
            : isString(item.revised_prompt)
              ? { prompt: item.revised_prompt }
              : isString(item.prompt)
                ? { prompt: item.prompt }
                : {}),
          resolution: isString(item.resolution) ? item.resolution : "",
          aspectRatio: imageGenerationAspectRatio(item) ?? "square",
          ...(failure ? { error: failure } : {}),
        },
      });
    }
    if (isVideoGenerationItem(item) && isString(item.id)) {
      const providerStatus = isString(item.status) ? item.status : turn.status;
      const failure = imageGenerationFailure(item);
      messages.push({
        id: item.id,
        turnId: turn.id,
        author: "assistant",
        text: "",
        createdAt,
        status: providerStatus === "failed" ? "failed" : providerStatus === "interrupted" ? "interrupted" : "completed",
        itemType: "video_generation",
        videoGeneration: {
          ...(isString(item.prompt) ? { prompt: item.prompt } : {}),
          aspectRatio: imageGenerationAspectRatio(item) ?? "landscape",
          ...(typeof item.duration === "number" && item.duration > 0 ? { durationSeconds: item.duration } : {}),
          ...(isString(item.resolution) && item.resolution.length <= 40 ? { resolution: item.resolution } : {}),
          ...(failure ? { error: failure } : {}),
        },
      });
    }
  }
  return messages;
}

export function threadTurnBaseTime(
  turn: ThreadTurnMessageContext,
  items: readonly ThreadItem[],
  findDelivery: (deliveryId: string) => DeliveryContext | null,
): number {
  const firstUserItem = items.find((item) => item.type === "userMessage" && isString(item.clientId));
  const firstDelivery = firstUserItem?.clientId ? findDelivery(firstUserItem.clientId) : null;
  const deliveryTime = firstDelivery ? Date.parse(firstDelivery.delivery.createdAt) : Number.NaN;
  const turnStartedAt = typeof turn.startedAt === "number" ? turn.startedAt * 1_000 : Number.NaN;
  return Number.isFinite(deliveryTime) ? deliveryTime : Number.isFinite(turnStartedAt) ? turnStartedAt : Date.now();
}

export function mergeProviderHistoryMessages(
  stored: readonly ConversationMessage[],
  imported: readonly ConversationMessage[],
  provider?: AgentProviderId,
): ConversationMessage[] {
  if (provider === "claude") {
    const kept = stored.filter((message) => !isStoredClaudeNotice(message));
    return mergeConversationMessages(kept, reconcileClaudeHistoryMessages(kept, imported));
  }
  const importedIds = new Set(imported.map((message) => message.id));
  const importedAssistantMessages = new Set(imported.filter(isProviderAssistantMessage).map(providerMessageIdentity));
  const reconciledStored = stored.filter(
    (message) =>
      importedIds.has(message.id) ||
      !isProviderAssistantMessage(message) ||
      !importedAssistantMessages.has(providerMessageIdentity(message)),
  );
  return mergeConversationMessages(reconciledStored, imported);
}

export function promptMessage(
  context: DeliveryContext | null,
  row: Pick<ConversationMessage, "id" | "turnId" | "text" | "createdAt">,
): ConversationMessage {
  const delivery = context?.delivery;
  return {
    id: delivery?.id ?? row.id,
    turnId: row.turnId,
    author: delivery?.sender.kind === "agent" ? "agent" : "user",
    source: delivery?.sender.kind === "agent" ? "agent" : "user",
    senderAgentId: delivery?.sender.kind === "agent" ? delivery.sender.agentId : undefined,
    replyToMessageId: delivery?.replyToMessageId,
    attachments: delivery?.attachments,
    delivery: delivery ? { id: delivery.id, status: delivery.status, position: delivery.position } : undefined,
    text: delivery?.text ?? row.text,
    createdAt: delivery?.createdAt ?? row.createdAt,
    status: "completed",
    ...(delivery?.sender.kind === "agent"
      ? {
          itemType: AGENT_EXCHANGE_ITEM_TYPE,
          exchange: incomingAgentExchange(delivery, delivery.sender.agentId, context?.senderTaskId),
        }
      : {}),
  };
}

export function incomingAgentExchange(
  delivery: QueueDelivery,
  senderAgentId: string,
  senderTaskId: string | undefined,
): AgentExchangeSummary {
  return {
    direction: "incoming",
    messageId: delivery.messageId,
    senderAgentId,
    recipientAgentIds: [delivery.recipientAgentId],
    replyToMessageId: delivery.replyToMessageId,
    deliveries: [],
    ...(delivery.expectsReply === false ? { expectsReply: false } : {}),
    ...(senderTaskId ? { senderTaskId } : {}),
  };
}

function teammateMessage(
  recipientAgentId: string,
  teammate: TeammatePrompt,
  row: Pick<ConversationMessage, "id" | "turnId" | "createdAt">,
): ConversationMessage {
  return {
    ...row,
    author: "agent",
    source: "agent",
    senderAgentId: teammate.senderAgentId,
    replyToMessageId: teammate.replyToMessageId,
    exchange: {
      direction: "incoming",
      messageId: teammate.messageId,
      senderAgentId: teammate.senderAgentId,
      recipientAgentIds: [recipientAgentId],
      replyToMessageId: teammate.replyToMessageId,
      deliveries: [],
      ...(teammate.expectsReply ? {} : { expectsReply: false }),
    },
    text: teammate.text,
    status: "completed",
    itemType: AGENT_EXCHANGE_ITEM_TYPE,
  };
}

export function isMailboxMessageCopy(
  message: ConversationMessage,
  mailboxMessages: ReadonlyMap<string, ConversationMessage>,
): boolean {
  if (message.delivery) return false;
  if (message.exchange?.direction === "incoming") return mailboxMessages.has(message.exchange.messageId);
  if (message.author !== "user") return false;
  const teammates = teammatePrompts(message.text);
  return (
    teammates.length > 0 &&
    teammates.every((teammate) => {
      const original = mailboxMessages.get(teammate.messageId);
      return original !== undefined && isTeammatePromptOf(teammate, original);
    })
  );
}

function isTeammatePromptOf(teammate: TeammatePrompt, message: ConversationMessage): boolean {
  return (
    message.senderAgentId === teammate.senderAgentId &&
    displayMessageReferences(message.text, message.attachments ?? [], new Map()).trimEnd() === teammate.text
  );
}

export function mergeConversationSnapshots(
  stored: ConversationSnapshot,
  live: ConversationSnapshot,
): ConversationSnapshot {
  const messages = mergeConversationMessages(stored.messages, live.messages);
  const merged: ConversationSnapshot = {
    agentId: live.agentId,
    threadId: live.threadId ?? stored.threadId,
    activeTurnId: live.activeTurnId,
    revision: live.revision,
    messages,
  };
  return merged;
}

function mergeConversationMessages(
  stored: readonly ConversationMessage[],
  live: readonly ConversationMessage[],
): ConversationMessage[] {
  const messages = new Map(stored.map((message) => [message.id, message]));
  for (const message of live) {
    const previous = messages.get(message.id);
    const exchange = message.exchange?.deliveries.length ? message.exchange : (previous?.exchange ?? message.exchange);
    messages.set(
      message.id,
      previous
        ? {
            ...previous,
            ...message,
            ...(exchange ? { exchange } : {}),
            attachments: message.attachments ?? previous.attachments,
            imageGeneration: mergeImageGenerationInfo(previous.imageGeneration, message.imageGeneration),
            videoGeneration: message.videoGeneration ?? previous.videoGeneration,
          }
        : message,
    );
  }
  const merged = [...messages.values()];
  sortConversationMessages(merged);
  return merged;
}

function reconcileClaudeHistoryMessages(
  stored: readonly ConversationMessage[],
  imported: readonly ConversationMessage[],
): ConversationMessage[] {
  const storedMessages = new Map(stored.map((message) => [message.id, message]));
  const turns = new Map<string, ConversationMessage[]>();
  const storedNarrationTurns = new Set<string>();
  for (const message of stored) {
    if (!message.turnId) continue;
    const quietNarration =
      message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE && message.id.startsWith(`${message.turnId}:narration:`);
    if (isClaudeNarration(message) || quietNarration) storedNarrationTurns.add(message.turnId);
  }
  const storedReasoning = new Map<string, ConversationMessage>();
  for (const message of stored) {
    if (!isClaudeReasoning(message) || !message.turnId) continue;
    if (message.id === `${message.turnId}:reasoning`) storedReasoning.set(message.turnId, message);
  }
  const importedNarration = new Map<string, ConversationMessage[]>();
  const importedReasoning = new Map<string, ConversationMessage[]>();
  for (const message of imported) {
    if (isClaudeReasoning(message) && message.turnId) {
      const parts = importedReasoning.get(message.turnId) ?? [];
      parts.push(message);
      importedReasoning.set(message.turnId, parts);
      continue;
    }
    if (!isClaudeNarration(message) || !message.turnId) continue;
    const parts = importedNarration.get(message.turnId) ?? [];
    parts.push(message);
    importedNarration.set(message.turnId, parts);
  }
  for (const message of imported) {
    if (!isClaudeAnswer(message) || !message.turnId) continue;
    const parts = turns.get(message.turnId) ?? [];
    parts.push(message);
    turns.set(message.turnId, parts);
  }
  const replacements = new Map<string, ConversationMessage>();
  const omitted = new Set<string>();
  const appended: ConversationMessage[] = [];
  for (const [turnId, parts] of importedReasoning) {
    const existing = storedReasoning.get(turnId);
    if (existing) {
      let canonicalPlaced = false;
      for (const part of parts) {
        if (!existing.text.includes(part.text)) continue;
        if (!canonicalPlaced) {
          replacements.set(part.id, existing);
          canonicalPlaced = true;
        } else omitted.add(part.id);
      }
      if (!canonicalPlaced) appended.push(existing);
    }
  }
  for (const [turnId, parts] of turns) {
    const answer = storedMessages.get(`${turnId}:assistant`);
    if (!answer || !isClaudeAnswer(answer) || answer.turnId !== turnId) continue;
    const text = parts.map((part) => part.text).join("");
    const narration = importedNarration.get(turnId) ?? [];
    const aggregate = narration.length > 0 && answer.text === `${narration.map((part) => part.text).join("")}${text}`;
    if (parts.some((part) => storedMessages.has(part.id))) {
      for (const part of parts) {
        const existing = storedMessages.get(part.id);
        if (!existing || !(aggregate || existing.itemType === "commentary")) continue;
        replacements.set(part.id, { ...existing, ...part, itemType: "commentary" });
      }
      if (aggregate && answer.text) appended.push({ ...answer, text });
      continue;
    }
    if (!answer.text || !(aggregate || text.startsWith(answer.text))) continue;
    const first = parts[0];
    const last = parts.at(-1);
    if (!first || !last) continue;
    replacements.set(first.id, { ...answer, text, status: last.status });
    for (const part of parts.slice(1)) omitted.add(part.id);
    if (!storedNarrationTurns.has(turnId)) continue;
    for (const part of narration) {
      if (!storedMessages.has(part.id)) omitted.add(part.id);
    }
  }
  for (const [turnId, narration] of importedNarration) {
    if (turns.has(turnId)) continue;
    if (storedNarrationTurns.has(turnId)) {
      for (const part of narration) {
        if (!storedMessages.has(part.id)) omitted.add(part.id);
      }
      continue;
    }
    const answer = storedMessages.get(`${turnId}:assistant`);
    if (answer?.author !== "assistant" || answer.itemType !== "agentMessage" || answer.turnId !== turnId) continue;
    if (narration.some((part) => storedMessages.has(part.id))) continue;
    const text = narration.map((part) => part.text).join("");
    if (!answer.text || answer.text !== text) continue;
    const first = narration[0];
    const last = narration.at(-1);
    if (!first || !last) continue;
    replacements.set(first.id, { ...answer, itemType: "commentary", text, status: last.status });
    for (const part of narration.slice(1)) omitted.add(part.id);
  }
  return [
    ...imported.filter((message) => !omitted.has(message.id)).map((message) => replacements.get(message.id) ?? message),
    ...appended,
  ];
}

function isClaudeNarration(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType === "commentary" &&
    Boolean(message.turnId) &&
    !isClaudeReasoning(message)
  );
}

function isClaudeAnswer(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    (message.itemType === "agentMessage" || message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE)
  );
}

function isClaudeReasoning(message: ConversationMessage): boolean {
  return message.author === "assistant" && message.itemType === "commentary" && message.id.endsWith(":reasoning");
}

export const LOST_BACKGROUND_WORK_TAG = "openbot_lost_background_work";

export function isClaudeTaskNotification(text: string): boolean {
  return text.startsWith("<task-notification>") || text.startsWith(`<${LOST_BACKGROUND_WORK_TAG}>`);
}

export function isClaudeCompactionSummary(text: string): boolean {
  return text.startsWith("This session is being continued from a previous conversation that ran out of context.");
}

export function isClaudeLocalCommand(text: string): boolean {
  return /^<(?:command-name|local-command-stdout|local-command-stderr)>/.test(text.trimStart());
}

export function isClaudeInterruptMarker(text: string): boolean {
  return /^\[Request interrupted by user[^\]]*\]$/.test(text.trim());
}

function isStoredClaudeNotice(message: ConversationMessage): boolean {
  return (
    message.author === "user" &&
    !message.delivery &&
    (isClaudeTaskNotification(message.text) ||
      isClaudeLocalCommand(message.text) ||
      isClaudeInterruptMarker(message.text) ||
      isClaudeCompactionSummary(message.text))
  );
}

function isProviderAssistantMessage(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    Boolean(message.turnId) &&
    Boolean(message.text || message.imageGeneration || message.videoGeneration)
  );
}

function providerMessageIdentity(message: ConversationMessage): string {
  const image = message.imageGeneration;
  return JSON.stringify([
    message.turnId,
    message.itemType ?? null,
    message.text,
    image ? { ...image, resolution: null, aspectRatio: null } : null,
    ...(message.videoGeneration ? [message.videoGeneration] : []),
  ]);
}

export function newAssistantMessage(id: string, turnId: string): ConversationMessage {
  return {
    id,
    turnId,
    author: "assistant",
    text: "",
    createdAt: new Date().toISOString(),
    status: "streaming",
    itemType: "agentMessage",
  };
}

export function normalizeCompletionStatus(status: string): ConversationMessage["status"] {
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return "completed";
}
