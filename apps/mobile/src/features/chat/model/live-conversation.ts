import type { ConversationMessage, QueueDelivery } from "@openbot/contracts/ipc";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";

/** What a live voice conversation does now. */
export type LiveConversationPhase = "starting" | "listening" | "sending" | "thinking" | "speaking" | "offline";

/** A part ends at the first sentence that makes it this long, so the caption changes with the voice. */
const PART_LENGTH = 160;
const SENTENCE = /[^.!?…。！？]+(?:[.!?…。！？]+|$)/gu;

/**
 * The turn that answers the message the user said. The message names its turn when the turn starts;
 * a message that the host queued behind a running turn names it in its delivery, and has none while
 * it waits. A host that does neither still writes the reply after the message, so its first agent
 * message with a turn is it.
 */
export function liveReplyTurn(
  messages: readonly ConversationMessage[],
  deliveries: readonly Pick<QueueDelivery, "messageId" | "turnId">[],
  messageId: string,
): string | null {
  const index = messages.findIndex((message) => message.id === messageId);
  const own = messages[index]?.turnId;
  if (own) return own;
  const delivery = deliveries.find((item) => item.messageId === messageId);
  // The agent messages after a queued message belong to the turn it waits for.
  if (delivery) return delivery.turnId;
  if (index < 0) return null;
  return messages.slice(index + 1).find((message) => message.author === "assistant" && message.turnId)?.turnId ?? null;
}

/**
 * The reply as parts to read aloud, one sentence or a few short ones each, so the caption shows the
 * part that plays. The first sentence is a part of its own, so a reply that streams starts to play
 * as soon as it is written. Code, tables and addresses are not read, as on desktop. `maximumLength`
 * is the longest text the phone's voice takes in one call.
 */
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
