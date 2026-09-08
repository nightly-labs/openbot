import type { GroupMember } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { UsersRound } from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";

export function GroupAvatar(props: { members: GroupMember[] }) {
  const { agentList } = useAgents();
  return (
    <span class="group-avatar" aria-hidden="true">
      <Show when={props.members.length} fallback={<UsersRound />}>
        <For each={props.members.slice(0, 3)}>
          {(member) => (
            <AgentAvatar
              agent={agentList().find((agent) => agent.id === member.agentId)}
              seed={agentList().find((agent) => agent.id === member.agentId)?.avatarSeed ?? member.agentId}
            />
          )}
        </For>
      </Show>
    </span>
  );
}
