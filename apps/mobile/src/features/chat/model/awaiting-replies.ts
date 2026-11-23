import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { MobileAgentWait } from "@/features/workspace/model/agent-activity";

export type AwaitingReplyState = "asked" | "working" | "replied" | "failed";

export interface AwaitingReply {
  id: string;
  agentId: string;
  state: AwaitingReplyState;
  preview: string | null;
  deliveryId: string | null;
  wait: MobileAgentWait | null;
}

export function awaitingReplies(
  messages: readonly ConversationMessage[],
  replies: readonly QueueDelivery[],
  waits: Readonly<Record<string, MobileAgentWait>> = {},
): AwaitingReply[] {
  const lastUserIndex = messages.findLastIndex((message) => message.author === "user");
  const lastRequestIndex = lastRequestIndexByRecipient(messages);
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
        rows.push({
          id,
          agentId: delivery.recipientAgentId,
          state: "replied",
          preview: replyPreview(reply),
          deliveryId: reply.id,
          wait: null,
        });
        continue;
      }
      const state = deliveryState(delivery.status);
      const superseded = index < lastUserIndex || index < (lastRequestIndex.get(delivery.recipientAgentId) ?? index);
      if (!state || (state === "failed" && superseded)) continue;
      const wait = state === "failed" ? null : (waits[delivery.recipientAgentId] ?? null);
      rows.push({ id, agentId: delivery.recipientAgentId, state, preview: null, deliveryId: null, wait });
    }
  });
  for (const reply of replies) {
    if (shown.has(reply.id) || reply.sender.kind !== "agent") continue;
    rows.push({
      id: reply.id,
      agentId: reply.sender.agentId,
      state: "replied",
      preview: replyPreview(reply),
      deliveryId: reply.id,
      wait: null,
    });
  }
  return [...rows.filter((row) => row.wait), ...rows.filter((row) => !row.wait)];
}

function lastRequestIndexByRecipient(messages: readonly ConversationMessage[]): Map<string, number> {
  const last = new Map<string, number>();
  messages.forEach((message, index) => {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || exchange.expectsReply === false) return;
    for (const delivery of exchange.deliveries) last.set(delivery.recipientAgentId, index);
  });
  return last;
}

function deliveryState(status: QueueDelivery["status"]): Exclude<AwaitingReplyState, "replied"> | null {
  if (status === "queued") return "asked";
  if (status === "starting" || status === "running") return "working";
  if (status === "failed" || status === "interrupted" || status === "cancelled") return "failed";
  return null;
}

function replyPreview(reply: QueueDelivery): string {
  const result = /^\s*Result:[ \t]*(.*?)(?=^\s*Evidence:|(?![\s\S]))/imsu.exec(reply.text)?.[1]?.trim();
  const text = markdownPreviewText(result || reply.text);
  return text || reply.attachments.map((file) => file.name).join(", ");
}
