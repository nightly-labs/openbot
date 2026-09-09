/**
 * The right-click menu on a channel, in the pinned strip and in a section alike. A channel is
 * pinned and filed exactly like an agent, so it carries the same two items; everything an agent
 * menu adds beyond them - edit, duplicate, delete - belongs to the agent, not to a shared chat.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Show } from "solid-js";
import { ContextMenu, Pin, PinOff } from "../../components/ui";
import { SidebarMoveToSubmenu } from "./SidebarMoveToSubmenu";
import type { SidebarPinnedItem } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarChannelContextMenu(menuProps: { channel: ChannelSummary; pinned: boolean }) {
  const { props } = useSidebarScope();
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
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
