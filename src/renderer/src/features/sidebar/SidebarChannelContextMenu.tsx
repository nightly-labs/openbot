/** The right-click menu on a channel, in the pinned strip and in a section alike. */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Show } from "solid-js";
import { ContextMenu, Pin, PinOff } from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";
import { DeleteIcon, EditIcon } from "./SidebarIcons";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarChannelContextMenu(menuProps: { channel: ChannelSummary; pinned: boolean }) {
  const { openDelete, props } = useSidebarScope();
  const i18n = useI18n();
  const ref = (): SidebarPinnedItem => ({ kind: "channel", id: menuProps.channel.id });
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content class="agent-context-menu" aria-label={i18n.t("sidebar.channelActions")}>
        <ContextMenu.Item onSelect={() => (menuProps.pinned ? props.onUnpin(ref()) : props.onPin(ref()))}>
          <Show when={menuProps.pinned} fallback={<Pin class="agent-context-icon size-4" aria-hidden="true" />}>
            <PinOff class="agent-context-icon size-4" aria-hidden="true" />
          </Show>
          <span>{menuProps.pinned ? i18n.t("common.unpin") : i18n.t("common.pin")}</span>
        </ContextMenu.Item>
        <SidebarMoveToSubmenu chatId={menuProps.channel.id} />
        <ContextMenu.Item onSelect={() => props.onEditChannel?.(menuProps.channel.id)}>
          <EditIcon />
          <span>{i18n.t("sidebar.editChannel")}</span>
        </ContextMenu.Item>
        <Show when={menuProps.channel.archived && props.onRestoreChannel}>
          <ContextMenu.Item
            onSelect={() => {
              const restore = props.onRestoreChannel;
              if (restore) void restore(menuProps.channel.id).catch(() => undefined);
            }}
          >
            <span>{i18n.t("sidebar.restoreChannel")}</span>
          </ContextMenu.Item>
        </Show>
        <Show when={props.onDeleteChannel}>
          <ContextMenu.Separator />
          <ContextMenu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => openDelete("channel", menuProps.channel.id)}
          >
            <DeleteIcon />
            <span>{i18n.t("sidebar.deleteChannel")}</span>
          </ContextMenu.Item>
        </Show>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
