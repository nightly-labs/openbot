import { isBoolean, isDynamicRecord, isString } from "../runtime-values";
import { eventConversationKey } from "./conversation-plan-v4";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional prompt-multi-select-v1 contract: a question that takes more than one option. It adds
 * `multiSelect: true` beside the frozen keys of an `AgentPromptQuestion` in:
 *
 * - the `questionPrompt.questions` of each message in `messages` and `references` of
 *   `GET /v1/agents/:agentId/conversation` and `GET /v1/agents/:agentId/conversation-page`, and of the
 *   `snapshot` of a `conversation` event and the `page` of a `conversation-page` event;
 * - the `questions` of a `prompt` event;
 * - the `questions` of each `pendingPrompts` item in the `snapshot` of a `runtime-snapshot` event.
 *
 * The host adds it only for a client that advertises the capability, on protocol 7 or 8, so the wire of
 * every released client stays as it was. Such a client shows the question as a single choice, and its
 * one answer is valid for a multi-select question. A host without the capability never sends
 * `multiSelect`, so a client accepts it whenever it is present. A present value that is not a boolean
 * fails closed. Only `true` goes out. Widening any of it needs a second capability string.
 */
export const TEAM_PROMPT_MULTI_SELECT_CAPABILITY = "prompt-multi-select-v1";

/** The events whose payload can carry prompt questions. */
export function eventHasPromptQuestions(type: unknown): boolean {
  return type === "prompt" || type === "runtime-snapshot" || eventConversationKey(type) !== null;
}

/** `projected` with the multi-select flag of each question of `source`. The projection keeps the order. */
function withQuestionsMultiSelect(
  projected: TeamProtocolV7BaseJsonValue[],
  source: unknown,
): TeamProtocolV7BaseJsonValue[] {
  if (!Array.isArray(source)) return projected;
  return projected.map((question, index) => {
    const from = source[index];
    if (!isDynamicRecord(question) || !isDynamicRecord(from) || from.multiSelect === undefined) return question;
    if (!isBoolean(from.multiSelect)) throw new Error("Invalid prompt multi-select flag.");
    return from.multiSelect ? { ...question, multiSelect: true } : question;
  });
}

/** `projected` with the multi-select flags of the question prompt of each message of `source`. */
export function withConversationPromptMultiSelect(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const prompts = new Map<string, unknown>();
  for (const message of [...fromMessages, ...fromReferences]) {
    if (isDynamicRecord(message) && isString(message.id) && isDynamicRecord(message.questionPrompt)) {
      prompts.set(message.id, message.questionPrompt.questions);
    }
  }
  if (prompts.size === 0) return projected;
  const withFlags = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id) || !isDynamicRecord(message.questionPrompt)) return message;
    const { questions } = message.questionPrompt;
    if (!Array.isArray(questions)) return message;
    return {
      ...message,
      questionPrompt: {
        ...message.questionPrompt,
        questions: withQuestionsMultiSelect(questions, prompts.get(message.id)),
      },
    };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withFlags);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withFlags(value)]),
    );
  }
  return result;
}

/** `projected` with the multi-select flags of the prompt questions of the event `source`. */
export function withEventPromptMultiSelect(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  if (projected.type === "prompt") {
    const { questions } = projected;
    return Array.isArray(questions)
      ? { ...projected, questions: withQuestionsMultiSelect(questions, source.questions) }
      : projected;
  }
  if (projected.type === "runtime-snapshot") {
    const snapshot = projected.snapshot;
    const fromSnapshot = source.snapshot;
    if (!isDynamicRecord(snapshot) || !isDynamicRecord(fromSnapshot) || !Array.isArray(snapshot.pendingPrompts)) {
      return projected;
    }
    const fromPrompts = Array.isArray(fromSnapshot.pendingPrompts) ? fromSnapshot.pendingPrompts : [];
    const pendingPrompts = snapshot.pendingPrompts.map((prompt, index) => {
      const from = fromPrompts[index];
      if (!isDynamicRecord(prompt) || !isDynamicRecord(from) || !Array.isArray(prompt.questions)) return prompt;
      return { ...prompt, questions: withQuestionsMultiSelect(prompt.questions, from.questions) };
    });
    return { ...projected, snapshot: { ...snapshot, pendingPrompts } };
  }
  const key = eventConversationKey(projected.type);
  const conversation = key ? projected[key] : undefined;
  if (!key || conversation === undefined) return projected;
  return { ...projected, [key]: withConversationPromptMultiSelect(conversation, source[key]) };
}
