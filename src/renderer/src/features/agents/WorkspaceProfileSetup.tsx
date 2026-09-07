import { createMemo } from "solid-js";
import { useSidebar } from "../sidebar/sidebar-context";
import { AgentProfileSetup } from "./AgentProfileSetup";
import { useAgentActions } from "./agent-actions";
import { useAgents } from "./agents-context";

export function WorkspaceProfileSetup(props: { agentId?: string; onClose: () => void }) {
  const { agentList } = useAgents();
  const { sidebarLayout } = useSidebar();
  const { saveReviewedProfile } = useAgentActions();
  const initialDraft = createMemo(() => {
    const agent = agentList().find((candidate) => candidate.id === props.agentId);
    return agent
      ? {
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          sectionId: sidebarLayout().agentAssignments[agent.id] ?? null,
        }
      : undefined;
  });
  return (
    <AgentProfileSetup
      agentId={props.agentId}
      initialDraft={initialDraft()}
      sections={sidebarLayout().sections}
      generate={(input) => window.openbot.agent.generateProfile(input)}
      save={saveReviewedProfile}
      onClose={props.onClose}
    />
  );
}
