import { isDynamicRecord, isString } from "../runtime-values";

export const SKILLS_EVENTS_CAPABILITY = "skills-events-v1";

export type SkillsEvent = { type: "skills-changed"; agentId: string };

export function skillsEvent(value: unknown): SkillsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "skills-changed") return null;
  if (!isString(value.agentId) || !value.agentId.length || value.agentId.length > 128) {
    throw new Error("Invalid skills event.");
  }
  return { type: "skills-changed", agentId: value.agentId };
}
