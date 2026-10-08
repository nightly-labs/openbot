import {
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationMessage,
  type ConversationSnapshot,
} from "@openbot/contracts/ipc";

/**
 * The whole answer of a scheduled routine run that has nothing to report. The user asks for it in
 * the routine task; OpenBot does not add it to the prompt. A fixed token, not a phrase: the model
 * answers in the user's language, and a phrase match in every language is a guess. The brackets make
 * it unlikely as the start or the whole of a real report.
 */
export const ROUTINE_NO_UPDATE_MARKER = "[[no-update]]";

/** Only the marker, with white space around it. The marker inside a longer text is a report. */
export function isNoUpdateAnswer(text: string): boolean {
  return text.trim() === ROUTINE_NO_UPDATE_MARKER;
}

/**
 * Settles the answers of a completed turn that ran only scheduled routine runs. Each answer that is only
 * the marker goes: the user never needs to see it. When nothing else in the turn tells the user
 * anything, the turn is quiet, and its thinking and plan go too, so the run leaves only its run
 * marker. Returns whether the turn is quiet.
 *
 * The turn-completion write rewrites the whole thread, which deletes the projection row of a
 * message the snapshot no longer holds, so a marker already streamed to the database goes too.
 */
export function settleQuietRoutineTurn(snapshot: ConversationSnapshot, turnId: string): boolean {
  const turnMessages = snapshot.messages.filter(
    (message) => message.author === "assistant" && message.turnId === turnId,
  );
  const markers = new Set(turnMessages.filter(isMarkerAnswer));
  if (markers.size === 0) return false;
  const reported = turnMessages.some(
    (message) => !markers.has(message) && !isWorkNote(message) && carriesContent(message),
  );
  const dropped = reported ? markers : new Set(turnMessages);
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message && dropped.has(message)) snapshot.messages.splice(index, 1);
  }
  return !reported;
}

function isMarkerAnswer(message: ConversationMessage): boolean {
  return (
    !isWorkNote(message) &&
    message.itemType !== "question_prompt" &&
    !message.attachments?.length &&
    !message.imageGeneration &&
    isNoUpdateAnswer(message.text)
  );
}

/** Thinking and the plan: how the agent worked, not what it reports. */
function isWorkNote(message: ConversationMessage): boolean {
  return message.itemType === "commentary" || message.itemType === CONVERSATION_PLAN_ITEM_TYPE;
}

function carriesContent(message: ConversationMessage): boolean {
  return (
    message.itemType === "question_prompt" ||
    message.text.trim() !== "" ||
    Boolean(message.attachments?.length) ||
    Boolean(message.imageGeneration)
  );
}
