import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarSectionDraft } from "./SidebarSectionEditor";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarAgentSection(sectionProps: { sectionId: string; depth: number; stickyLevel: number }) {
  const {
    customSectionById,
    dragOffset,
    filteredChatsBySection,
    listFiltered,
    props,
    sectionChildren,
    sectionDragClasses,
    sectionIsCollapsed,
    sectionLabel,
  } = useSidebarScope();
  const { t } = useText();
  const sectionId = () => sectionProps.sectionId;
  const chats = () => filteredChatsBySection().get(sectionId()) ?? [];
  const custom = () => customSectionById().get(sectionId());
  const children = () => (custom() ? sectionChildren(sectionId()) : []);
  const name = () =>
    sectionId() === SIDEBAR_UNASSIGNED_SECTION_ID ? t("sidebar.section.unassigned") : (custom()?.name ?? "");
  const headed = () =>
    (Boolean(custom()) || props.layout.sections.length > 0) && !(listFiltered() && custom() && chats().length === 0);
  const collapsed = () => headed() && sectionIsCollapsed(sectionId());
  return (
    <Show when={name() && (chats().length > 0 || custom())}>
      <section
        class={[
          "sidebar-chat-group sidebar-section",
          { "sidebar-folder": Boolean(custom()) },
          sectionDragClasses(sectionId()),
        ]}
        style={`--sidebar-drag-y: ${dragOffset(sectionId()).y}px;`}
        aria-label={custom() ? sectionLabel(sectionId()) : name()}
        data-section-id={sectionId()}
        data-depth={custom() ? String(sectionProps.depth) : undefined}
        data-sticky-level={custom() && headed() ? String(sectionProps.stickyLevel) : undefined}
      >
        <Show when={headed()}>
          <SidebarSectionHeader sectionId={sectionId()} name={name()} depth={sectionProps.depth} />
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
            <For each={children()}>
              {(childId) => (
                <SidebarAgentSection
                  sectionId={childId}
                  depth={sectionProps.depth + 1}
                  stickyLevel={headed() ? sectionProps.stickyLevel + 1 : sectionProps.stickyLevel}
                />
              )}
            </For>
            <Show when={custom()}>
              <SidebarSectionDraft parentId={sectionId()} />
            </Show>
          </div>
        </div>
      </section>
    </Show>
  );
}
