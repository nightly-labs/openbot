import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { ConversationMessage } from "./ipc-conversation-messages";
import { isDynamicRecord } from "./runtime-values";

export const SKILL_SUGGESTION_ITEM_TYPE_PREFIX = "skill-suggestion:";

export const SKILL_SUGGESTION_NAME_CHARACTERS = 200;

const LOCAL_SKILL_ID = /^local-skill-[\da-f-]{36}$/u;

export type SkillSuggestionTarget = { action: "create" } | { action: "update"; skillId: string };

export interface ConversationSkillSuggestion {
  name: string;
}

export type SkillSuggestionEvent = SkillSuggestionTarget & { skillName: string; question: string };

export function isLocalLibrarySkill(skillId: string): boolean {
  return LOCAL_SKILL_ID.test(skillId);
}

export function isConversationSkillSuggestion(value: unknown): value is ConversationSkillSuggestion {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, SKILL_SUGGESTION_NAME_CHARACTERS) &&
    value.name.trim().length > 0
  );
}

export function skillSuggestionItemType(target: SkillSuggestionTarget): string {
  return target.action === "create"
    ? `${SKILL_SUGGESTION_ITEM_TYPE_PREFIX}create`
    : `${SKILL_SUGGESTION_ITEM_TYPE_PREFIX}update:${target.skillId}`;
}

export function skillSuggestionTarget(message: ConversationMessage): SkillSuggestionTarget | null {
  if (message.author !== "system" || message.source !== "system") return null;
  const rest = message.itemType?.startsWith(SKILL_SUGGESTION_ITEM_TYPE_PREFIX)
    ? message.itemType.slice(SKILL_SUGGESTION_ITEM_TYPE_PREFIX.length)
    : null;
  if (rest === "create") return { action: "create" };
  const skillId = rest?.startsWith("update:") ? rest.slice("update:".length) : null;
  return skillId && isIdentifier(skillId) && isLocalLibrarySkill(skillId) ? { action: "update", skillId } : null;
}

export function skillSuggestionEvent(message: ConversationMessage): SkillSuggestionEvent | null {
  if (message.status !== "completed") return null;
  const target = skillSuggestionTarget(message);
  const skillName = message.skillSuggestion?.name.trim();
  const question = message.text.trim();
  return target && skillName && question ? { ...target, skillName, question } : null;
}
