/**
 * "Needs you": every agent or channel that waits for an answer, an approval or a browser takeover,
 * above the sections. It is not a section of the layout. It has no id, no drag target and no
 * collapse, so a chat returns to its own section when the wait ends.
 *
 * "Unread" works the same way, under "Needs you", when the user sorts the chats with "Unread in a
 * group". Its count is neutral: the warning colour belongs to waits. A right click on its heading
 * turns the group off or changes the order, as Settings > Conversations does.
 *
 * The compact sidebar has no room for the heading; the rows keep their order and their badges.
 */

import { CheckCheck, ContextMenu, EyeOff } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarChatOrderSubmenu } from "./SidebarChatOrderSubmenu";
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
  const { chatIsUnread, props, unreadChats } = useSidebarScope();
  const { t } = useText();
  // The open chat stays in the group after the user reads it while the pointer is over the list. It
  // is not unread, so it is not counted.
  const count = () => unreadChats().filter((chat) => chatIsUnread(chat.id)).length;
  return (
    <SidebarChatGroup
      chats={unreadChats()}
      count={count()}
      title={t("sidebar.unread.title")}
      label={t("sidebar.unread.label", { count: count() })}
      class="sidebar-unread-group"
      heading={(heading) => (
        <Show when={props.onChatOrderChange} fallback={<header>{heading()}</header>}>
          <ContextMenu.Root modal={false}>
            <ContextMenu.Trigger as="header">{heading()}</ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.unread.actions")}>
                <Show when={props.onMarkAllRead}>
                  <ContextMenu.Item disabled={!props.hasUnread} onSelect={() => props.onMarkAllRead?.()}>
                    <CheckCheck class="agent-context-icon size-4" aria-hidden="true" />
                    <span>{t("sidebar.markAllRead")}</span>
                  </ContextMenu.Item>
                </Show>
                <ContextMenu.Item onSelect={() => props.onChatOrderChange?.("manual")}>
                  <EyeOff class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.unread.turnOff")}</span>
                </ContextMenu.Item>
                <SidebarChatOrderSubmenu />
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </Show>
      )}
    />
  );
}

function SidebarChatGroup(props: {
  chats: SidebarChatItem[];
  count: number;
  title: string;
  label: string;
  class?: string;
  /**
   * Wraps the `header` element, for a group whose heading has a menu. `heading` makes a new node at
   * each call, so each branch of the wrapper has its own.
   */
  heading?: (heading: () => JSX.Element) => JSX.Element;
}) {
  const heading = () => (
    <h2 class="sidebar-waiting-group-name">
      {props.title}
      <Show when={props.count > 0}>
        <span class="sidebar-waiting-group-count" aria-hidden="true">
          {props.count}
        </span>
      </Show>
    </h2>
  );
  return (
    <Show when={props.chats.length > 0}>
      <section class={["sidebar-chat-group sidebar-waiting-group", props.class]} aria-label={props.label}>
        {props.heading ? props.heading(heading) : <header>{heading()}</header>}
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
