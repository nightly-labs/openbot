/**
 * The scrolling list itself. This element is the one `measureSidebarDragSlots` queries, so its ref
 * is the rail the whole drag pipeline runs on: `setAgentListElement` hands it to the engine and to
 * the scroll fades in that order.
 */

import { ContextMenu, FolderPlus, Hash } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarChannelRow } from "./SidebarChannelRow";
import { SidebarEmptyState } from "./SidebarEmptyState";
import { SidebarPinnedGroup } from "./SidebarPinnedGroup";
import { SidebarSectionList } from "./SidebarSectionList";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarNav() {
  const {
    draggingKind,
    dropSidebarNativeDrag,
    filteredChats,
    filteredPeople,
    handleListDragLeave,
    layoutMutable,
    pending,
    props,
    reorderAnnouncement,
    resolvedPinnedItems,
    scrollFades,
    setAgentListElement,
    startCreateSection,
    updateSidebarNativeDrag,
  } = useSidebarScope();
  const { t } = useText();
  return (
    <nav
      ref={setAgentListElement}
      aria-label={t("sidebar.nav.label")}
      class={["agent-list", scrollFades.classes()]}
      data-sidebar-dragging={draggingKind()}
      onDragOver={updateSidebarNativeDrag}
      onDragLeave={handleListDragLeave}
      onDrop={dropSidebarNativeDrag}
      onScroll={scrollFades.measure}
    >
      <div class="agent-list-content">
        <Show
          when={
            resolvedPinnedItems().length === 0 &&
            filteredChats().length === 0 &&
            (props.showPeople === false || filteredPeople().length === 0) &&
            pending.sectionEditor?.target.kind !== "create"
          }
        >
          <SidebarEmptyState />
        </Show>
        <SidebarPinnedGroup />
        <SidebarSectionList />
        <Show when={props.showingArchivedChannels}>
          <section class="sidebar-chat-group sidebar-section" aria-label={t("sidebar.deletedChannels.title")}>
            <h2 class="sidebar-section-name">{t("sidebar.deletedChannels.title")}</h2>
            <For each={props.deletedChannels} fallback={<p>{t("sidebar.deletedChannels.empty")}</p>}>
              {(channel) => <SidebarChannelRow channel={channel} />}
            </For>
          </section>
        </Show>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {reorderAnnouncement()}
        </span>
      </div>
      <Show when={props.onCreateChannel || layoutMutable() || props.onToggleArchivedChannels}>
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger class="sidebar-list-context-trigger" aria-label={t("sidebar.nav.freeArea")} />
          <ContextMenu.Portal>
            <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.nav.actions")}>
              <Show when={props.onCreateChannel}>
                <ContextMenu.Item onSelect={() => props.onCreateChannel?.()}>
                  <Hash class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.new.channel")}</span>
                </ContextMenu.Item>
              </Show>
              <Show when={layoutMutable()}>
                <ContextMenu.Item onSelect={() => startCreateSection()}>
                  <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.new.section")}</span>
                </ContextMenu.Item>
              </Show>
              <Show when={props.onToggleArchivedChannels}>
                <ContextMenu.Item onSelect={() => props.onToggleArchivedChannels?.()}>
                  {props.showingArchivedChannels
                    ? t("sidebar.deletedChannels.hide")
                    : t("sidebar.deletedChannels.title")}
                </ContextMenu.Item>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </Show>
    </nav>
  );
}
