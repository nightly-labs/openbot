/**
 * "Needs you": every agent or channel that waits for an answer, an approval or a browser takeover,
 * above the sections. It is not a section of the layout. It has no id, no drag target and no
 * collapse, so a chat returns to its own section when the wait ends.
 *
 * The compact sidebar has no room for the heading; the rows keep their order and their badges.
 */

import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarWaitingGroup() {
  const { waitingChats } = useSidebarScope();
  const { t } = useText();
  return (
    <Show when={waitingChats().length > 0}>
      <section
        class="sidebar-chat-group sidebar-waiting-group"
        aria-label={t("sidebar.waiting.label", { count: waitingChats().length })}
      >
        <header>
          <h2 class="sidebar-waiting-group-name">
            {t("sidebar.waiting.title")}
            <span class="sidebar-waiting-group-count" aria-hidden="true">
              {waitingChats().length}
            </span>
          </h2>
        </header>
        <For each={waitingChats()}>
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
