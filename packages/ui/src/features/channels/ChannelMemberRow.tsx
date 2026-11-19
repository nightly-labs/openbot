import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, UserRound } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

interface ChannelMemberRowProps {
  agent?: AgentProfile | undefined;
  fallbackName: string;
  description?: string;
  leading?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
}

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
