/**
 * One section - the unassigned one included. A custom section stays visible while empty so it can
 * be dropped into, but only when nothing is being searched for: during a search an empty section is
 * noise, not a target.
 *
 * The unassigned section keeps its heading only once a custom section exists. Before that it is the
 * whole list, and "Unassigned" names it against nothing.
 */

import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { For, Match, Show, Switch } from "solid-js";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarAgentSection(sectionProps: { sectionId: string }) {
  const {
    customSectionById,
    dragOffset,
    filteredChatsBySection,
    normalizedQuery,
    props,
    sectionDragClasses,
    sectionIsCollapsed,
  } = useSidebarScope();
  const sectionId = () => sectionProps.sectionId;
  const chats = () => filteredChatsBySection().get(sectionId()) ?? [];
  const custom = () => customSectionById().get(sectionId());
  const name = () => (sectionId() === SIDEBAR_UNASSIGNED_SECTION_ID ? "Unassigned" : (custom()?.name ?? ""));
  const headed = () => Boolean(custom()) || props.layout.sections.length > 0;
  const collapsed = () => headed() && sectionIsCollapsed(sectionId());
  return (
    <Show when={name() && (chats().length > 0 || (custom() && !normalizedQuery()))}>
      <section
        class={["sidebar-chat-group sidebar-section", sectionDragClasses(sectionId())]}
        style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
        aria-label={name()}
        data-section-id={sectionId()}
      >
        <Show when={headed()}>
          <SidebarSectionHeader sectionId={sectionId()} name={name()} />
        </Show>
        <div
          class="sidebar-section-collapse"
          data-collapsed={collapsed() ? "" : undefined}
          aria-hidden={collapsed() ? "true" : undefined}
          inert={collapsed() ? true : undefined}
        >
          <div id={`sidebar-section-body-${sectionId()}`} class="sidebar-section-body">
            <For each={chats()}>
              {(chat) => (
                <Switch>
                  <Match when={chat.kind === "agent" ? chat.agent : undefined}>
                    {(agent) => <SidebarAgentRow agent={agent()} />}
                  </Match>
                  <Match when={chat.kind === "channel" ? chat.channel : undefined}>
                    {(channel) => <SidebarChannelRow channel={channel()} />}
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </div>
      </section>
    </Show>
  );
}
