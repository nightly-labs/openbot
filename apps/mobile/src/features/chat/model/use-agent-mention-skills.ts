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

/**
 * What the composer of one agent's chat offers after `@` and in Use skill or app: the skills the user
 * gave the agent, that are on and not broken, then the enabled MCP apps of the server, as the desktop
 * composer offers them. Agent info > Skills and the server's MCP page read the same keys, so a skill or
 * an app added there or from the Marketplace shows here. The host lists its apps only to an owner or
 * admin, so a member is offered skills alone.
 */
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
        .filter((skill) => skill.enabled !== false && skill.state !== "needs-repair")
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
  }, [skills.data, apps.data]);
}
