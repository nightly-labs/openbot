import type { InstalledSkill } from "@openbot/contracts/ipc";
import type { MobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";

/** The skills the user assigned, as the desktop agent settings list them: built-in skills are hidden. */
function userAssignedSkills(skills: InstalledSkill[]): InstalledSkill[] {
  return skills
    .filter(
      (skill) =>
        skill.origin !== "managed" && skill.slug !== "openbot-site-hosting" && skill.skillId !== "openbot-site-hosting",
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The read of one agent's skills. Agent info, the Marketplace and the chat composer use this one
 * query, so they write the same list under the same key. Null when the host has no skill route.
 */
export function agentSkillsQuery(
  scope: QueryScope,
  serverId: string,
  agentId: string,
  manage: boolean,
  loadAgentSkills: MobileWorkspaceActions["loadAgentSkills"],
) {
  return {
    queryKey: queryKeys.agentSkills(scope, serverId, agentId, manage),
    queryFn: async () => {
      const installed = await loadAgentSkills(agentId, serverId, manage);
      return installed && userAssignedSkills(installed);
    },
  };
}
