import type { HostedServerSleep, ServerConnectionState, ServerSummary } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  BellOff,
  buttonVariants,
  ContextMenu,
  DropdownMenu,
  Eye,
  Plus,
  ServerGradientLogo,
  Tooltip,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createVerticalDragPreview } from "../../components/createVerticalDragPreview";
import { useText } from "../../text";
import { type ServerActionCallbacks, ServerActionItems, serverMuteDescription } from "./ServerActionItems";

const SERVER_RAIL_TOOLTIP_OPEN_DELAY = 150;

const SERVER_STATE_LABELS = {
  online: "server.state.online",
  connecting: "server.state.connecting",
  offline: "server.state.offline",
  error: "server.state.error",
  incompatible: "server.state.incompatible",
} as const satisfies Record<ServerConnectionState, AppTextKey>;

const HOSTED_SLEEP_LABELS = {
  sleeping: "server.state.sleeping",
  waking: "server.state.waking",
} as const satisfies Record<HostedServerSleep, AppTextKey>;

/** Whether a hosted server that is not connected sleeps or wakes. It replaces the connection state word. */
export function serverHostedSleep(server: Pick<ServerSummary, "hostedSleep" | "state">): HostedServerSleep | null {
  return server.state === "online" ? null : (server.hostedSleep ?? null);
}

/** The muted and connection state words that a server's accessible name adds after its name. */
export function serverStatusLabels(
  server: Pick<ServerSummary, "hostedSleep" | "notificationsMuted" | "state">,
  t: AppTranslate,
): string[] {
  const sleep = serverHostedSleep(server);
  return [
    ...(server.notificationsMuted ? [t("server.rail.notificationsMuted")] : []),
    ...(sleep ? [t(HOSTED_SLEEP_LABELS[sleep])] : []),
    ...(sleep || server.state === "online" ? [] : [t(SERVER_STATE_LABELS[server.state])]),
  ];
}

/**
 * The add item. It names the hosted server plans only when it is the one way to add a server: beside
 * a server on this computer, both the plans and an invite give a remote server.
 */
export function addServerLabel(props: {
  addCreatesServer?: boolean | undefined;
  onCreateLocal?: (() => void) | undefined;
}): AppTextKey {
  return props.addCreatesServer && !props.onCreateLocal ? "server.rail.add" : "server.rail.addRemote";
}

/** A small dot on a server's logo while its hosted server sleeps or wakes. */
export function ServerSleepDot(props: { server: Pick<ServerSummary, "hostedSleep" | "state">; class: string }) {
  return (
    <Show when={serverHostedSleep(props.server)}>
      {(sleep) => <span class={props.class} data-state={sleep()} aria-hidden="true" />}
    </Show>
  );
}

/** The server on this computer while the user hides it from the server list, and the action that shows it again. */
export interface HiddenLocalServer {
  name: string;
  show: () => void;
}

interface ServerRailProps extends ServerActionCallbacks {
  servers: ServerSummary[];
  onSelect: (serverId: string) => void;
  onReorder: (serverIds: string[]) => void;
  onAdd: () => void;
  /** True when the plus button opens the hosted server plans, where the user can also join with an invite. */
  addCreatesServer?: boolean | undefined;
  /** Opens the dialog that creates a server on this computer. With it, the plus button opens a menu. */
  onCreateLocal?: (() => void) | undefined;
  /** The server on this computer while the user hides it. With it, the plus button opens a menu. */
  hiddenLocal?: HiddenLocalServer | undefined;
}

interface DragSlot {
  id: string;
  centerY: number;
}

export function ServerRail(props: ServerRailProps) {
  const { t } = useText();
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
    setAnnouncement(t("server.rail.moved", { position: targetIndex + 1, total: ids.length }));
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
    setAnnouncement(t("server.rail.moved", { position: targetIndex + 1, total: ids.length }));
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
      aria-label={t("server.rail.label")}
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
              onLeave={props.onLeave}
              onDelete={props.onDelete}
              canDelete={props.canDelete}
              onRestart={props.onRestart}
              canRestart={props.canRestart}
              onRemove={props.onRemove}
              canRemove={props.canRemove}
              onHide={props.onHide}
              canHide={props.canHide}
              onSetMuted={props.onSetMuted}
              onOpenNotificationSettings={props.onOpenNotificationSettings}
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
                    onLeave={props.onLeave}
                    onDelete={props.onDelete}
                    canDelete={props.canDelete}
                    onRestart={props.onRestart}
                    canRestart={props.canRestart}
                    onRemove={props.onRemove}
                    canRemove={props.canRemove}
                    onHide={props.onHide}
                    canHide={props.canHide}
                    onSetMuted={props.onSetMuted}
                    onOpenNotificationSettings={props.onOpenNotificationSettings}
                    onMove={(direction) => moveServer(server().id, direction)}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show
          when={props.onCreateLocal || props.hiddenLocal}
          fallback={
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
                aria-label={t(addServerLabel(props))}
                data-cuelume-open=""
                data-cuelume-emphasis="subtle"
                onClick={props.onAdd}
              >
                <span class="server-rail-monogram">+</span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="server-rail-tooltip">{t(addServerLabel(props))}</Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          }
        >
          <ServerRailAddMenu
            addLabel={addServerLabel(props)}
            onAdd={props.onAdd}
            onCreateLocal={props.onCreateLocal}
            hiddenLocal={props.hiddenLocal}
          />
        </Show>
        <span class="sr-only" aria-live="polite">
          {announcement()}
        </span>
      </div>
    </aside>
  );
}

