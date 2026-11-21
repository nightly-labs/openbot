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
  Eye,
  Moon,
  MotionTooltip,
  PanelLeft,
  Plus,
  Server,
} from "@openbot/ui";
import { SwapLabel } from "@openbot/ui/components/SwapLabel";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { CreditAmount, CreditIcon } from "../credits/CreditIcon";
import type { CreditsMenu } from "../credits/credits-store";
import { type ServerActionCallbacks, ServerActionItems } from "./ServerActionItems";
import {
  ServerPlanBanner,
  ServerPlanChip,
  ServerPlanCount,
  serverPlanDaysLeft,
  serverPlanEnds,
  serverPlanStatusLabels,
} from "./ServerPlanEnd";
import {
  addServerLabel,
  type HiddenLocalServer,
  ServerMark,
  ServerSleepDot,
  serverHostedSleep,
  serverStatusLabels,
} from "./ServerRail";

export type ServerView = "rail" | "menu";

const SERVER_VIEWS: readonly ServerView[] = ["rail", "menu"];

const SERVER_VIEW_LABELS = {
  rail: "server.menu.layoutRail",
  menu: "server.menu.layoutMenu",
} as const satisfies Record<ServerView, AppTextKey>;

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
  addCreatesServer?: boolean | undefined;
  onCreateLocal?: (() => void) | undefined;
  onInstallServer?: (() => void) | undefined;
  hiddenLocal?: HiddenLocalServer | undefined;
  compact?: boolean;
  rail?: boolean;
  credits?: CreditsMenu | undefined;
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

function CreditsItem(props: { label: string; balance: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={props.onSelect}>
      <CreditIcon class="agent-context-icon size-4" />
      <span>{props.label}</span>
      <span class="ui-menu-trailing server-menu-credit-value">{props.balance}</span>
    </DropdownMenu.Item>
  );
}

function CreditsCard(props: { balance: number; onOpen: () => void }) {
  const { t, format } = useText();
  return (
    <div class="server-menu-credits-card">
      <DropdownMenu.Item
        class="server-menu-credits-line"
        aria-label={[
          t("billing.credits.yours"),
          t("billing.credits.amount", { count: props.balance, amount: format.number(props.balance) }),
        ].join(", ")}
        onSelect={props.onOpen}
      >
        <span class="server-menu-credits-label">{t("billing.credits.yours")}</span>
        <CreditAmount value={format.number(props.balance)} class="ui-menu-trailing server-menu-credit-value" />
      </DropdownMenu.Item>
      <div class="server-menu-credits-buy">
        <CreditIcon class="server-menu-credits-buy-icon" />
        <span class="server-menu-credits-buy-label" aria-hidden="true">
          {t("billing.credits.buy")}
        </span>
        <DropdownMenu.Item
          class="server-menu-credits-get"
          aria-label={t("billing.credits.buy")}
          onSelect={props.onOpen}
        >
          {t("billing.credits.get")}
        </DropdownMenu.Item>
      </div>
    </div>
  );
}

let lastShown: { id: string | undefined; name: string } | undefined;

