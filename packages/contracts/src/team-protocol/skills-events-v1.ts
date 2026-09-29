// Frozen optional skills-events-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host tells each client
// that negotiated the capability that the installed skills of one agent changed, so the client reads
// the list again. The event names only the agent: the list itself stays behind the routes that
// already guard it, `installed-skills` for every member and `skills-admin-v1` for an owner or admin.
// Widening any of it needs a second capability.
import { isDynamicRecord, isString } from "../runtime-values";

export const SKILLS_EVENTS_CAPABILITY = "skills-events-v1";

export type SkillsEvent = { type: "skills-changed"; agentId: string };

/** The skills event in `value`, or null for any other event. A malformed skills event throws. */
export function skillsEvent(value: unknown): SkillsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "skills-changed") return null;
  if (!isString(value.agentId) || !value.agentId.length || value.agentId.length > 128) {
    throw new Error("Invalid skills event.");
  }
  return { type: "skills-changed", agentId: value.agentId };
}
