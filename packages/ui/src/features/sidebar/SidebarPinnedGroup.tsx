/**
 * The pinned strip above the sections. It stays mounted while `emptyPinnedDropVisible()` is on
 * even with nothing pinned, because that empty row is the drop target that lets a first chat be
 * pinned at all.
 *
 * A tile holds an agent or a channel: both are chats the user pins, so the tile, its drag source
 * and its keyboard reorder are shared, and only the avatar, the name row and the menu ask which
 * kind they have.
 */

import { Badge, buttonVariants, ContextMenu } from "@openbot/ui";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
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
  const { t } = useText();
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
        aria-label={t("sidebar.pinned.label")}
      >
        <ul class="sidebar-pinned-list" data-dragging={draggedPinnedKey() ? "" : undefined}>
          <Show when={emptyPinnedDropVisible()}>
            <li class="sidebar-pinned-empty-drop">{t("sidebar.pinned.dropHint")}</li>
          </Show>
          <For each={resolvedPinnedItems()}>
            {(item) => {
              const key = () => sidebarPinnedItemKey(item.ref);
              const name = () => chatName(item.chat);
              const active = () => chatIsActive(item.chat);
              const routineLabel = () => {
                if (item.chat.kind !== "agent") return "";
                const state = props.agentStates[item.chat.id];
                return state?.kind === "routine" ? sidebarAgentStateLabel(state, t) : "";
              };
              const rowLabel = () => {
                if (item.chat.kind === "channel") return t("sidebar.pinned.channel", { name: name() });
                return routineLabel()
                  ? t("sidebar.pinned.agentWithState", { name: name(), state: routineLabel() })
                  : t("sidebar.pinned.agent", { name: name() });
              };
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
                      aria-label={rowLabel()}
                      title={routineLabel() || undefined}
                      aria-pressed={active() ? "true" : "false"}
                      onClick={() => selectChat(item.chat)}
                    >
                      <Switch>
                        <Match when={item.chat.kind === "agent" ? item.chat.agent : undefined}>
                          {(agent) => (
                            <>
                              <SidebarPinnedAvatar
                                agent={agent()}
                                mood={props.agentMoods[agent().id] ?? "idle"}
                                agentState={() => props.agentStates[agent().id]}
                              />
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
                                {(state) => <span class="sr-only">{sidebarAgentStateLabel(state(), t)}</span>}
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
                                <Show when={channel().title.trim()}>
                                  {(label) => (
                                    <Badge class="sidebar-pinned-title" size="sm" title={label()}>
                                      <span>{label()}</span>
                                    </Badge>
                                  )}
                                </Show>
                              </span>
                              <Show when={channel().unreadCount > 0}>
                                <span class="sr-only">
                                  {t("sidebar.channel.unread", { count: channel().unreadCount })}
                                </span>
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
