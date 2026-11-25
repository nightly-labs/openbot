import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { agentSkillsQuery } from "@/features/agents/model/agent-skills-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import type { MentionSkill } from "../components/chat-composer";

const NO_SKILLS: readonly MentionSkill[] = [];

export function useAgentMentionSkills(agentId: string, serverId: string, online: boolean): readonly MentionSkill[] {
  const manage = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const { loadAgentSkills } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const { list: apps } = useMcpServerList(serverId);
  const skills = useQuery({
    ...agentSkillsQuery(queryScope, serverId, agentId, manage, loadAgentSkills),
    enabled: online,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(() => {
    const tools: MentionSkill[] = [
      ...(skills.data ?? [])
        .filter(
          (skill) =>
            skill.enabled !== false && skill.state !== "needs-repair" && (manage || skill.problem === undefined),
        )
        .map((skill) => ({
          kind: "skill" as const,
          id: skill.skillId,
          name: skill.name,
          description: skill.description ?? "",
        })),
      ...(apps.data ?? [])
        .filter((app) => app.enabled)
        .map((app) => ({ kind: "mcp" as const, id: app.id, name: app.name, description: "" })),
    ];
    return tools.length > 0 ? tools : NO_SKILLS;
  }, [skills.data, apps.data, manage]);
}
