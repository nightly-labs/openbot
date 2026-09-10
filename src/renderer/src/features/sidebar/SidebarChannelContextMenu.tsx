/** The right-click menu on a channel, in the pinned strip and in a section alike. */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Show } from "solid-js";
import { ContextMenu, Pin, PinOff } from "../../components/ui";
import { DeleteIcon, EditIcon } from "./SidebarIcons";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarChannelContextMenu(menuProps: { channel: ChannelSummary; pinned: boolean }) {
  const { openDelete, props } = useSidebarScope();
  const ref = (): SidebarPinnedItem => ({ kind: "channel", id: menuProps.channel.id });
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label="Channel actions">
        <ContextMenu.Item onSelect={() => (menuProps.pinned ? props.onUnpin(ref()) : props.onPin(ref()))}>
          <Show when={menuProps.pinned} fallback={<Pin class="agent-context-icon size-4" aria-hidden="true" />}>
            <PinOff class="agent-context-icon size-4" aria-hidden="true" />
          </Show>
          <span>{menuProps.pinned ? "Unpin" : "Pin"}</span>
        </ContextMenu.Item>
        <SidebarMoveToSubmenu chatId={menuProps.channel.id} />
        <ContextMenu.Item onSelect={() => props.onEditChannel?.(menuProps.channel.id)}>
          <EditIcon />
          <span>Edit channel</span>
        </ContextMenu.Item>
        <Show when={menuProps.channel.archived && props.onRestoreChannel}>
          <ContextMenu.Item
            onSelect={() => {
              const restore = props.onRestoreChannel;
              if (restore) void restore(menuProps.channel.id).catch(() => undefined);
            }}
          >
            <span>Restore channel</span>
          </ContextMenu.Item>
        </Show>
        <Show when={props.onDeleteChannel}>
          <ContextMenu.Separator />
          <ContextMenu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => openDelete("channel", menuProps.channel.id)}
          >
            <DeleteIcon />
            <span>Delete channel</span>
          </ContextMenu.Item>
        </Show>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