export function ServerMenu(props: ServerMenuProps) {
  const { t, format } = useText();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const rail = untrack(() => props.rail === true);
  let anchor: HTMLElement | undefined;
  let trigger: HTMLElement | undefined;
  const activeServer = () => props.servers.find((server) => server.active);
  const activeServers = () => props.servers.filter((server) => server.active);
  const activeSleep = () => {
    const server = activeServer();
    return server ? serverHostedSleep(server) : null;
  };
  const planEnds = () => serverPlanEnds(props.servers, props.planDeletesAt);
  const planDeletesAt = (serverId: string) => props.planDeletesAt?.(serverId) ?? null;
  const credits = () => {
    const state = props.credits?.state;
    return state?.available ? state : null;
  };
  const serverWallet = (serverId: string) => credits()?.servers.find((wallet) => wallet.serverId === serverId) ?? null;
  const serverCreditLabels = (serverId: string) => {
    const wallet = serverWallet(serverId);
    return wallet
      ? [t("billing.credits.amount", { count: wallet.balance, amount: format.number(wallet.balance) })]
      : [];
  };
  function openCredits(serverId: string | null): void {
    props.credits?.onOpen(serverId);
  }
  const creditsCard = () => (
    <Show when={credits()}>
      {(state) => <CreditsCard balance={state().balance} onOpen={() => openCredits(null)} />}
    </Show>
  );
  function changeMenuOpen(open: boolean): void {
    setMenuOpen(open);
    if (open) props.credits?.onRefresh();
  }
  const planCount = () => {
    const first = props.view === "menu" ? planEnds()[0] : undefined;
    return first ? serverPlanDaysLeft(first.deleteAt) : null;
  };
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

  function selectOnKey(row: HTMLElement, server: () => ServerSummary): void {
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      selectServer(server());
    });
  }

  const triggerButton = () => (
    <DropdownMenu.Trigger
      ref={(element) => (trigger = element)}
      class={
        rail
          ? "window-rail-button window-rail-server"
          : buttonVariants({ variant: "ghost", size: "sm", class: "sidebar-server-name no-drag" })
      }
      aria-label={[
        t("server.menu.open", { name: props.serverName }),
        ...(activeSleep() === "sleeping" ? [t("server.state.sleeping")] : []),
        ...(activeSleep() === "waking" ? [t("server.state.waking")] : []),
        ...(props.view === "menu"
          ? planEnds().flatMap((end) => [
              end.server.name,
              ...serverPlanStatusLabels(end.server, end.deleteAt, t, format),
            ])
          : []),
      ].join(", ")}
      aria-hidden={props.compact ? "true" : undefined}
      aria-keyshortcuts="Shift+F10"
      tabindex={props.compact ? -1 : 0}
      title={rail ? undefined : triggerTitle()}
      onContextMenu={(event) => {
        event.preventDefault();
        openActions(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKey(event)) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        if (rail) openActions(bounds.right, bounds.top);
        else openActions(bounds.left, bounds.bottom);
      }}
    >
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
      <Show
        when={!rail}
        fallback={
          <Show when={activeSleep()}>
            {(sleep) => (
              <span class="server-menu-sleep window-rail-server-sleep" data-state={sleep()} aria-hidden="true" />
            )}
          </Show>
        }
      >
        <SwapLabel class="sidebar-server-name-label" text={props.serverName} from={shownBefore?.name} dir="auto" />
        <Show when={activeSleep()}>
          {(sleep) => <Moon class="sidebar-server-name-sleep" data-state={sleep()} aria-hidden="true" />}
        </Show>
        <ChevronsUpDown class="sidebar-server-name-chevron" aria-hidden="true" />
      </Show>
      <Show when={planCount()}>{(count) => <ServerPlanCount count={count()} class="server-plan-trigger-count" />}</Show>
    </DropdownMenu.Trigger>
  );

  return (
    <>
      <DropdownMenu.Root
        open={menuOpen()}
        onOpenChange={changeMenuOpen}
        placement={rail ? "right-end" : "bottom-start"}
        gutter={rail ? 10 : 6}
      >
        <Show when={rail} fallback={triggerButton()}>
          <MotionTooltip content={triggerTitle()} suppressed={menuOpen()}>
            {triggerButton()}
          </MotionTooltip>
        </Show>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="agent-context-menu server-menu" aria-label={t("server.menu.label")}>
            <Show
              when={props.view === "menu"}
              fallback={
                <>
                  {creditsCard()}
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
                        onRestart={props.onRestart}
                        canRestart={props.canRestart}
                        onRemove={props.onRemove}
                        canRemove={props.canRemove}
                        onHide={props.onHide}
                        canHide={props.canHide}
                      />
                    )}
                  </Show>
                </>
              }
            >
              <Show when={props.onRenewPlan}>
                {(onRenewPlan) => (
                  <For each={planEnds()} keyed={(end) => end.server.id}>
                    {(end) => <ServerPlanBanner menu={DropdownMenu} end={end()} onRenew={onRenewPlan()} />}
                  </For>
                )}
              </Show>
              {creditsCard()}
              <div class="ui-menu-label" aria-hidden="true">
                {t("server.rail.label")}
              </div>
              <For each={props.servers} keyed={(server) => server.id}>
                {(server) => (
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger
                      class="server-menu-row"
                      aria-label={[
                        server().name,
                        ...serverStatusLabels(server(), t),
                        ...serverPlanStatusLabels(server(), planDeletesAt(server().id), t, format),
                        ...serverCreditLabels(server().id),
                      ].join(", ")}
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
                      <ServerPlanChip server={server()} deleteAt={planDeletesAt(server().id)} />
                      <Show when={serverWallet(server().id)}>
                        {(wallet) => (
                          <CreditAmount value={format.number(wallet().balance)} class="server-menu-credits" />
                        )}
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
                        <Show when={serverWallet(server().id)}>
                          {(wallet) => (
                            <>
                              <CreditsItem
                                label={t("billing.credits.title")}
                                balance={format.number(wallet().balance)}
                                onSelect={() => openCredits(wallet().serverId)}
                              />
                              <DropdownMenu.Separator />
                            </>
                          )}
                        </Show>
                        <ServerActionItems
                          menu={DropdownMenu}
                          server={server()}
                          trigger={() => trigger ?? null}
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
                  <span>{t(addServerLabel(props))}</span>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onCreateLocal}>
                {(onCreateLocal) => (
                  <DropdownMenu.Item class="server-menu-add" onSelect={() => onCreateLocal()()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Plus />
                    </span>
                    <span>{t("server.local.createTitle")}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={props.onInstallServer}>
                {(onInstallServer) => (
                  <DropdownMenu.Item class="server-menu-add" onSelect={() => onInstallServer()()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Server />
                    </span>
                    <span>{t("server.install.title")}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={props.hiddenLocal}>
                {(hiddenLocal) => (
                  <DropdownMenu.Item class="server-menu-add" onSelect={() => hiddenLocal().show()}>
                    <span class="server-menu-add-circle" aria-hidden="true">
                      <Eye />
                    </span>
                    <span>{t("server.rail.showLocal", { name: hiddenLocal().name })}</span>
                  </DropdownMenu.Item>
                )}
              </Show>
              <Show when={activeServer()}>
                {(server) => (
                  <>
                    <DropdownMenu.Separator />
                    <ServerActionItems
                      menu={DropdownMenu}
                      server={server()}
                      trigger={() => trigger ?? null}
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
              )}
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </>
  );
}
