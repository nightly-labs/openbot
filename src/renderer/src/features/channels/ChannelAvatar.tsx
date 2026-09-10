/**
 * The stack of member avatars. It takes the agents to look members up in rather than reading the
 * Agents context: the sidebar renders channel rows from the agent list it is already given, and a
 * row that reached for a context of its own would be the one row in the list that cannot render
 * without it.
 *
 * Two layouts: a row of overlapping avatars, and the cluster the sidebar uses, which holds the
 * members in the square one agent avatar occupies. The cluster keeps a channel row the same shape
 * as the agent rows around it, and it counts the members it cannot show.
 */

import type { ChannelMember } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { UsersRound } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

const ROW_LIMIT = 3;
const CLUSTER_CELLS = 4;

export function ChannelAvatar(props: { members: ChannelMember[]; agents: AgentProfile[]; layout?: "row" | "cluster" }) {
  const agentFor = (member: ChannelMember) => props.agents.find((agent) => agent.id === member.agentId);
  const cluster = () => props.layout === "cluster";
  /* The last cell of a full cluster is the count, so a fifth member costs a face rather than
   * hiding without a trace. Four members still get four faces. */
  const shown = () => {
    if (!cluster()) return props.members.slice(0, ROW_LIMIT);
    return props.members.slice(0, props.members.length > CLUSTER_CELLS ? CLUSTER_CELLS - 1 : CLUSTER_CELLS);
  };
  const hidden = () => props.members.length - shown().length;
  return (
    <span class={["channel-avatar", { "channel-avatar-cluster": cluster() }]} aria-hidden="true">
      <Show when={props.members.length} fallback={<UsersRound />}>
        <For each={shown()}>
          {(member) => <AgentAvatar agent={agentFor(member)} seed={agentFor(member)?.avatarSeed ?? member.agentId} />}
        </For>
        <Show when={cluster() && hidden() > 0}>
          <span class="channel-avatar-count">+{hidden()}</span>
        </Show>
      </Show>
    </span>
  );
}
