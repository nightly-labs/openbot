/**
 * A section's header row: the collapse toggle, which doubles as the drag handle, and the section
 * context menu. The menu is inline rather than a component of its own because this is its only
 * caller - both regions that show a section header reach it through here.
 *
 * A folder in a folder names its parent before its own name, in muted text, because folders do not
 * indent. A folder header ends with a folder icon, and with the unread count while it is closed.
 */

import { SIDEBAR_FOLDER_LEVELS } from "@openbot/contracts/ipc";
import {
  ArrowDown,
  ArrowUp,
  Badge,
  buttonVariants,
  ChevronDown,
  ChevronRight,
  ContextMenu,
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SidebarSectionEditor } from "./SidebarSectionEditor";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSectionHeader(headerProps: { sectionId: string; name: string; depth?: number }) {
  const {
    customSectionById,
    duplicateSection,
    filteredChatsBySection,
    foldersSupported,
    layoutMutable,
    moveFolderTo,
    moveSection,
    openDelete,
    pending,
    props,
    sectionCanNest,
    sectionChildren,
    sectionIsCollapsed,
    sectionLabel,
    sectionParent,
    sectionSiblingIndex,
    sectionUnreadCount,
    sidebarClickIsSuppressed,
    startCreateSection,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
    visibleSectionIds,
  } = useSidebarScope();
  const { t } = useText();
  const editing = () => {
    const target = pending.sectionEditor?.target;
    return target?.kind === "rename" && target.sectionId === headerProps.sectionId;
  };
  const collapsed = () => sectionIsCollapsed(headerProps.sectionId);
  const custom = () => customSectionById().has(headerProps.sectionId);
  const sibling = () => sectionSiblingIndex(headerProps.sectionId);
  const depth = () => headerProps.depth ?? 0;
  const parentId = () => sectionParent(headerProps.sectionId);
  const parentName = () => customSectionById().get(parentId() ?? "")?.name;
  const unread = () => (collapsed() ? sectionUnreadCount(headerProps.sectionId) : 0);
  /** An open folder that holds nothing shows a closed folder icon. */
  const empty = () =>
    (filteredChatsBySection().get(headerProps.sectionId)?.length ?? 0) === 0 &&
    sectionChildren(headerProps.sectionId).length === 0;
  const canHoldFolder = () => depth() + 1 < SIDEBAR_FOLDER_LEVELS;
  /** The folders this folder can move into, in list order, without the one it is in now. */
  const destinations = () =>
    visibleSectionIds().filter(
      (sectionId) =>
        customSectionById().has(sectionId) &&
        sectionId !== parentId() &&
        sectionCanNest(headerProps.sectionId, sectionId),
    );
  const createInside = () => {
    if (collapsed()) props.onToggleSection(headerProps.sectionId);
    startCreateSection(undefined, headerProps.sectionId);
  };
  return (
    <Show when={!editing()} fallback={<SidebarSectionEditor />}>
      <header>
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            as="button"
            type="button"
            class={buttonVariants({
              variant: "ghost",
              class: "sidebar-section-toggle sidebar-section-drag-handle",
            })}
            draggable={!layoutMutable() || props.compact ? "false" : "true"}
            title={!layoutMutable() ? t("sidebar.section.layoutUnsupported") : undefined}
            aria-expanded={collapsed() ? "false" : "true"}
            aria-controls={`sidebar-section-body-${headerProps.sectionId}`}
            data-cuelume-open={collapsed() ? "" : undefined}
            data-cuelume-close={collapsed() ? undefined : ""}
            data-cuelume-emphasis="subtle"
            onClick={(event: MouseEvent) => {
              if (!sidebarClickIsSuppressed(event)) props.onToggleSection(headerProps.sectionId);
            }}
            onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) =>
              startSectionDragging(event, headerProps.sectionId)
            }
            onDragEnd={stopSidebarDragging}
          >
            <span
              class="sidebar-section-name"
              title={custom() ? sectionLabel(headerProps.sectionId) : headerProps.name}
            >
              <Show when={custom() ? parentName() : undefined}>
                {(name) => <span class="sidebar-folder-parent">{name()} / </span>}
              </Show>
              {headerProps.name}
            </span>
            <Show
              when={custom()}
              fallback={
                <ChevronDown
                  class={`sidebar-section-chevron size-4${collapsed() ? " sidebar-section-chevron-collapsed" : ""}`}
                  aria-hidden="true"
                />
              }
            >
              <span class="sidebar-folder-end">
                <Show when={unread() > 0}>
                  <Badge class="sidebar-folder-unread" variant="primary-light" aria-hidden="true">
                    {Math.min(unread(), 99)}
                  </Badge>
                  <span class="sr-only">{t("sidebar.folder.unread", { count: unread() })}</span>
                </Show>
                <Show
                  when={collapsed() || empty()}
                  fallback={<FolderOpen class="sidebar-folder-icon size-4" aria-hidden="true" />}
                >
                  <Folder class="sidebar-folder-icon size-4" aria-hidden="true" />
                </Show>
              </span>
            </Show>
          </ContextMenu.Trigger>
          <Show when={layoutMutable()}>
            <ContextMenu.Portal>
              <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.section.actions")}>
                <Show when={custom()}>
                  <ContextMenu.Item onSelectAfterClose={() => startRenameSection(headerProps.sectionId)}>
                    <Pencil class="agent-context-icon size-4" aria-hidden="true" />
                    <span>{t("common.rename")}</span>
                  </ContextMenu.Item>
                  <Show when={foldersSupported()}>
                    <ContextMenu.Item disabled={!canHoldFolder()} onSelectAfterClose={createInside}>
                      <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
                      <span>{t("sidebar.folder.newInside")}</span>
                    </ContextMenu.Item>
                  </Show>
                  <Show when={props.sectionDuplicateSupported && props.onDuplicateSection}>
                    <ContextMenu.Item
                      disabled={props.duplicatingSectionIds?.has(headerProps.sectionId) ?? false}
                      onSelect={() => duplicateSection(headerProps.sectionId)}
                    >
                      <Copy class="agent-context-icon size-4" aria-hidden="true" />
                      <span>
                        {props.duplicatingSectionIds?.has(headerProps.sectionId)
                          ? t("sidebar.section.duplicating")
                          : t("sidebar.section.duplicate")}
                      </span>
                    </ContextMenu.Item>
                  </Show>
                </Show>
                <Show when={custom() && foldersSupported() && (parentId() !== null || destinations().length > 0)}>
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger>
                      <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
                      <span>{t("sidebar.moveTo")}</span>
                      <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent
                        class="ui-action-menu agent-context-menu agent-context-submenu"
                        aria-label={t("sidebar.moveTo")}
                      >
                        <Show when={parentId() !== null}>
                          <ContextMenu.Item onSelect={() => moveFolderTo(headerProps.sectionId, null)}>
                            <FolderOpen class="agent-context-icon size-4" aria-hidden="true" />
                            <span>{t("sidebar.folder.topLevel")}</span>
                          </ContextMenu.Item>
                        </Show>
                        <For each={destinations()}>
                          {(sectionId) => (
                            <ContextMenu.Item onSelect={() => moveFolderTo(headerProps.sectionId, sectionId)}>
                              <Folder class="agent-context-icon size-4" aria-hidden="true" />
                              <span>{sectionLabel(sectionId)}</span>
                            </ContextMenu.Item>
                          )}
                        </For>
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                </Show>
                <ContextMenu.Item
                  disabled={sibling().index <= 0}
                  onSelect={() => moveSection(headerProps.sectionId, "up")}
                >
                  <ArrowUp class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.section.moveUp")}</span>
                </ContextMenu.Item>
                <ContextMenu.Item
                  disabled={sibling().index < 0 || sibling().index >= sibling().total - 1}
                  onSelect={() => moveSection(headerProps.sectionId, "down")}
                >
                  <ArrowDown class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.section.moveDown")}</span>
                </ContextMenu.Item>
                <Show when={custom()}>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    class="ui-action-menu-danger agent-context-danger"
                    onSelect={() => openDelete("section", headerProps.sectionId)}
                  >
                    <Trash2 class="agent-context-icon agent-context-danger-icon size-4" aria-hidden="true" />
                    <span>{t("common.delete")}</span>
                  </ContextMenu.Item>
                </Show>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </Show>
        </ContextMenu.Root>
      </header>
    </Show>
  );
}
