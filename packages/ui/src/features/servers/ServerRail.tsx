import type { ServerNotificationLevel, ServerSummary } from "@openbot/contracts/ipc";
import {
  Bell,
  BellOff,
  buttonVariants,
  ChartArea,
  Check,
  ChevronRight,
  ContextMenu,
  ServerGradientLogo,
  Tooltip,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createVerticalDragPreview } from "../../components/createVerticalDragPreview";

const SERVER_RAIL_TOOLTIP_OPEN_DELAY = 150;

// The same choices as Discord's server menu. No duration mutes until the user unmutes.
const MUTE_CHOICES: readonly { label: string; durationMs?: number }[] = [
  { label: "For 15 minutes", durationMs: 15 * 60_000 },
  { label: "For 1 hour", durationMs: 60 * 60_000 },
  { label: "For 3 hours", durationMs: 3 * 60 * 60_000 },
  { label: "For 8 hours", durationMs: 8 * 60 * 60_000 },
  { label: "For 24 hours", durationMs: 24 * 60 * 60_000 },
  { label: "Until I turn it back on" },
];

export const SERVER_NOTIFICATION_LEVEL_LABELS: Record<ServerNotificationLevel, string> = {
  all: "All activity",
  "needs-me": "Only when it needs me",
  nothing: "Nothing",
};

const NOTIFICATION_LEVELS: readonly ServerNotificationLevel[] = ["all", "needs-me", "nothing"];

/** "Muted until 14:30", with the weekday when the mute ends on another day. */
export function serverMuteDescription(
  server: Pick<ServerSummary, "notificationsMutedUntil">,
  now = new Date(),
): string {
  if (server.notificationsMutedUntil === null) return "Muted";
  const until = new Date(server.notificationsMutedUntil);
  const sameDay = until.toDateString() === now.toDateString();
  const time = until.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { weekday: "short" }),
  });
  return `Muted until ${time}`;
}

interface ServerRailProps {
  servers: ServerSummary[];
  onSelect: (serverId: string) => void;
  onSetMuted?: (serverId: string, muted: boolean, durationMs?: number) => void;
  onSetNotificationLevel?: (serverId: string, level: ServerNotificationLevel) => void;
  onReorder: (serverIds: string[]) => void;
  onAdd: () => void;
  onOpenUsage?: (serverId: string, trigger: HTMLElement | null) => void;
  onOpenSettings?: (serverId: string, trigger: HTMLElement | null) => void;
}

interface DragSlot {
  id: string;
  centerY: number;
}

