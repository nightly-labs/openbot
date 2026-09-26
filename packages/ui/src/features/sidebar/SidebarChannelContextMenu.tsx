/** The right-click menu on a channel, in the pinned strip and in a section alike. */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { ContextMenu, Hash, Pin, PinOff } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { DeleteIcon, EditIcon } from "./SidebarIcons";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarChannelContextMenu(menuProps: { channel: ChannelSummary; pinned: boolean }) {
  const { openDelete, props } = useSidebarScope();
  const { t } = useText();
  const ref = (): SidebarPinnedItem => ({ kind: "channel", id: menuProps.channel.id });
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label={t("sidebar.channelMenu.label")}>
        <Show when={props.onCreateChannel}>
          <ContextMenu.Item onSelect={() => props.onCreateChannel?.()}>
            <Hash class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("sidebar.new.channel")}</span>
          </ContextMenu.Item>
        </Show>
        <ContextMenu.Item onSelect={() => (menuProps.pinned ? props.onUnpin(ref()) : props.onPin(ref()))}>
          <Show when={menuProps.pinned} fallback={<Pin class="agent-context-icon size-4" aria-hidden="true" />}>
            <PinOff class="agent-context-icon size-4" aria-hidden="true" />
          </Show>
          <span>{menuProps.pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
        </ContextMenu.Item>
        <SidebarMoveToSubmenu chatId={menuProps.channel.id} />
        <ContextMenu.Item onSelect={() => props.onEditChannel?.(menuProps.channel.id)}>
          <EditIcon />
          <span>{t("sidebar.channelMenu.edit")}</span>
        </ContextMenu.Item>
        <Show when={props.onDeleteChannel}>
          <ContextMenu.Separator />
          <ContextMenu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => openDelete("channel", menuProps.channel.id)}
          >
            <DeleteIcon />
            <span>{t("sidebar.channelMenu.delete")}</span>
          </ContextMenu.Item>
        </Show>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
