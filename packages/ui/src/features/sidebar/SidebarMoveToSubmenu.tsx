import { Check, ChevronRight, ContextMenu, Folder, FolderInput, FolderPlus } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarMoveToSubmenu(menuProps: { chatId: string }) {
  const {
    assignChatSection,
    customSectionById,
    layoutMutable,
    props,
    sectionLabel,
    startCreateSection,
    visibleSectionIds,
  } = useSidebarScope();
  const folderIds = () => visibleSectionIds().filter((sectionId) => customSectionById().has(sectionId));
  const { t } = useText();
  const currentSectionId = () =>
    customSectionById().has(props.layout.agentAssignments[menuProps.chatId] ?? "")
      ? props.layout.agentAssignments[menuProps.chatId]
      : null;
  return (
    <Show when={layoutMutable()}>
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
            <For each={folderIds()}>
              {(sectionId) => (
                <ContextMenu.Item onSelect={() => assignChatSection(menuProps.chatId, sectionId)}>
                  <Show
                    when={currentSectionId() === sectionId}
                    fallback={<Folder class="agent-context-icon size-4" aria-hidden="true" />}
                  >
                    <Check class="agent-context-icon size-4" aria-hidden="true" />
                  </Show>
                  <span>{sectionLabel(sectionId)}</span>
                </ContextMenu.Item>
              )}
            </For>
            <ContextMenu.Item onSelect={() => assignChatSection(menuProps.chatId, null)}>
              <Show
                when={currentSectionId() === null}
                fallback={<Folder class="agent-context-icon size-4" aria-hidden="true" />}
              >
                <Check class="agent-context-icon size-4" aria-hidden="true" />
              </Show>
              <span>{t("sidebar.section.unassigned")}</span>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelectAfterClose={() => startCreateSection(menuProps.chatId)}>
              <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("sidebar.new.section")}</span>
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    </Show>
  );
}
