import type { AgentMessage } from "../../data";

/** The most prompts that the arrow keys keep, so a long chat costs one bounded list. */
export const COMPOSER_HISTORY_LIMIT = 100;

/**
 * The prompts that Arrow Up and Arrow Down recall, oldest first: the text of each message that the
 * user sent in this conversation. A message with no text, such as an attachment-only send, gives
 * nothing to recall. Consecutive copies of one prompt count once, so a repeated send does not need
 * two presses to pass. `own` names the user's messages; without it, an agent chat reads `author`.
 */
export function composerHistory(
  messages: readonly AgentMessage[],
  own: (message: AgentMessage) => boolean = (message) => message.author === "you",
): string[] {
  const prompts: string[] = [];
  for (const message of messages) {
    if (!own(message)) continue;
    if (message.kind !== undefined && message.kind !== "text") continue;
    const text = message.body.trim();
    if (!text || prompts.at(-1) === text) continue;
    prompts.push(text);
  }
  return prompts.slice(-COMPOSER_HISTORY_LIMIT);
}
