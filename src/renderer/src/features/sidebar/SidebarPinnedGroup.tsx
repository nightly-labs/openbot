/**
 * The pinned strip above the sections. It stays mounted while `emptyPinnedDropVisible()` is on
 * even with nothing pinned, because that empty row is the drop target that lets a first chat be
 * pinned at all.
 *
 * A tile holds an agent or a channel: both are chats the user pins, so the tile, its drag source
 * and its keyboard reorder are shared, and only the avatar, the name row and the menu ask which
 * kind they have.
 */

import { For, Match, Show, Switch } from "solid-js";
import { Badge, buttonVariants, ContextMenu } from "../../components/ui";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarPinnedAvatar } from "./SidebarAgentIndicator";
import { SidebarChannelContextMenu } from "./SidebarChannelContextMenu";
import { sidebarAgentStateLabel } from "./sidebar-filtering";
import { sidebarPinnedItemKey } from "./sidebar-pins";
import { useSidebarScope } from "./sidebar-scope";
import type { SidebarChatItem } from "./sidebar-types";

export function SidebarPinnedGroup() {
  const {
    emptyPinnedDropVisible,
    dragOffset,
    dragOverPinnedKey,
    draggedPinnedKey,
    movePinnedItem,
    pinnedDropActive,
    props,
    resolvedPinnedItems,
    startNativeItemDragging,
    stopSidebarDragging,
  } = useSidebarScope();
  const chatName = (chat: SidebarChatItem) => (chat.kind === "agent" ? chat.agent.name : chat.channel.name);
  const chatIsActive = (chat: SidebarChatItem) =>
    chat.kind === "agent" ? props.activeAgentId === chat.id : props.activeChannelId === chat.id;
  const selectChat = (chat: SidebarChatItem) => {
    if (chat.kind === "agent") props.onSelectAgent(chat.id);
    else props.onSelectChannel?.(chat.id);
  };
  return (
    <Show when={resolvedPinnedItems().length > 0 || emptyPinnedDropVisible()}>
      <section
        class={[
          "sidebar-chat-group sidebar-pinned-group",
          {
            "sidebar-pinned-group-agent-drop-target": pinnedDropActive(),
            "sidebar-pinned-group-empty-target": emptyPinnedDropVisible(),
          },
        ]}
        aria-label="Pinned chats"
      >
        <ul class="sidebar-pinned-list" data-dragging={draggedPinnedKey() ? "" : undefined}>
          <Show when={emptyPinnedDropVisible()}>
            <li class="sidebar-pinned-empty-drop">Drag here to pin</li>
          </Show>
          <For each={resolvedPinnedItems()}>
            {(item) => {
              const key = () => sidebarPinnedItemKey(item.ref);
              const name = () => chatName(item.chat);
              const active = () => chatIsActive(item.chat);
              return (
                <li
                  class={[
                    "sidebar-pinned-item",
                    {
                      "sidebar-pinned-item-dragging": draggedPinnedKey() === key(),
                      "sidebar-pinned-item-drag-over": dragOverPinnedKey() === key(),
                    },
                  ]}
                  style={`--sidebar-drag-x: ${dragOffset(key()).x}px; --sidebar-drag-y: ${dragOffset(key()).y}px;`}
                  data-pinned-key={key()}
                  draggable="true"
                  onDragStart={(event) => {
                    startNativeItemDragging(event, {
                      className: "sidebar-pinned-drag-preview",
                      data: key(),
                      source: { kind: "pinned", id: item.chat.id, key: key(), origin: "pinned" },
                    });
                  }}
                  onDragEnd={stopSidebarDragging}
                  onKeyDown={(event) => {
                    if (!event.altKey) return;
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      movePinnedItem(key(), -1);
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      movePinnedItem(key(), 1);
                    }
                  }}
                >
                  <ContextMenu.Root modal={false}>
                    <ContextMenu.Trigger
                      as="button"
                      type="button"
                      class={[
                        buttonVariants({ variant: "ghost" }),
                        "agent-row sidebar-pinned-row",
                        { "agent-row-active": active() },
                      ]}
                      aria-label={`${name()}, pinned ${item.chat.kind}`}
                      aria-pressed={active() ? "true" : "false"}
                      onClick={() => selectChat(item.chat)}
                    >
                      <Switch>
                        <Match when={item.chat.kind === "agent" ? item.chat.agent : undefined}>
                          {(agent) => (
                            <>
                              <SidebarPinnedAvatar agent={agent()} agentState={() => props.agentStates[agent().id]} />
                              <span class="agent-row-copy sidebar-pinned-copy">
                                <strong class="sidebar-pinned-name" title={name()}>
                                  {name()}
                                </strong>
                                <Show when={agent().title.trim()}>
                                  {(label) => (
                                    <Badge class="sidebar-pinned-title" size="sm" title={label()}>
                                      <span>{label()}</span>
                                    </Badge>
                                  )}
                                </Show>
                              </span>
                              <Show when={props.agentStates[agent().id]}>
                                {(state) => <span class="sr-only">{sidebarAgentStateLabel(state())}</span>}
                              </Show>
                            </>
                          )}
                        </Match>
                        <Match when={item.chat.kind === "channel" ? item.chat.channel : undefined}>
                          {(channel) => (
                            <>
                              <span class="agent-row-avatar sidebar-pinned-avatar">
                                <ChannelAvatar members={channel().members} agents={props.agents} layout="cluster" />
                              </span>
                              <span class="agent-row-copy sidebar-pinned-copy">
                                <strong class="sidebar-pinned-name" title={name()}>
                                  {name()}
                                </strong>
                              </span>
                              <Show when={channel().unreadCount > 0}>
                                <span class="sr-only">{channel().unreadCount} unread messages</span>
                              </Show>
                            </>
                          )}
                        </Match>
                      </Switch>
                    </ContextMenu.Trigger>
                    <Switch>
                      <Match when={item.chat.kind === "agent" ? item.chat.agent : undefined}>
                        {(agent) => <SidebarAgentContextMenu agent={agent()} pinned={true} />}
                      </Match>
                      <Match when={item.chat.kind === "channel" ? item.chat.channel : undefined}>
                        {(channel) => <SidebarChannelContextMenu channel={channel()} pinned={true} />}
                      </Match>
                    </Switch>
                  </ContextMenu.Root>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}
