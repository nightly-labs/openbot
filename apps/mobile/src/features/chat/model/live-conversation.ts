import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";

export type LiveConversationPhase = "starting" | "listening" | "sending" | "thinking" | "speaking" | "offline";

const PART_LENGTH = 160;
const SENTENCE = /[^.!?…。！？]+(?:[.!?…。！？]+|$)/gu;

export function liveReplyTurn(
  messages: readonly ConversationMessage[],
  deliveries: readonly Pick<QueueDelivery, "messageId" | "turnId">[],
  messageId: string,
): string | null {
  const index = messages.findIndex((message) => message.id === messageId);
  const own = messages[index]?.turnId;
  if (own) return own;
  const delivery = deliveries.find((item) => item.messageId === messageId);
  if (delivery) return delivery.turnId;
  if (index < 0) return null;
  return messages.slice(index + 1).find((message) => message.author === "assistant" && message.turnId)?.turnId ?? null;
}

export function liveSpeechParts(markdown: string, maximumLength: number): string[] {
  const text = speechTextFromMarkdown(markdown);
  const parts: string[] = [];
  let current = "";
  for (const sentence of text.match(SENTENCE) ?? []) {
    const piece = sentence.trim();
    if (!piece) continue;
    current = current ? `${current} ${piece}` : piece;
    if (parts.length === 0 || current.length >= PART_LENGTH) {
      parts.push(current);
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => splitAt(part, maximumLength));
}

function splitAt(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit);
    const cut = space > limit / 2 ? space : limit;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
