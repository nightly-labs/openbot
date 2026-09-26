/**
 * One channel in a section. A channel is filed and dragged exactly like an agent, so this shares
 * the agent row's drag wrapper, its `.agent-row` anatomy and its context menu's pin and "Move to"
 * items; what differs is the avatar, the preview line and the agent-only actions it leaves out.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Badge, buttonVariants, ContextMenu } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { SidebarChannelContextMenu } from "./SidebarChannelContextMenu";
import { sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarChannelRow(rowProps: { channel: ChannelSummary }) {
  const {
    dragOffset,
    draggedChatId,
    endChatDragging,
    layoutMutable,
    props,
    sidebarClickIsSuppressed,
    startChatDragging,
  } = useSidebarScope();
  const { t, format } = useText();
  const active = () => props.activeChannelId === rowProps.channel.id;
  const title = () => rowProps.channel.title.trim();
  /* Running work is a prefix on the preview line rather than a word beside the name: one line
   * carries both and the row keeps the height every other row in the list has. */
  const preview = () => {
    const text = rowProps.channel.lastMessage?.text ?? t("sidebar.channel.noMessages");
    return rowProps.channel.activeTasks > 0 ? t("sidebar.channel.workingPreview", { preview: text }) : text;
  };
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Native drag belongs to the wrapper around the accessible button. */
    <div
      class={[
        "sidebar-agent-item",
        {
          "sidebar-agent-item-dragging": draggedChatId() === rowProps.channel.id,
          "sidebar-drag-shifting": dragOffset(rowProps.channel.id).y !== 0,
        },
      ]}
      style={`--sidebar-drag-y: ${dragOffset(rowProps.channel.id).y}px;`}
      data-chat-id={rowProps.channel.id}
      draggable={rowProps.channel.archived || !layoutMutable() || props.compact ? "false" : "true"}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => startChatDragging(event, rowProps.channel.id)}
      onDragEnd={endChatDragging}
    >
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger
          as="button"
          type="button"
          class={[
            buttonVariants({ variant: "ghost" }),
            "agent-row channel-row",
            {
              "agent-row-active": active(),
              "sidebar-agent-row-dragging": draggedChatId() === rowProps.channel.id,
            },
          ]}
          aria-label={`${rowProps.channel.name}${title() ? `, ${title()}` : ""}. ${preview()}`}
          aria-pressed={active() ? "true" : "false"}
          onClick={(event: MouseEvent) => {
            if (!sidebarClickIsSuppressed(event)) props.onSelectChannel?.(rowProps.channel.id);
          }}
        >
          <span class="agent-row-avatar">
            <ChannelAvatar members={rowProps.channel.members} agents={props.agents} layout="cluster" />
            <Show when={rowProps.channel.unreadCount > 0}>
              <Badge class="person-unread-badge" tone="accent" shape="pill" aria-hidden="true">
                {Math.min(rowProps.channel.unreadCount, 99)}
              </Badge>
            </Show>
          </span>
          <span class="agent-row-copy">
            <span class="agent-row-heading">
              <span class="agent-row-title">
                <strong>{rowProps.channel.name}</strong>
                <Show when={title()}>
                  {(label) => (
                    <Badge class="agent-role-badge" size="sm" title={label()}>
                      <span>{label()}</span>
                    </Badge>
                  )}
                </Show>
              </span>
              <span class="agent-row-time">
                {sidebarMessageTime(rowProps.channel.lastMessage?.at ?? rowProps.channel.createdAt, format)}
              </span>
            </span>
            <span class="agent-row-preview">{preview()}</span>
          </span>
          <Show when={rowProps.channel.unreadCount > 0}>
            <span class="sr-only">{t("sidebar.channel.unread", { count: rowProps.channel.unreadCount })}</span>
          </Show>
        </ContextMenu.Trigger>
        <Show when={!rowProps.channel.archived}>
          <SidebarChannelContextMenu channel={rowProps.channel} pinned={false} />
        </Show>
      </ContextMenu.Root>
    </div>
  );
}
