import { isBoolean, isDynamicRecord, isString } from "../runtime-values";
import { eventConversationKey } from "./conversation-plan-v4";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const TEAM_PROMPT_MULTI_SELECT_CAPABILITY = "prompt-multi-select-v1";

export function eventHasPromptQuestions(type: unknown): boolean {
  return type === "prompt" || type === "runtime-snapshot" || eventConversationKey(type) !== null;
}

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
