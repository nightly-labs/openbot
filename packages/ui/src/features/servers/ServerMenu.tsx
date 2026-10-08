import type { ServerSummary } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  AppWindow,
  BellOff,
  buttonVariants,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ContextMenu,
  DropdownMenu,
  Moon,
  PanelLeft,
  Plus,
  Puzzle,
} from "@openbot/ui";
import { SwapLabel } from "@openbot/ui/components/SwapLabel";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type ServerActionCallbacks, ServerActionItems } from "./ServerActionItems";
import { ServerMark, ServerSleepDot, serverHostedSleep, serverStatusLabels } from "./ServerRail";

/** Where the desktop app lists servers: the rail beside the sidebar, or the menu on the server name. */
export type ServerView = "rail" | "menu";

const SERVER_VIEWS: readonly ServerView[] = ["rail", "menu"];

const SERVER_VIEW_LABELS = {
  rail: "server.menu.layoutRail",
  menu: "server.menu.layoutMenu",
} as const satisfies Record<ServerView, AppTextKey>;

// The rail is a strip at the left edge. The menu opens from the server name, as a switcher does.
const SERVER_VIEW_ICONS = { rail: PanelLeft, menu: ChevronsUpDown } as const satisfies Record<
  ServerView,
  typeof PanelLeft
>;

export interface ServerMenuProps extends ServerActionCallbacks {
  servers: ServerSummary[];
  serverName: string;
  view: ServerView;
  onViewChange: (view: ServerView) => void;
  onSelect: (serverId: string) => void;
  onAdd?: () => void;
  /** True when `onAdd` opens the hosted server plans, where the user can also join with an invite. */
  addCreatesServer?: boolean | undefined;
  /** The menu view has no room for the marketplace button on the sidebar title, so the menu holds it. */
  onOpenMarketplace?: (() => void) | undefined;
  /** The compact sidebar hides the server name. The rail stays visible then. */
  compact?: boolean;
}

function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

function CheckCircle(props: { checked: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.checked ? "" : undefined} aria-hidden="true">
      <Show when={props.checked}>
        <Check />
      </Show>
    </span>
  );
}

// The app mounts a new sidebar title when the active server changes. The last shown server lets
// the new title animate from the old name and logo.
let lastShown: { id: string | undefined; name: string } | undefined;

/**
 * The server name on the sidebar title. Its menu sets the server view. In the menu view, it also
 * lists the servers, and the usage and settings of the active server. A click or Enter on a server
 * row selects that server. Hover or the arrow key on a row opens all actions of that server.
 */
