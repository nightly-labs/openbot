import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, UserRound } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

interface ChannelMemberRowProps {
  /** Missing when the channel holds a member the agent list no longer has. */
  agent?: AgentProfile;
  /** What to call a member the agent list cannot name. */
  fallbackName: string;
  description?: string;
  /** What stands before the avatar, such as the picker checkbox. */
  leading?: JSX.Element;
  /** What stands after the name, such as the lead crown and Remove. */
  actions?: JSX.Element;
  class?: string;
}

/**
 * One agent on one line: the avatar, the name, and whatever the surface adds on either side.
 *
 * Settings, the add-member menu and the New channel dialog all list the same agents, so they list
 * them the same way. Only the slots differ.
 */
export function ChannelMemberRow(props: ChannelMemberRowProps): JSX.Element {
  return (
    <Item size="compact" class={props.class ? `channel-member ${props.class}` : "channel-member"}>
      <Show when={props.leading}>{props.leading}</Show>
      <ItemMedia>
        <Show when={props.agent} fallback={<UserRound aria-hidden="true" />}>
          {(agent) => <AgentAvatar agent={agent()} />}
        </Show>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.agent?.name ?? props.fallbackName}</ItemTitle>
        <Show when={props.description}>
          <ItemDescription>{props.description}</ItemDescription>
        </Show>
      </ItemContent>
      <Show when={props.actions}>{props.actions}</Show>
    </Item>
  );
}
