import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type { AgentProviderId, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { isImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { DeliveryContext } from "./mailbox-store";
import type { ThreadItem, ThreadResponse } from "./protocol";

export function snapshotFromThread(
  agentId: string,
  thread: ThreadResponse["thread"],
  findDelivery: (deliveryId: string) => DeliveryContext | null,
): ConversationSnapshot {
  const messages: ConversationMessage[] = [];
  for (const turn of thread.turns ?? []) {
    const items = turn.items ?? [];
    const firstUserItem = items.find((item) => item.type === "userMessage" && isString(item.clientId));
    const firstDelivery = firstUserItem?.clientId ? findDelivery(firstUserItem.clientId) : null;
    const deliveryTime = firstDelivery ? Date.parse(firstDelivery.delivery.createdAt) : Number.NaN;
    const turnStartedAt = turn.startedAt ? turn.startedAt * 1_000 : Number.NaN;
    const baseTime = Number.isFinite(deliveryTime)
      ? deliveryTime
      : Number.isFinite(turnStartedAt)
        ? turnStartedAt
        : Date.now();
    for (const [itemIndex, item] of items.entries()) {
      const createdAt = new Date(baseTime + itemIndex).toISOString();
      if (item.type === "userMessage" && isString(item.id)) {
        const delivery = item.clientId ? findDelivery(item.clientId) : null;
        const text = (item.content ?? [])
          .filter((part) => part.type === "text" && isString(part.text))
          .map((part) => part.text)
          .join("\n");
        if (text) {
          messages.push({
            id: delivery?.delivery.id ?? item.id,
            turnId: turn.id,
            author: delivery?.delivery.sender.kind === "agent" ? "agent" : "user",
            source: delivery?.delivery.sender.kind === "agent" ? "agent" : "user",
            senderAgentId: delivery?.delivery.sender.kind === "agent" ? delivery.delivery.sender.agentId : undefined,
            replyToMessageId: delivery?.delivery.replyToMessageId,
            attachments: delivery?.delivery.attachments,
            delivery: delivery
              ? {
                  id: delivery.delivery.id,
                  status: delivery.delivery.status,
                  position: delivery.delivery.position,
                }
              : undefined,
            text: delivery?.delivery.text ?? text,
            createdAt: delivery?.delivery.createdAt ?? createdAt,
            status: "completed",
          });
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
            ...(isString(item.revised_prompt) ? { prompt: item.revised_prompt } : {}),
            resolution: isString(item.resolution) ? item.resolution : "1024 × 1024",
            aspectRatio: isImageGenerationAspectRatio(item.aspectRatio) ? item.aspectRatio : "square",
            ...(failure ? { error: failure } : {}),
          },
        });
      }
    }
  }
  sortConversationMessages(messages);
  return { agentId, threadId: thread.id, activeTurnId: null, revision: 0, messages };
}

export function mergeConversationSnapshots(
  stored: ConversationSnapshot,
  live: ConversationSnapshot,
): ConversationSnapshot {
  const messages = new Map(stored.messages.map((message) => [message.id, message]));
  for (const message of live.messages) {
    const previous = messages.get(message.id);
    messages.set(
      message.id,
      previous
        ? {
            ...previous,
            ...message,
            attachments: message.attachments ?? previous.attachments,
            imageGeneration: message.imageGeneration ?? previous.imageGeneration,
          }
        : message,
    );
  }
  const merged: ConversationSnapshot = {
    agentId: live.agentId,
    threadId: live.threadId ?? stored.threadId,
    activeTurnId: live.activeTurnId,
    revision: live.revision,
    messages: [...messages.values()],
  };
  sortConversationMessages(merged.messages);
  return merged;
}

export function mergeProviderHistory(
  stored: ConversationSnapshot,
  imported: ConversationSnapshot,
  provider?: AgentProviderId,
): ConversationSnapshot {
  if (provider === "claude") {
    return mergeConversationSnapshots(stored, reconcileClaudeHistory(stored, imported));
  }
  const importedIds = new Set(imported.messages.map((message) => message.id));
  const importedAssistantMessages = new Set(
    imported.messages.filter(isProviderAssistantMessage).map(providerMessageIdentity),
  );
  const reconciledStored = {
    ...stored,
    messages: stored.messages.filter(
      (message) =>
        importedIds.has(message.id) ||
        !isProviderAssistantMessage(message) ||
        !importedAssistantMessages.has(providerMessageIdentity(message)),
    ),
  };
  return mergeConversationSnapshots(reconciledStored, imported);
}

