import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";

/**
 * The rows of the waiting block: which teammates this agent asked, and where each answer is.
 * It follows desktop `agentAwaitingReplies`. An outgoing exchange names each delivery and its
 * state, and an answer is a queued delivery from the teammate that was asked, linked to the
 * question by `replyToMessageId`.
 */

export type AwaitingReplyState = "asked" | "working" | "replied" | "failed";

export interface AwaitingReply {
  id: string;
  agentId: string;
  state: AwaitingReplyState;
  /** The answer, for a teammate that replied. */
  preview: string | null;
}

export function awaitingReplies(
  messages: readonly ConversationMessage[],
  replies: readonly QueueDelivery[],
): AwaitingReply[] {
  // A failed question stays until the person writes again: then they have seen it.
  const lastUserIndex = messages.findLastIndex((message) => message.author === "user");
  const rows: AwaitingReply[] = [];
  const shown = new Set<string>();
  messages.forEach((message, index) => {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || exchange.expectsReply === false) return;
    for (const delivery of exchange.deliveries) {
      const id = `${exchange.messageId}:${delivery.recipientAgentId}`;
      const reply = replies.find(
        (candidate) =>
          candidate.replyToMessageId === exchange.messageId &&
          candidate.sender.kind === "agent" &&
          candidate.sender.agentId === delivery.recipientAgentId,
      );
      if (reply) {
        shown.add(reply.id);
        rows.push({ id, agentId: delivery.recipientAgentId, state: "replied", preview: replyPreview(reply) });
        continue;
      }
      const state = deliveryState(delivery.status);
      if (!state || (state === "failed" && index < lastUserIndex)) continue;
      rows.push({ id, agentId: delivery.recipientAgentId, state, preview: null });
    }
  });
  // An answer to a question on an earlier page, or to one sent from another conversation.
  for (const reply of replies) {
    if (shown.has(reply.id) || reply.sender.kind !== "agent") continue;
    rows.push({ id: reply.id, agentId: reply.sender.agentId, state: "replied", preview: replyPreview(reply) });
  }
  return rows;
}

/** Null for a delivery that has landed: its answer is in the transcript, or it had none. */
function deliveryState(status: QueueDelivery["status"]): Exclude<AwaitingReplyState, "replied"> | null {
  if (status === "queued") return "asked";
  if (status === "starting" || status === "running") return "working";
  if (status === "failed" || status === "interrupted" || status === "cancelled") return "failed";
  return null;
}

/**
 * The `Result:` part of a reply in the relay format (`Status:`, `Result:`, `Evidence:` lines, from
 * `delivery-content.ts`), or the whole reply in another form, or its file names.
 */
function replyPreview(reply: QueueDelivery): string {
  const result = /^\s*Result:[ \t]*(.*?)(?=^\s*Evidence:|(?![\s\S]))/imsu.exec(reply.text)?.[1]?.trim();
  const text = markdownPreviewText(result || reply.text);
  return text || reply.attachments.map((file) => file.name).join(", ");
}