export function ServerMenu(props: ServerMenuProps) {
  const { t } = useText();
  const [menuOpen, setMenuOpen] = createSignal(false);
  // The context menu of the server name opens from this hidden anchor.
  let anchor: HTMLElement | undefined;
  let trigger: HTMLElement | undefined;
  const activeServer = () => props.servers.find((server) => server.active);
  const activeServers = () => props.servers.filter((server) => server.active);
  const activeSleep = () => {
    const server = activeServer();
    return server ? serverHostedSleep(server) : null;
  };
  /** The name, or why the server does not answer while it sleeps or wakes. */
  const triggerTitle = () => {
    const sleep = activeSleep();
    if (sleep === "sleeping") return t("server.sleep.tooltipSleeping", { name: props.serverName });
    if (sleep === "waking") return t("server.sleep.tooltipWaking", { name: props.serverName });
    return props.serverName;
  };
  const shownBefore = lastShown;
  let markId = shownBefore?.id;
  createEffect(
    () => ({ id: activeServer()?.id, name: props.serverName }),
    (shown) => {
      lastShown = shown;
    },
  );

  function openActions(clientX: number, clientY: number): void {
    anchor?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
  }

  function selectServer(server: ServerSummary): void {
    setMenuOpen(false);
    if (!server.active) props.onSelect(server.id);
  }

  // A row is a submenu trigger, and Kobalte opens the submenu on Enter and Space. This listener
  // runs before the delegated handlers, so these keys select the server as a click does.
  function selectOnKey(row: HTMLElement, server: () => ServerSummary): void {
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      selectServer(server());
    });
  }

  return (
    <>
      <DropdownMenu.Root open={menuOpen()} onOpenChange={setMenuOpen} placement="bottom-start" gutter={6}>
        <DropdownMenu.Trigger
          ref={(element) => (trigger = element)}
          class={buttonVariants({
            variant: "ghost",
            size: "sm",
            class: "sidebar-server-name no-drag",
          })}
          aria-label={[
            t("server.menu.open", { name: props.serverName }),
            ...(activeSleep() === "sleeping" ? [t("server.state.sleeping")] : []),
            ...(activeSleep() === "waking" ? [t("server.state.waking")] : []),
          ].join(", ")}
          aria-hidden={props.compact ? "true" : undefined}
          aria-keyshortcuts="Shift+F10"
          tabindex={props.compact ? -1 : 0}
          title={triggerTitle()}
          onContextMenu={(event) => {
            event.preventDefault();
            openActions(event.clientX, event.clientY);
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKey(event)) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            openActions(bounds.left, bounds.bottom);
          }}
        >
          {/* Keyed by server, so the logo of a newly selected server springs in. */}
          <For each={activeServers()} keyed={(server) => server.id}>
            {(server) => {
              const id = untrack(() => server().id);
              const entering = markId !== undefined && markId !== id;
              markId = id;
              return (
                <span
                  class="server-menu-mark sidebar-server-name-mark"
                  data-entering={entering ? "" : undefined}
                  aria-hidden="true"
                >
                  <ServerMark server={server()} />
                </span>
              );
            }}
          </For>
          <SwapLabel class="sidebar-server-name-label" text={props.serverName} from={shownBefore?.name} />
          <Show when={activeSleep()}>
            {(sleep) => <Moon class="sidebar-server-name-sleep" data-state={sleep()} aria-hidden="true" />}
          </Show>
          <ChevronsUpDown class="sidebar-server-name-chevron" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="agent-context-menu server-menu" aria-label={t("server.menu.label")}>
            <Show
              when={props.view === "menu"}
              fallback={
                <Show when={props.onOpenSettings ? activeServer() : undefined}>
                  {(server) => (
                    <ServerActionItems
                      menu={DropdownMenu}
                      server={server()}
                      trigger={() => trigger ?? null}
                      onOpenSettings={props.onOpenSettings}
                      onLeave={props.onLeave}
                      onDelete={props.onDelete}
                      canDelete={props.canDelete}
                    />
                  )}
                </Show>
              }
            >
              {/* A heading only: each row names its server. A menu cannot hold a fieldset. */}
              <div class="ui-menu-label" aria-hidden="true">
                {t("server.rail.label")}
              </div>
              <For each={props.servers} keyed={(server) => server.id}>
                {(server) => (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger
                      class="server-menu-row"
                      aria-label={[server().name, ...serverStatusLabels(server(), t)].join(", ")}
                      aria-current={server().active ? "true" : undefined}
                      data-cuelume-navigate=""
                      onClick={() => selectServer(server())}
                      ref={(row) => selectOnKey(row, server)}
                    >
                      <CheckCircle checked={server().active} />
                      <span class="server-menu-mark" aria-hidden="true">
                        <ServerMark server={server()} />
                      </span>
                      <span class="server-menu-name">{server().name}</span>
                      <ServerSleepDot server={server()} class="server-menu-sleep" />
                      <Show when={server().notificationsMuted}>
                        <BellOff class="server-menu-muted size-3" aria-hidden="true" />
                      </Show>
                      <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        class="ui-action-menu agent-context-menu"
                        aria-label={t("server.rail.actions")}
                      >
                        <div class="ui-menu-label" aria-hidden="true">
                          {server().name}
                        </div>
                        <ServerActionItems
                          menu={DropdownMenu}
                          server={server()}
                          trigger={() => trigger ?? null}
                          onSetMuted={props.onSetMuted}
                          onSetNotificationLevel={props.onSetNotificationLevel}
                          onOpenUsage={props.onOpenUsage}
                          onOpenSchedule={props.onOpenSchedule}
                          onOpenSettings={props.onOpenSettings}
                          onLeave={props.onLeave}
                          onDelete={props.onDelete}
                          canDelete={props.canDelete}
                        />
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                )}
              </For>
              <Show when={props.onAdd}>
                <DropdownMenu.Item class="server-menu-add" onSelect={() => props.onAdd?.()}>
                  <span class="server-menu-add-circle" aria-hidden="true">
                    <Plus />
                  </span>
                  <span>{t(props.addCreatesServer ? "server.rail.add" : "server.rail.addRemote")}</span>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onOpenMarketplace}>
                <DropdownMenu.Item onSelect={() => props.onOpenMarketplace?.()}>
                  <Puzzle class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("sidebar.topbar.marketplace")}</span>
                </DropdownMenu.Item>
              </Show>
              <Show when={activeServer()}>
                {(server) => (
                  <>
                    <DropdownMenu.Separator />
                    {/* Mute and notifications are in the submenu of each server row. */}
                    <ServerActionItems
                      menu={DropdownMenu}
                      server={server()}
                      trigger={() => trigger ?? null}
                      onOpenUsage={props.onOpenUsage}
                      onOpenSchedule={props.onOpenSchedule}
                      onOpenSettings={props.onOpenSettings}
                      onLeave={props.onLeave}
                      onDelete={props.onDelete}
                      canDelete={props.canDelete}
                    />
                  </>
                )}
              </Show>
            </Show>
            <DropdownMenu.Separator />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <AppWindow class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("server.menu.layout")}</span>
                <span class="ui-menu-trailing">{t(SERVER_VIEW_LABELS[props.view])}</span>
                <ChevronRight
                  class="agent-context-submenu-chevron server-menu-layout-chevron size-4"
                  aria-hidden="true"
                />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent class="ui-action-menu agent-context-menu">
                  <DropdownMenu.RadioGroup
                    aria-label={t("server.menu.layout")}
                    value={props.view}
                    onChange={(value) => {
                      const view = SERVER_VIEWS.find((candidate) => candidate === value);
                      if (view) props.onViewChange(view);
                    }}
                  >
                    <For each={SERVER_VIEWS}>
                      {(view) => {
                        const Icon = SERVER_VIEW_ICONS[view];
                        return (
                          <DropdownMenu.RadioItem value={view}>
                            <CheckCircle checked={props.view === view} />
                            <Icon class="agent-context-icon size-4" aria-hidden="true" />
                            <span>{t(SERVER_VIEW_LABELS[view])}</span>
                          </DropdownMenu.RadioItem>
                        );
                      }}
                    </For>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* A sibling, not a parent: inside a menu root, Kobalte makes the dropdown a submenu without a focus trap. */}
      <ContextMenu.Root modal={false}>
        <ContextMenu.Trigger
          hidden
          ref={(element) => (anchor = element)}
          onContextMenu={(event) => {
            if (!activeServer()) event.preventDefault();
          }}
        />
        <ContextMenu.Portal>
          <ContextMenu.Content class="agent-context-menu" aria-label={t("server.rail.actions")}>
            <Show when={activeServer()}>
              {(server) => (
                <ServerActionItems
                  menu={ContextMenu}
                  server={server()}
                  trigger={() => trigger ?? null}
                  onSetMuted={props.onSetMuted}
                  onSetNotificationLevel={props.onSetNotificationLevel}
                  onOpenUsage={props.onOpenUsage}
                  onOpenSchedule={props.onOpenSchedule}
                  onOpenSettings={props.onOpenSettings}
                  onLeave={props.onLeave}
                  onDelete={props.onDelete}
                  canDelete={props.canDelete}
                />
              )}
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
  );
}
