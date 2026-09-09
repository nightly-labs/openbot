/**
 * The stack of member avatars. It takes the agents to look members up in rather than reading the
 * Agents context: the sidebar renders channel rows from the agent list it is already given, and a
 * row that reached for a context of its own would be the one row in the list that cannot render
 * without it.
 */

import type { ChannelMember } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { UsersRound } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

export function ChannelAvatar(props: { members: ChannelMember[]; agents: AgentProfile[] }) {
  const agentFor = (member: ChannelMember) => props.agents.find((agent) => agent.id === member.agentId);
  return (
    <span class="channel-avatar" aria-hidden="true">
      <Show when={props.members.length} fallback={<UsersRound />}>
        <For each={props.members.slice(0, 3)}>
          {(member) => <AgentAvatar agent={agentFor(member)} seed={agentFor(member)?.avatarSeed ?? member.agentId} />}
        </For>
      </Show>
    </span>
  );
}