/**
 * The plus button when a server can also run on this computer, or when the user hides the server on this
 * computer: a menu with the ways to add a server, and the item that shows the hidden server again.
 */
function ServerRailAddMenu(props: {
  addLabel: AppTextKey;
  onAdd: () => void;
  onCreateLocal?: (() => void) | undefined;
  hiddenLocal?: HiddenLocalServer | undefined;
}) {
  const { t } = useText();
  const [tooltipOpen, setTooltipOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  return (
    <Tooltip.Root
      open={tooltipOpen() && !menuOpen()}
      onOpenChange={setTooltipOpen}
      placement="right"
      gutter={10}
      openDelay={SERVER_RAIL_TOOLTIP_OPEN_DELAY}
      closeDelay={0}
      skipDelayDuration={300}
    >
      <Tooltip.Trigger as="div" class="server-rail-tooltip-trigger">
        <DropdownMenu.Root placement="right-start" gutter={10} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger
            class={`${buttonVariants({ variant: "outline", size: "sm" })} server-rail-button server-rail-action`}
            aria-label={t("server.rail.add")}
            data-cuelume-open=""
            data-cuelume-emphasis="subtle"
          >
            <span class="server-rail-monogram">+</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content aria-label={t("server.rail.add")}>
              <DropdownMenu.Item class="server-menu-add" onSelectAfterClose={props.onAdd}>
                <span class="server-menu-add-circle" aria-hidden="true">
                  <Plus />
                </span>
                <span>{t(props.addLabel)}</span>
              </DropdownMenu.Item>
              <Show when={props.onCreateLocal}>
                {(onCreateLocal) => (
                  <DropdownMenu.Item class="server-menu-add" onSelectAfterClose={onCreateLocal()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Plus />
                    </span>
                    <span>{t("server.local.createTitle")}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={props.hiddenLocal}>
                {(hiddenLocal) => (
                  <DropdownMenu.Item class="server-menu-add" onSelectAfterClose={hiddenLocal().show}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Eye />
                    </span>
                    <span>{t("server.rail.showLocal", { name: hiddenLocal().name })}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="server-rail-tooltip">{t("server.rail.add")}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ServerRailButton(
  props: ServerActionCallbacks & {
    server: ServerSummary;
    onSelect: (serverId: string) => void;
    onMove?: (direction: -1 | 1) => void;
  },
) {
  const { t, format } = useText();
  const [overlay, setOverlay] = createStore({ tooltipOpen: false, menuOpen: false });
  let trigger: HTMLElement | null = null;
  const buttonLabel = () =>
    [t("server.rail.buttonLabel", { name: props.server.name }), ...serverStatusLabels(props.server, t)].join(", ");
  const muteDescription = () => serverMuteDescription(props.server, t, format);
  const sleepLabel = () => {
    const sleep = serverHostedSleep(props.server);
    return sleep ? t(HOSTED_SLEEP_LABELS[sleep]) : null;
  };
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
            aria-label={buttonLabel()}
            aria-pressed={props.server.active ? "true" : "false"}
            aria-keyshortcuts={props.onMove ? "Shift+F10 Alt+ArrowUp Alt+ArrowDown" : "Shift+F10"}
            data-cuelume-navigate=""
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
            <ContextMenu.Content class="agent-context-menu" aria-label={t("server.rail.actions")}>
              <ServerActionItems
                menu={ContextMenu}
                server={props.server}
                trigger={() => trigger}
                onSetMuted={props.onSetMuted}
                onOpenNotificationSettings={props.onOpenNotificationSettings}
                onOpenSettings={props.onOpenSettings}
                onLeave={props.onLeave}
                onDelete={props.onDelete}
                canDelete={props.canDelete}
                onRestart={props.onRestart}
                canRestart={props.canRestart}
                onRemove={props.onRemove}
                canRemove={props.canRemove}
                onHide={props.onHide}
                canHide={props.canHide}
              />
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="server-rail-tooltip">
          {props.server.name}
          {props.server.thisComputer ? ` · ${t("server.rail.thisComputer")}` : ""}
          {sleepLabel() ? ` · ${sleepLabel()}` : ""}
          {props.server.notificationsMuted ? ` · ${muteDescription()}` : ""}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ServerMark(props: { server: Pick<ServerSummary, "id" | "logoUrl"> }) {
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
