import { canAdministerServer, type ServerNotificationLevel, type ServerSummary } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import { Bell, BellOff, ChevronRight, type ContextMenu, EyeOff, LogOut, RotateCcw, Trash2 } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

export const SERVER_MUTE_CHOICES: readonly { label: AppTextKey; durationMs?: number }[] = [
  { label: "server.mute.for15Minutes", durationMs: 15 * 60_000 },
  { label: "server.mute.for1Hour", durationMs: 60 * 60_000 },
  { label: "server.mute.for3Hours", durationMs: 3 * 60 * 60_000 },
  { label: "server.mute.for8Hours", durationMs: 8 * 60 * 60_000 },
  { label: "server.mute.for24Hours", durationMs: 24 * 60 * 60_000 },
  { label: "server.mute.untilTurnedOn" },
];

export const SERVER_NOTIFICATION_LEVEL_LABELS = {
  all: "server.notificationLevel.all",
  "needs-me": "server.notificationLevel.needsMe",
  nothing: "server.notificationLevel.nothing",
} as const satisfies Record<ServerNotificationLevel, AppTextKey>;

export function serverMuteDescription(
  server: Pick<ServerSummary, "notificationsMutedUntil">,
  t: AppTranslate,
  format: AppFormat,
  now = new Date(),
): string {
  if (server.notificationsMutedUntil === null) return t("server.mute.muted");
  const until = new Date(server.notificationsMutedUntil);
  const sameDay = until.toDateString() === now.toDateString();
  const time = format.date(until, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { weekday: "short" }),
  });
  return t("server.mute.mutedUntil", { time });
}

export type ServerActionMenu = Pick<
  typeof ContextMenu,
  "Item" | "Sub" | "SubTrigger" | "SubContent" | "Portal" | "RadioGroup" | "RadioItem" | "Separator"
>;

export interface ServerActionCallbacks {
  onSetMuted?: ((serverId: string, muted: boolean, durationMs?: number) => void) | undefined;
  onOpenNotificationSettings?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  onOpenSettings?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  onLeave?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  onDelete?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  onRemove?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  canRemove?: ((serverId: string) => boolean) | undefined;
  canDelete?: ((serverId: string) => boolean) | undefined;
  onRestart?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  canRestart?: ((serverId: string) => boolean) | undefined;
  onHide?: ((serverId: string) => void) | undefined;
  canHide?: ((serverId: string) => boolean) | undefined;
  planDeletesAt?: ((serverId: string) => number | null) | undefined;
  onRenewPlan?: ((serverId: string) => Promise<void>) | undefined;
}

export function accountRestartsServer(server: Pick<ServerSummary, "hosted" | "restartAvailable">): boolean {
  return server.hosted === true && server.restartAvailable !== false;
}

export function ServerActionItems(
  props: ServerActionCallbacks & {
    menu: ServerActionMenu;
    server: ServerSummary;
    trigger: () => HTMLElement | null;
  },
) {
  const { t, format } = useText();
  const muteDescription = () => serverMuteDescription(props.server, t, format);
  const canLeave = () => Boolean(props.onLeave) && props.server.kind === "remote" && props.server.role !== "owner";
  const canDelete = () =>
    Boolean(props.onDelete) && props.server.kind === "remote" && Boolean(props.canDelete?.(props.server.id));
  const canRemove = () =>
    Boolean(props.onRemove) &&
    props.server.kind === "remote" &&
    props.server.role === "owner" &&
    Boolean(props.canRemove?.(props.server.id));
  const canRestart = () =>
    Boolean(props.onRestart) &&
    props.server.kind === "remote" &&
    canAdministerServer(props.server.role) &&
    !(props.server.hostedSleep === "waking" && props.server.hostedStart?.step !== "openbot") &&
    (accountRestartsServer(props.server) || Boolean(props.canRestart?.(props.server.id)));
  const canHide = () => Boolean(props.onHide) && Boolean(props.canHide?.(props.server.id));
  const Menu = props.menu;
  return (
    <>
      <Show when={props.onSetMuted}>
        <Show
          when={!props.server.notificationsMuted}
          fallback={
            <Menu.Item class="server-rail-menu-detail-item" onSelect={() => props.onSetMuted?.(props.server.id, false)}>
              <Bell class="agent-context-icon size-4" aria-hidden="true" />
              <span class="server-rail-menu-label">
                <span>{t("server.rail.unmute")}</span>
                <span class="server-rail-menu-detail">{muteDescription()}</span>
              </span>
            </Menu.Item>
          }
        >
          <Menu.Sub>
            <Menu.SubTrigger>
              <BellOff class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("server.rail.mute")}</span>
              <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent class="ui-action-menu agent-context-menu">
                <For each={SERVER_MUTE_CHOICES}>
                  {(choice) => (
                    <Menu.Item onSelect={() => props.onSetMuted?.(props.server.id, true, choice.durationMs)}>
                      <span>{t(choice.label)}</span>
                    </Menu.Item>
                  )}
                </For>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </Show>
      </Show>
      <Show when={props.onOpenNotificationSettings}>
        <Menu.Item
          class="server-rail-menu-detail-item"
          onSelect={() => props.onOpenNotificationSettings?.(props.server.id, props.trigger())}
        >
          <Bell class="agent-context-icon size-4" aria-hidden="true" />
          <span class="server-rail-menu-label">
            <span>{t("server.rail.notificationSettings")}</span>
            <span class="server-rail-menu-detail">
              {t(SERVER_NOTIFICATION_LEVEL_LABELS[props.server.notificationLevel])}
            </span>
          </span>
        </Menu.Item>
      </Show>
      <Show when={props.onSetMuted || props.onOpenNotificationSettings}>
        <Menu.Separator />
      </Show>
      <Show when={props.onOpenSettings}>
        <Menu.Item onSelect={() => props.onOpenSettings?.(props.server.id, props.trigger())}>
          <ServerSettingsGlyph />
          <span>{t("server.rail.settings")}</span>
        </Menu.Item>
      </Show>
      <Show when={canRestart() || canLeave() || canDelete() || canRemove() || canHide()}>
        <Menu.Separator />
        <Show when={canHide()}>
          <Menu.Item onSelect={() => props.onHide?.(props.server.id)}>
            <EyeOff class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("server.rail.hide")}</span>
          </Menu.Item>
        </Show>
        <Show when={canRestart()}>
          <Menu.Item onSelect={() => props.onRestart?.(props.server.id, props.trigger())}>
            <RotateCcw class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("server.rail.restart")}</span>
          </Menu.Item>
        </Show>
        <Show when={canLeave()}>
          <Menu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => props.onLeave?.(props.server.id, props.trigger())}
          >
            <LogOut class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("server.rail.leave")}</span>
          </Menu.Item>
        </Show>
        <Show when={canRemove()}>
          <Menu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => props.onRemove?.(props.server.id, props.trigger())}
          >
            <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("server.rail.remove")}</span>
          </Menu.Item>
        </Show>
        <Show when={canDelete()}>
          <Menu.Item
            class="ui-action-menu-danger agent-context-danger"
            onSelect={() => props.onDelete?.(props.server.id, props.trigger())}
          >
            <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("server.rail.delete")}</span>
          </Menu.Item>
        </Show>
      </Show>
    </>
  );
}

function ServerSettingsGlyph() {
  return (
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
  );
}
