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
      title={t("sidebar.waiting.title")}
      label={t("sidebar.waiting.label", { count: waitingChats().length })}
    />
  );
}

export function SidebarUnreadGroup() {
  const { unreadChats } = useSidebarScope();
  const { t } = useText();
  return (
    <SidebarChatGroup
      chats={unreadChats()}
      title={t("sidebar.unread.title")}
      label={t("sidebar.unread.label", { count: unreadChats().length })}
      class="sidebar-unread-group"
    />
  );
}

function SidebarChatGroup(props: { chats: SidebarChatItem[]; title: string; label: string; class?: string }) {
  return (
    <Show when={props.chats.length > 0}>
      <section class={["sidebar-chat-group sidebar-waiting-group", props.class]} aria-label={props.label}>
        <header>
          <h2 class="sidebar-waiting-group-name">
            {props.title}
            <span class="sidebar-waiting-group-count" aria-hidden="true">
              {props.chats.length}
            </span>
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
