import { INPUT_LIMITS } from "./input-limits";
import { isIdentifier } from "./ipc-bounded-values";
import type { ConversationMessage } from "./ipc-conversation-messages";

export const SKILL_EVENT_ITEM_TYPE_PREFIX = "skill-event:";
export interface SkillConversationEvent {
  action: "created" | "revised" | "installed";
  skillId: string;
  revision: number;
  skillName: string;
}

export function skillConversationEventItemType(event: Omit<SkillConversationEvent, "skillName">): string {
  if (!isIdentifier(event.skillId) || !Number.isSafeInteger(event.revision) || event.revision < 1) {
    throw new Error("A valid skill id and revision are required.");
  }
  const value = `${SKILL_EVENT_ITEM_TYPE_PREFIX}${event.action}:${event.skillId}:${event.revision}`;
  if (value.length > INPUT_LIMITS.identifier) throw new Error("The skill event item type is too long.");
  return value;
}

export function skillConversationEvent(message: ConversationMessage): SkillConversationEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(SKILL_EVENT_ITEM_TYPE_PREFIX)) return null;
  const [action, skillId, version, ...extra] = message.itemType.slice(SKILL_EVENT_ITEM_TYPE_PREFIX.length).split(":");
  const revision = Number(version);
  const skillName = message.text.trim();
  if (
    extra.length ||
    (action !== "created" && action !== "revised" && action !== "installed") ||
    !isIdentifier(skillId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    String(revision) !== version ||
    !skillName ||
    skillName.length > 1000
  )
    return null;
  return { action, skillId, revision, skillName };
}
