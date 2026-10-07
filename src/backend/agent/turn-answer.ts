import { CONVERSATION_PLAN_ITEM_TYPE, type ConversationMessage } from "@openbot/contracts/ipc";

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