export function ServerRail(props: ServerRailProps) {
  const [draggedId, setDraggedId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  const [announcement, setAnnouncement] = createSignal("");
  const scrollFades = createScrollFades();
  let railList: HTMLDivElement | undefined;
  let remoteList: HTMLUListElement | undefined;
  let dragSlots: DragSlot[] = [];
  let dragStartScrollTop = 0;
  let lastDragClientY = 0;
  let autoScrollVelocity = 0;
  let autoScrollFrame: number | null = null;
  const dragPreview = createVerticalDragPreview();
  const localServers = () => props.servers.filter((server) => server.kind === "local");
  const remoteServers = () => props.servers.filter((server) => server.kind === "remote");

  onCleanup(() => {
    stopAutoScroll();
    dragPreview.stop();
    scrollFades.stop();
  });

  createEffect(
    () => props.servers.length,
    () => {
      scrollFades.remeasure();
    },
  );

  function remoteServerIds(): string[] {
    return remoteServers().map((server) => server.id);
  }

  function dragStep(serverId: string): number {
    const sourceId = draggedId();
    const targetId = dragOverId();
    if (!sourceId || !targetId || sourceId === targetId) return 0;

    const ids = remoteServerIds();
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    const serverIndex = ids.indexOf(serverId);
    if (sourceIndex < 0 || targetIndex < 0 || serverIndex < 0 || serverId === sourceId) return 0;
    if (sourceIndex < targetIndex && serverIndex > sourceIndex && serverIndex <= targetIndex) return -1;
    if (sourceIndex > targetIndex && serverIndex >= targetIndex && serverIndex < sourceIndex) return 1;
    return 0;
  }

  function measureDragSlots(): void {
    if (!railList || !remoteList) return;
    dragStartScrollTop = railList.scrollTop;
    dragSlots = [];
    for (const item of remoteList.querySelectorAll<HTMLElement>(".server-rail-server-item")) {
      const id = item.dataset.serverId;
      if (!id) continue;
      const bounds = item.getBoundingClientRect();
      dragSlots.push({ id, centerY: bounds.top + bounds.height / 2 });
    }
  }

  function updateDragTarget(clientY: number): string | null {
    const first = dragSlots[0];
    if (!first) return null;
    const scrollDelta = (railList?.scrollTop ?? 0) - dragStartScrollTop;
    let closest = first;
    let closestDistance = Math.abs(clientY - (first.centerY - scrollDelta));
    for (const slot of dragSlots.slice(1)) {
      const distance = Math.abs(clientY - (slot.centerY - scrollDelta));
      if (distance >= closestDistance) continue;
      closest = slot;
      closestDistance = distance;
    }
    if (dragOverId() !== closest.id) setDragOverId(closest.id);
    return closest.id;
  }

  function scrollRailOnce(): boolean {
    if (!railList) return false;
    const previousScrollTop = railList.scrollTop;
    railList.scrollTop += autoScrollVelocity;
    if (railList.scrollTop !== previousScrollTop) {
      updateDragTarget(lastDragClientY);
      scrollFades.measure();
    }
    return railList.scrollTop !== previousScrollTop;
  }

  function runAutoScroll(): void {
    autoScrollFrame = null;
    if (!railList || !draggedId() || autoScrollVelocity === 0) return;
    if (!scrollRailOnce()) {
      autoScrollVelocity = 0;
      return;
    }
    autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
  }

  function updateAutoScroll(clientY: number): void {
    if (!railList) return;
    lastDragClientY = clientY;
    const bounds = railList.getBoundingClientRect();
    const edgeSize = Math.min(36, bounds.height / 3);
    const topDistance = clientY - bounds.top;
    const bottomDistance = bounds.bottom - clientY;
    const maxSpeed = 8;

    if (topDistance < edgeSize) {
      autoScrollVelocity = -Math.min(maxSpeed, Math.max(2, Math.ceil((1 - topDistance / edgeSize) * maxSpeed)));
    } else if (bottomDistance < edgeSize) {
      autoScrollVelocity = Math.min(maxSpeed, Math.max(2, Math.ceil((1 - bottomDistance / edgeSize) * maxSpeed)));
    } else {
      autoScrollVelocity = 0;
    }

    if (autoScrollVelocity !== 0 && autoScrollFrame === null && scrollRailOnce()) {
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    }
    if (autoScrollVelocity === 0 && autoScrollFrame !== null) {
      window.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
  }

  function stopAutoScroll(): void {
    autoScrollVelocity = 0;
    if (autoScrollFrame === null) return;
    window.cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }

  function moveServer(serverId: string, direction: -1 | 1): void {
    const ids = remoteServerIds();
    const index = ids.indexOf(serverId);
    const targetIndex = index + direction;
    const moved = ids[index];
    const displaced = ids[targetIndex];
    if (index < 0 || moved === undefined || displaced === undefined) return;
    ids[index] = displaced;
    ids[targetIndex] = moved;
    props.onReorder(ids);
    setAnnouncement(`Moved server to position ${targetIndex + 1} of ${ids.length}.`);
  }

  function dropServer(targetId: string): void {
    const sourceId = draggedId();
    if (!sourceId || sourceId === targetId) return;
    const ids = remoteServerIds();
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    props.onReorder(ids);
    setAnnouncement(`Moved server to position ${targetIndex + 1} of ${ids.length}.`);
  }

  function stopDragging(): void {
    setDraggedId(null);
    setDragOverId(null);
    stopAutoScroll();
    dragPreview.stop();
  }

  return (
    <aside
      class="server-rail"
      aria-label="Servers"
      onDragOver={(event) => {
        if (!draggedId()) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        dragPreview.move(event.clientY);
        updateDragTarget(event.clientY);
        updateAutoScroll(event.clientY);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const targetId = updateDragTarget(event.clientY) ?? dragOverId();
        if (targetId) dropServer(targetId);
        stopDragging();
      }}
    >
      <div
        class={["server-rail-list", scrollFades.classes()]}
        ref={(element) => {
          railList = element;
          scrollFades.bind(element);
        }}
        onScroll={scrollFades.measure}
      >
        <For each={localServers()} keyed={(server) => server.id}>
          {(server) => (
            <ServerRailButton
              server={server()}
              onSelect={props.onSelect}
              onOpenSettings={props.onOpenSettings}
              onSetMuted={props.onSetMuted}
              onSetNotificationLevel={props.onSetNotificationLevel}
              onOpenUsage={props.onOpenUsage}
            />
          )}
        </For>
        <Show when={remoteServers().length > 0}>
          <ul
            ref={(element) => (remoteList = element)}
            class="server-rail-remote-list"
            data-dragging={draggedId() ? "" : undefined}
          >
            <For each={remoteServers()} keyed={(server) => server.id}>
              {(server) => (
                <li
                  class={[
                    "server-rail-server-item",
                    {
                      "server-rail-server-item-dragging": draggedId() === server().id,
                      "server-rail-server-item-drag-over": dragOverId() === server().id,
                    },
                  ]}
                  style={{ "--server-rail-drag-step": dragStep(server().id) }}
                  data-server-id={server().id}
                  draggable="true"
                  onDragStart={(event) => {
                    event.dataTransfer?.setData("text/plain", server().id);
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                    measureDragSlots();
                    if (railList) {
                      dragPreview.start({
                        bounds: railList,
                        className: "server-rail-drag-preview",
                        event,
                        source: event.currentTarget,
                      });
                    }
                    setDraggedId(server().id);
                    setDragOverId(server().id);
                  }}
                  onDragEnd={stopDragging}
                >
                  <ServerRailButton
                    server={server()}
                    onSelect={props.onSelect}
                    onOpenSettings={props.onOpenSettings}
                    onSetMuted={props.onSetMuted}
                    onSetNotificationLevel={props.onSetNotificationLevel}
                    onOpenUsage={props.onOpenUsage}
                    onMove={(direction) => moveServer(server().id, direction)}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Tooltip.Root
          placement="right"
          gutter={10}
          openDelay={SERVER_RAIL_TOOLTIP_OPEN_DELAY}
          closeDelay={0}
          skipDelayDuration={300}
        >
          <Tooltip.Trigger
            type="button"
            class={`${buttonVariants({ variant: "outline", size: "sm" })} server-rail-button server-rail-action`}
            aria-label="Add remote server"
            onClick={props.onAdd}
          >
            <span class="server-rail-monogram">+</span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="server-rail-tooltip">Add remote server</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span class="sr-only" aria-live="polite">
          {announcement()}
        </span>
      </div>
    </aside>
  );
}

function ServerRailButton(props: {
  server: ServerSummary;
  onSelect: (serverId: string) => void;
  onSetMuted?: (serverId: string, muted: boolean, durationMs?: number) => void;
  onSetNotificationLevel?: (serverId: string, level: ServerNotificationLevel) => void;
  onOpenUsage?: (serverId: string, trigger: HTMLElement | null) => void;
  onOpenSettings?: (serverId: string, trigger: HTMLElement | null) => void;
  onMove?: (direction: -1 | 1) => void;
}) {
  const [overlay, setOverlay] = createStore({ tooltipOpen: false, menuOpen: false });
  let trigger: HTMLElement | null = null;
  return (
    <Tooltip.Root
      open={overlay.tooltipOpen && !overlay.menuOpen}
      onOpenChange={(open) =>
        setOverlay((state) => {
          state.tooltipOpen = open;
        })
      }
      placement="right"
      gutter={10}
      openDelay={SERVER_RAIL_TOOLTIP_OPEN_DELAY}
      closeDelay={0}
      skipDelayDuration={300}
    >
      <Tooltip.Trigger as="div" class="server-rail-tooltip-trigger">
        <ContextMenu.Root
          modal={false}
          onOpenChange={(open) =>
            setOverlay((state) => {
              state.menuOpen = open;
            })
          }
        >
          <ContextMenu.Trigger
            as="button"
            type="button"
            class={buttonVariants({ variant: "ghost", class: "server-rail-button" })}
            aria-label={`${props.server.name} server${props.server.notificationsMuted ? ", notifications muted" : ""}${props.server.state === "online" ? "" : `, ${props.server.state}`}`}
            aria-pressed={props.server.active ? "true" : "false"}
            aria-keyshortcuts={props.onMove ? "Shift+F10 Alt+ArrowUp Alt+ArrowDown" : "Shift+F10"}
            onClick={() => props.onSelect(props.server.id)}
            onContextMenu={(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
              trigger = event.currentTarget;
            }}
            onFocus={(event) => {
              trigger = event.currentTarget;
              setOverlay((state) => {
                state.tooltipOpen = true;
              });
            }}
            onBlur={() =>
              setOverlay((state) => {
                state.tooltipOpen = false;
              })
            }
            onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLButtonElement }) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                event.currentTarget.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    cancelable: true,
                    clientX: bounds.right,
                    clientY: bounds.top,
                  }),
                );
                return;
              }
              if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              props.onMove?.(event.key === "ArrowUp" ? -1 : 1);
            }}
          >
            <span class="server-rail-mark" aria-hidden="true" />
            <ServerMark server={props.server} />
            <Show when={props.server.notificationsMuted}>
              <BellOff class="server-rail-muted size-3" aria-hidden="true" />
            </Show>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="agent-context-menu" aria-label="Server actions">
              <Show when={props.onSetMuted}>
                <Show
                  when={!props.server.notificationsMuted}
                  fallback={
                    <ContextMenu.Item
                      class="server-rail-menu-detail-item"
                      onSelect={() => props.onSetMuted?.(props.server.id, false)}
                    >
                      <Bell class="agent-context-icon size-4" aria-hidden="true" />
                      <span class="server-rail-menu-label">
                        <span>Unmute server</span>
                        <span class="server-rail-menu-detail">{serverMuteDescription(props.server)}</span>
                      </span>
                    </ContextMenu.Item>
                  }
                >
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger>
                      <BellOff class="agent-context-icon size-4" aria-hidden="true" />
                      <span>Mute server</span>
                      <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent class="ui-action-menu agent-context-menu">
                        <For each={MUTE_CHOICES}>
                          {(choice) => (
                            <ContextMenu.Item
                              onSelect={() => props.onSetMuted?.(props.server.id, true, choice.durationMs)}
                            >
                              <span>{choice.label}</span>
                            </ContextMenu.Item>
                          )}
                        </For>
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                </Show>
              </Show>
              <Show when={props.onSetNotificationLevel}>
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger class="server-rail-menu-detail-item">
                    <Bell class="agent-context-icon size-4" aria-hidden="true" />
                    <span class="server-rail-menu-label">
                      <span>Notification settings</span>
                      <span class="server-rail-menu-detail">
                        {SERVER_NOTIFICATION_LEVEL_LABELS[props.server.notificationLevel]}
                      </span>
                    </span>
                    <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent class="ui-action-menu agent-context-menu">
                      <ContextMenu.RadioGroup
                        value={props.server.notificationLevel}
                        onChange={(value) => {
                          const level = NOTIFICATION_LEVELS.find((candidate) => candidate === value);
                          if (level) props.onSetNotificationLevel?.(props.server.id, level);
                        }}
                      >
                        <For each={NOTIFICATION_LEVELS}>
                          {(level) => (
                            <ContextMenu.RadioItem value={level}>
                              <span>{SERVER_NOTIFICATION_LEVEL_LABELS[level]}</span>
                              <Show when={props.server.notificationLevel === level}>
                                <Check class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                              </Show>
                            </ContextMenu.RadioItem>
                          )}
                        </For>
                      </ContextMenu.RadioGroup>
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
              </Show>
              <Show when={props.onSetMuted || props.onSetNotificationLevel}>
                <ContextMenu.Separator />
              </Show>
              <Show when={props.onOpenUsage}>
                <ContextMenu.Item onSelect={() => props.onOpenUsage?.(props.server.id, trigger)}>
                  <ChartArea class="agent-context-icon size-4" aria-hidden="true" />
                  <span>Usage</span>
                </ContextMenu.Item>
              </Show>
              <Show when={props.onOpenSettings}>
                <ContextMenu.Item onSelect={() => props.onOpenSettings?.(props.server.id, trigger)}>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    class="agent-context-icon ui-glyph-20"
                    fill="none"
                    stroke="currentColor"
                  >
                    <rect x="3" y="3" width="14" height="5" rx="1.5" />
                    <rect x="3" y="12" width="14" height="5" rx="1.5" />
                    <circle cx="6" cy="5.5" r=".8" />
                    <circle cx="6" cy="14.5" r=".8" />
                  </svg>
                  <span>Server settings</span>
                </ContextMenu.Item>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="server-rail-tooltip">
          {props.server.name}
          {props.server.notificationsMuted ? ` · ${serverMuteDescription(props.server)}` : ""}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ServerMark(props: { server: ServerSummary }) {
  const [failed, setFailed] = createSignal(false);
  createEffect(
    () => props.server.logoUrl,
    () => {
      setFailed(false);
    },
  );
  return (
    <Show when={!failed() ? props.server.logoUrl : null} fallback={<ServerGradientLogo seed={props.server.id} />}>
      {(url) => <img class="server-rail-logo" src={url()} alt="" draggable={false} onError={() => setFailed(true)} />}
    </Show>
  );
}
