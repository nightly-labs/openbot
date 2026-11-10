/**
 * "Needs you": every agent or channel that waits for an answer, an approval or a browser takeover,
 * above the sections. It is not a section of the layout. It has no id, no drag target and no
 * collapse, so a chat returns to its own section when the wait ends.
 *
 * "Unread" works the same way, under "Needs you", when the user sorts the chats with "Unread in a
 * group". Its count is neutral: the warning colour belongs to waits.
 *
 * The compact sidebar has no room for the heading; the rows keep their order and their badges.
 */

import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarChatItem } from "./sidebar-types";

export function SidebarWaitingGroup() {
  const { waitingChats } = useSidebarScope();
  const { t } = useText();
  return (
    <SidebarChatGroup
      chats={waitingChats()}
      count={waitingChats().length}
      title={t("sidebar.waiting.title")}
      label={t("sidebar.waiting.label", { count: waitingChats().length })}
    />
  );
}

export function SidebarUnreadGroup() {
  const { props, unreadChats } = useSidebarScope();
  const { t } = useText();
  // The open chat stays in the group after the user reads it. It is not unread, so it is not counted.
  const count = () =>
    unreadChats().filter((chat) =>
      chat.kind === "agent" ? props.agentStates[chat.id]?.kind === "unread" : chat.channel.unreadCount > 0,
    ).length;
  return (
    <SidebarChatGroup
      chats={unreadChats()}
      count={count()}
      title={t("sidebar.unread.title")}
      label={t("sidebar.unread.label", { count: count() })}
      class="sidebar-unread-group"
    />
  );
}

function SidebarChatGroup(props: {
  chats: SidebarChatItem[];
  count: number;
  title: string;
  label: string;
  class?: string;
}) {
  return (
    <Show when={props.chats.length > 0}>
      <section class={["sidebar-chat-group sidebar-waiting-group", props.class]} aria-label={props.label}>
        <header>
          <h2 class="sidebar-waiting-group-name">
            {props.title}
            <Show when={props.count > 0}>
              <span class="sidebar-waiting-group-count" aria-hidden="true">
                {props.count}
              </span>
            </Show>
          </h2>
        </header>
        <For each={props.chats}>
          {(chat) => (
            <Switch>
              <Match when={chat.kind === "agent" ? chat.agent : undefined}>
                {(agent) => <SidebarAgentRow agent={agent()} waiting />}
              </Match>
              <Match when={chat.kind === "channel" ? chat.channel : undefined}>
                {(channel) => <SidebarChannelRow channel={channel()} waiting />}
              </Match>
            </Switch>
          )}
        </For>
      </section>
    </Show>
  );
}
