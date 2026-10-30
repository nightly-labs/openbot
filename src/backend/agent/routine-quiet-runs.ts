import {
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  type ConversationSnapshot,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type RoutineRun,
} from "@openbot/contracts/ipc";
import { bridgedToolName, getString, type ThreadItem } from "../protocol";

/**
 * The whole answer of a quiet routine run that has nothing to report. The user asks for it in
 * the routine task; OpenBot does not add it to the prompt. A fixed token, not a phrase: the model
 * answers in the user's language, and a phrase match in every language is a guess. The brackets make
 * it unlikely as the start or the whole of a real report.
 */
const ROUTINE_NO_UPDATE_MARKER = "[[no-update]]";

/**
 * The OpenBot tool that a quiet routine run calls when it has nothing to report. A model often
 * writes a short sentence instead of the exact marker; a tool call does not depend on the wording or
 * the language. It has no arguments, so the provider history shows the decision by the tool name.
 */
export const ROUTINE_NO_UPDATE_TOOL = "routine_no_update";

/**
 * The OpenBot tool that a routine run calls when its task could not be done. The run then ends
 * `failed` with the reason, while its delivery stays `completed`: the agent did answer.
 */
export const ROUTINE_REPORT_FAILURE_TOOL = "routine_report_failure";

/**
 * A call to the no-update tool in provider history: a Codex, Pi or Muse tool item names the tool,
 * and a Claude item names it `mcp__openbot__<tool>`. A call through the `tool_call` bridge names it
 * in its arguments.
 */
export function isNoUpdateToolCall(item: ThreadItem): boolean {
  if (bridgedToolName(item) === `openbot.${ROUTINE_NO_UPDATE_TOOL}`) return true;
  if (item.type === "toolCall") return getString(item, "name") === `mcp__openbot__${ROUTINE_NO_UPDATE_TOOL}`;
  return (
    (item.type === "dynamicToolCall" || item.type === "mcpToolCall") &&
    getString(item, "tool") === ROUTINE_NO_UPDATE_TOOL
  );
}

/**
 * Whether a run may end without a message. A scheduled, script or webhook run is quiet: no person
 * waits for its answer. A Test run, and a manual run from before the source was stored, is not.
 */
export function quietRoutineRun(run: Pick<RoutineRun, "kind" | "source">): boolean {
  return run.kind === "scheduled" || run.source === "script" || run.source === "webhook";
}

/** Only the marker, with white space around it. The marker inside a longer text is a report. */
export function isNoUpdateAnswer(text: string): boolean {
  return text.trim() === ROUTINE_NO_UPDATE_MARKER;
}

/**
 * Settles the answers of a completed turn that ran only quiet routine runs. Each answer that is only
 * the marker goes: the user never needs to see it. After a call to the no-update tool, each text answer
 * is a quiet answer. When nothing else in the turn tells the user anything, the turn is quiet: its
 * thinking and plan go, and each quiet answer stays as a `ROUTINE_QUIET_ANSWER_ITEM_TYPE` message that
 * the chat shows inside the collapsed run. A file, an image or a question is a report, also after the
 * tool call, and then the quiet answers go. Returns whether the turn is quiet.
 *
 * The turn-completion write rewrites the whole thread, which deletes the projection row of a
 * message the snapshot no longer holds, so a marker already streamed to the database goes too.
 */
export function settleQuietRoutineTurn(
  snapshot: ConversationSnapshot,
  turnId: string,
  noUpdateCalled: boolean,
): boolean {
  const turnMessages = snapshot.messages.filter(
    (message) => message.author === "assistant" && message.turnId === turnId,
  );
  const markers = new Set(
    turnMessages.filter((message) => isTextAnswer(message) && (noUpdateCalled || isNoUpdateAnswer(message.text))),
  );
  if (markers.size === 0 && !noUpdateCalled) return false;
  const reported = turnMessages.some(
    (message) => !markers.has(message) && !isWorkNote(message) && carriesContent(message),
  );
  const dropped = reported ? markers : new Set(turnMessages.filter((message) => !keptQuietAnswer(message)));
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (!message) continue;
    if (dropped.has(message)) snapshot.messages.splice(index, 1);
    else if (!reported && message.turnId === turnId && message.author === "assistant") {
      snapshot.messages[index] = { ...message, itemType: ROUTINE_QUIET_ANSWER_ITEM_TYPE };
    }
  }
  return !reported;
}

/** A text answer of a quiet turn that says more than the marker. */
export function keptQuietAnswer(message: ConversationMessage): boolean {
  return isTextAnswer(message) && message.text.trim() !== "" && !isNoUpdateAnswer(message.text);
}

/** An answer that is text alone: no file, image or question. */
export function isTextAnswer(message: ConversationMessage): boolean {
  return (
    !isWorkNote(message) &&
    message.itemType !== "question_prompt" &&
    !message.attachments?.length &&
    !message.imageGeneration
  );
}

/** Thinking, the plan and the subagents: how the agent worked, not what it reports. */
function isWorkNote(message: ConversationMessage): boolean {
  return (
    message.itemType === "commentary" ||
    message.itemType === CONVERSATION_PLAN_ITEM_TYPE ||
    message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE
  );
}

function carriesContent(message: ConversationMessage): boolean {
  return (
    message.itemType === "question_prompt" ||
    message.text.trim() !== "" ||
    Boolean(message.attachments?.length) ||
    Boolean(message.imageGeneration)
  );
}