function reconcileClaudeHistory(stored: ConversationSnapshot, imported: ConversationSnapshot): ConversationSnapshot {
  const storedMessages = new Map(stored.messages.map((message) => [message.id, message]));
  const turns = new Map<string, ConversationMessage[]>();
  /* A turn's narration is imported under the session's own message IDs, which never match the IDs a
     live turn published it under. A turn this app already holds therefore keeps the narration it
     recorded, and the imported copy is dropped rather than stored a second time on every restart. */
  const storedNarrationTurns = new Set<string>();
  for (const message of stored.messages) {
    if (!isClaudeNarration(message) || !message.turnId) continue;
    storedNarrationTurns.add(message.turnId);
  }
  const importedNarration = new Map<string, ConversationMessage[]>();
  for (const message of imported.messages) {
    if (!isClaudeNarration(message) || !message.turnId) continue;
    const parts = importedNarration.get(message.turnId) ?? [];
    parts.push(message);
    importedNarration.set(message.turnId, parts);
  }
  for (const message of imported.messages) {
    if (message.author !== "assistant" || message.itemType !== "agentMessage" || !message.turnId) continue;
    const parts = turns.get(message.turnId) ?? [];
    parts.push(message);
    turns.set(message.turnId, parts);
  }
  const replacements = new Map<string, ConversationMessage>();
  const omitted = new Set<string>();
  /** Stored rows this has to rewrite that the import carries no entry of its own for. */
  const appended: ConversationMessage[] = [];
  for (const [turnId, parts] of turns) {
    // Live Claude output combines SDK replies under one ID. Keep that ID and its metadata.
    const answer = storedMessages.get(`${turnId}:assistant`);
    if (answer?.author !== "assistant" || answer.itemType !== "agentMessage" || answer.turnId !== turnId) continue;
    const text = parts.map((part) => part.text).join("");
    const narration = importedNarration.get(turnId) ?? [];
    /* A turn released before narration rode the thinking disclosure stored the narration and the
       answer together under this one ID. The import now splits the two, so the aggregate matches
       neither half on its own: match it whole, and keep only the answer as its text. Without this
       the backfill leaves the aggregate bubble in place and stores the split copy beside it. */
    const aggregate = narration.length > 0 && answer.text === `${narration.map((part) => part.text).join("")}${text}`;
    /* Existing split records can have saved references. Never remove or combine them - but a
       database holding the aggregate and its canonical rows together must still read as one
       answer, so the aggregate keeps only the answer and the rows repeating it stop being
       bubbles. A row already demoted stays demoted, whatever the import calls it. */
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
  /* A turn that ended on its tool call said something and then answered nothing, so it imports as
     narration with no `agentMessage` and the loop above never reaches it. Left there, a released
     build's narration keeps the bubble the upgrade was meant to take away, and a turn this app
     recorded itself gains a second copy of its narration on every restart. */
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
    // Keep the ID and what is saved against it, and let the narration stop being an answer.
    replacements.set(first.id, { ...answer, itemType: "commentary", text, status: last.status });
    for (const part of narration.slice(1)) omitted.add(part.id);
  }
  return {
    ...imported,
    messages: [
      ...imported.messages
        .filter((message) => !omitted.has(message.id))
        .map((message) => replacements.get(message.id) ?? message),
      ...appended,
    ],
  };
}

/**
 * The narration of a turn, which is the text it said between its tool calls.
 *
 * Thinking is commentary too, and has been stored under `${turnId}:reasoning` since long before
 * narration was. Counting it as narration breaks this both ways: the reasoning text joins the
 * comparison that recognises a released turn's combined answer, and a turn that only ever had
 * thinking looks like one whose narration is already stored, so the imported narration is dropped
 * as a repeat and the text is lost.
 */
function isClaudeNarration(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType === "commentary" &&
    Boolean(message.turnId) &&
    message.id !== `${message.turnId}:reasoning`
  );
}

function isProviderAssistantMessage(message: ConversationMessage): boolean {
  return message.author === "assistant" && Boolean(message.turnId) && Boolean(message.text || message.imageGeneration);
}

function providerMessageIdentity(message: ConversationMessage): string {
  return JSON.stringify([message.turnId, message.itemType ?? null, message.text, message.imageGeneration ?? null]);
}

function isImageGenerationItem(item: { type: string }): boolean {
  return item.type === "image_generation_call" || item.type === "imageGeneration";
}

function imageGenerationFailure(item: ThreadItem): string | null {
  const failure = item.failure;
  if (isDynamicRecord(failure)) {
    const message = failure.message;
    if (isString(message)) return message;
  }
  return isString(item.error) ? item.error : isString(failure) ? failure : null;
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
