/**
 * The scrolling list itself. This element is the one `measureSidebarDragSlots` queries, so its ref
 * is the rail the whole drag pipeline runs on: `setAgentListElement` hands it to the engine and to
 * the scroll fades in that order.
 */

import { Show } from "solid-js";
import { ContextMenu, FolderPlus } from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
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
  const i18n = useI18n();
  return (
    <nav
      ref={setAgentListElement}
      aria-label={i18n.t("sidebar.chatList")}
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
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {reorderAnnouncement()}
        </span>
      </div>
      <Show when={layoutMutable() || props.onToggleArchivedChannels}>
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger class="sidebar-list-context-trigger" aria-label={i18n.t("sidebar.freeArea")} />
          <ContextMenu.Portal>
            <ContextMenu.Content class="agent-context-menu" aria-label={i18n.t("sidebar.actions")}>
              <Show when={layoutMutable()}>
                <ContextMenu.Item onSelect={() => startCreateSection()}>
                  <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{i18n.t("sidebar.newSection")}</span>
                </ContextMenu.Item>
              </Show>
              <Show when={props.onToggleArchivedChannels}>
                <ContextMenu.Item onSelect={() => props.onToggleArchivedChannels?.()}>
                  {props.showingArchivedChannels ? i18n.t("sidebar.showActiveChats") : i18n.t("sidebar.archivedChats")}
                </ContextMenu.Item>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </Show>
    </nav>
  );
}
