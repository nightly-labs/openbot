/**
 * One channel in a section. A channel is filed and dragged exactly like an agent, so this shares
 * the agent row's drag wrapper, its `.agent-row` anatomy and its context menu's pin and "Move to"
 * items; what differs is the avatar, the preview line and the agent-only actions it leaves out.
 *
 * A channel whose work waits for the user sits in the "Needs you" group, as a waiting agent does.
 * There it does not drag, and it has the same badge, chip and tooltip as the agent row.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Badge, buttonVariants, ContextMenu } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { SidebarAgentIndicator, SidebarWaitChip, SidebarWaitTooltip } from "./SidebarAgentIndicator";
import { SidebarChannelContextMenu, SidebarDeletedChannelContextMenu } from "./SidebarChannelContextMenu";
import { SidebarNameTooltip } from "./SidebarNameTooltip";
import { sidebarUnreadBadge } from "./sidebar-agent-states";
import { sidebarAgentStateLabel, sidebarMessageTime } from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

/** `waiting` is set by the "Needs you" and "Unread" groups, as on `SidebarAgentRow`. */
export function SidebarChannelRow(rowProps: { channel: ChannelSummary; waiting?: boolean }) {
  const {
    dragOffset,
    draggedChatId,
    endChatDragging,
    chatsDraggable,
    props,
    sidebarClickIsSuppressed,
    startChatDragging,
  } = useSidebarScope();
  const { t, format } = useText();
  const active = () => props.activeChannelId === rowProps.channel.id;
  const channelWait = () => props.channelWaits?.[rowProps.channel.id];
  const badgeState = createMemo(() => sidebarUnreadBadge(rowProps.channel.unreadCount, channelWait()));
  const wait = () => (rowProps.waiting ? channelWait() : undefined);
  const stateLabel = () => {
    const current = channelWait();
    return current ? sidebarAgentStateLabel(current, t, format) : "";
  };
  const waitLabel = () => (stateLabel() ? `. ${stateLabel()}` : "");
  const draggable = () => !rowProps.channel.archived && chatsDraggable() && !props.compact && !rowProps.waiting;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const title = () => rowProps.channel.title.trim();
  // A row from a saved frame has no last message yet: it shows no preview and no time until the list loads.
  const previewPending = () => props.channelPreviewsPending === true && !rowProps.channel.lastMessage;
  /* Running work is a prefix on the preview line rather than a word beside the name: one line
   * carries both and the row keeps the height every other row in the list has. */
  const time = () =>
    previewPending() ? "" : sidebarMessageTime(rowProps.channel.lastMessage?.at ?? rowProps.channel.createdAt, format);
  const preview = () => {
    // A waiting row previews the question, as on the agent row.
    const text =
      wait()?.detail ||
      (rowProps.channel.lastMessage?.text ?? (previewPending() ? "" : t("sidebar.channel.noMessages")));
    return rowProps.channel.activeTasks > 0 ? t("sidebar.channel.workingPreview", { preview: text }) : text;
  };
  // The wait label already reads the question, so the label does not say it twice, unless the
  // preview also says that work runs.
  const labelPreview = () => (wait()?.detail && rowProps.channel.activeTasks === 0 ? "" : `. ${preview()}`);
  const row = (): JSX.Element => (
    <ContextMenu.Root modal={false} onOpenChange={setMenuOpen}>
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
        aria-label={`${rowProps.channel.name}${title() ? `, ${title()}` : ""}${labelPreview()}${waitLabel()}`}
        aria-pressed={active() ? "true" : "false"}
        data-cuelume-navigate=""
        onClick={(event: MouseEvent) => {
          if (!sidebarClickIsSuppressed(event)) props.onSelectChannel?.(rowProps.channel.id);
        }}
      >
        <span class="agent-row-avatar">
          <ChannelAvatar
            members={rowProps.channel.members}
            agents={props.agents}
            layout="cluster"
            icon={rowProps.channel.icon}
            imageUrl={rowProps.channel.imageUrl}
          />
          <SidebarAgentIndicator state={badgeState} />
        </span>
        <span class="agent-row-copy">
          <span class="agent-row-heading">
            <span class="agent-row-title">
              <strong dir="auto">{rowProps.channel.name}</strong>
              <Show when={title()}>
                {(label) => (
                  <Badge class="agent-role-badge" title={label()}>
                    <span dir="auto">{label()}</span>
                  </Badge>
                )}
              </Show>
            </span>
            <Show when={wait()} fallback={<span class="agent-row-time">{time()}</span>}>
              {(current) => <SidebarWaitChip reason={current().reason} />}
            </Show>
          </span>
          <span class="agent-row-preview" dir="auto">
            {preview()}
          </span>
        </span>
        <Show when={rowProps.channel.unreadCount > 0}>
          <span class="sr-only">{t("sidebar.channel.unread", { count: rowProps.channel.unreadCount })}</span>
        </Show>
      </ContextMenu.Trigger>
      <Show
        when={!rowProps.channel.archived}
        fallback={
          <Show when={props.onRestoreChannel}>
            <SidebarDeletedChannelContextMenu channel={rowProps.channel} />
          </Show>
        }
      >
        <SidebarChannelContextMenu channel={rowProps.channel} pinned={false} />
      </Show>
    </ContextMenu.Root>
  );
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
      data-chat-id={rowProps.waiting ? undefined : rowProps.channel.id}
      draggable={draggable() ? "true" : "false"}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => startChatDragging(event, rowProps.channel.id)}
      onDragEnd={endChatDragging}
    >
      <Show
        when={wait()}
        fallback={
          <SidebarNameTooltip
            name={rowProps.channel.name}
            title={title()}
            preview={preview()}
            detail={stateLabel()}
            menuOpen={menuOpen()}
          >
            {row()}
          </SidebarNameTooltip>
        }
      >
        {(current) => (
          <SidebarWaitTooltip
            wait={current()}
            menuOpen={menuOpen()}
            name={props.compact ? rowProps.channel.name : undefined}
          >
            {row()}
          </SidebarWaitTooltip>
        )}
      </Show>
    </div>
  );
}
