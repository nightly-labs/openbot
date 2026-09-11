/**
 * The "Move to" submenu, shared by the agent and the channel menus. `currentSectionId` is the
 * menu's own answer - null when the chat sits in no custom section, which is what draws the tick
 * beside "Unassigned". The scope's `assignedSectionId` answers a different question for the drag
 * measurements, and falls back to the unassigned section instead of null.
 *
 * This is the keyboard route to what dragging a row does with the pointer, so it has to reach every
 * kind of row a section can hold.
 */

import { For, Show } from "solid-js";
import { Check, ChevronRight, ContextMenu, Folder, FolderInput, FolderPlus } from "../../components/ui";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarMoveToSubmenu(menuProps: { chatId: string }) {
  const { assignChatSection, customSectionById, layoutMutable, props, startCreateSection } = useSidebarScope();
  const currentSectionId = () =>
    customSectionById().has(props.layout.agentAssignments[menuProps.chatId] ?? "")
      ? props.layout.agentAssignments[menuProps.chatId]
      : null;
  return (
    <Show when={layoutMutable()}>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>
          <FolderInput class="agent-context-icon size-4" aria-hidden="true" />
          <span>Move to</span>
          <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent class="ui-action-menu agent-context-menu agent-context-submenu" aria-label="Move to">
            <For each={props.layout.sections}>
              {(section) => (
                <ContextMenu.Item onSelect={() => assignChatSection(menuProps.chatId, section.id)}>
                  <Show
                    when={currentSectionId() === section.id}
                    fallback={<Folder class="agent-context-icon size-4" aria-hidden="true" />}
                  >
                    <Check class="agent-context-icon size-4" aria-hidden="true" />
                  </Show>
                  <span>{section.name}</span>
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
              <span>Unassigned</span>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => startCreateSection(menuProps.chatId)}>
              <FolderPlus class="agent-context-icon size-4" aria-hidden="true" />
              <span>New section</span>
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    </Show>
  );
}
