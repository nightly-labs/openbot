import type { ServerNotificationLevel, ServerSummary } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import { Bell, BellOff, ChartArea, Check, ChevronRight, type ContextMenu } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

// The same choices as Discord's server menu. No duration mutes until the user unmutes.
const MUTE_CHOICES: readonly { label: AppTextKey; durationMs?: number }[] = [
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

const NOTIFICATION_LEVELS: readonly ServerNotificationLevel[] = ["all", "needs-me", "nothing"];

/** "Muted until 14:30", with the weekday when the mute ends on another day. */
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

/**
 * The menu parts the actions use. The context menu and the dropdown menu are the same Kobalte menu,
 * so the rail's context menu and the server menu on the sidebar title render one set of items.
 */
export type ServerActionMenu = Pick<
  typeof ContextMenu,
  "Item" | "Sub" | "SubTrigger" | "SubContent" | "Portal" | "RadioGroup" | "RadioItem" | "Separator"
>;

export interface ServerActionCallbacks {
  onSetMuted?: ((serverId: string, muted: boolean, durationMs?: number) => void) | undefined;
  onSetNotificationLevel?: ((serverId: string, level: ServerNotificationLevel) => void) | undefined;
  onOpenUsage?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
  onOpenSettings?: ((serverId: string, trigger: HTMLElement | null) => void) | undefined;
}

/** Mute, notification level, usage and settings for one server. */
export function ServerActionItems(
  props: ServerActionCallbacks & {
    menu: ServerActionMenu;
    server: ServerSummary;
    /** The element that focus and the settings or usage panel return to. */
    trigger: () => HTMLElement | null;
  },
) {
  const { t, format } = useText();
  const muteDescription = () => serverMuteDescription(props.server, t, format);
  // A component, so the JSX below can use it as a tag. The menu does not change after render.
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
                <For each={MUTE_CHOICES}>
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
      <Show when={props.onSetNotificationLevel}>
        <Menu.Sub>
          <Menu.SubTrigger class="server-rail-menu-detail-item">
            <Bell class="agent-context-icon size-4" aria-hidden="true" />
            <span class="server-rail-menu-label">
              <span>{t("server.rail.notificationSettings")}</span>
              <span class="server-rail-menu-detail">
                {t(SERVER_NOTIFICATION_LEVEL_LABELS[props.server.notificationLevel])}
              </span>
            </span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent class="ui-action-menu agent-context-menu">
              <Menu.RadioGroup
                value={props.server.notificationLevel}
                onChange={(value) => {
                  const level = NOTIFICATION_LEVELS.find((candidate) => candidate === value);
                  if (level) props.onSetNotificationLevel?.(props.server.id, level);
                }}
              >
                <For each={NOTIFICATION_LEVELS}>
                  {(level) => (
                    <Menu.RadioItem value={level}>
                      <span>{t(SERVER_NOTIFICATION_LEVEL_LABELS[level])}</span>
                      <Show when={props.server.notificationLevel === level}>
                        <Check class="agent-context-submenu-chevron size-4" aria-hidden="true" />
                      </Show>
                    </Menu.RadioItem>
                  )}
                </For>
              </Menu.RadioGroup>
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      </Show>
      <Show when={props.onSetMuted || props.onSetNotificationLevel}>
        <Menu.Separator />
      </Show>
      <Show when={props.onOpenUsage}>
        <Menu.Item onSelect={() => props.onOpenUsage?.(props.server.id, props.trigger())}>
          <ChartArea class="agent-context-icon size-4" aria-hidden="true" />
          <span>{t("server.rail.usage")}</span>
        </Menu.Item>
      </Show>
      <Show when={props.onOpenSettings}>
        <Menu.Item onSelect={() => props.onOpenSettings?.(props.server.id, props.trigger())}>
          <ServerSettingsGlyph />
          <span>{t("server.rail.settings")}</span>
        </Menu.Item>
      </Show>
    </>
  );
}

/** Two stacked server units. */
export function ServerSettingsGlyph() {
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
