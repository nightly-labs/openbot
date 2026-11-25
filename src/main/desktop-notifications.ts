import type { AgentEvent, ServerNotificationLevel, ServerSummary } from "@openbot/contracts/ipc";
import {
  agentEventAgentId,
  agentEventCanNotify,
  agentEventNeedsUser,
  agentNotificationLevel,
} from "@openbot/team-client/agent-notifications";
import { Effect } from "effect";
import type { Notification } from "electron";
import type { NotificationPreferenceStore } from "./notification-preference-store";

export function desktopShowsAgentEvent(
  event: AgentEvent,
  server: Pick<ServerSummary, "notificationsMuted" | "notificationLevel"> | undefined,
  enabled: boolean,
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null = null,
): boolean {
  return desktopAgentEventLevel(event, server, enabled, agentLevels) !== null;
}

export function desktopAgentEventLevel(
  event: AgentEvent,
  server: Pick<ServerSummary, "notificationsMuted" | "notificationLevel"> | undefined,
  enabled: boolean,
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null,
  hiddenAgentIds: ReadonlySet<string> | null = null,
): ServerNotificationLevel | null {
  if (!enabled || !server || server.notificationsMuted || server.notificationLevel === "nothing") return null;
  if (event.type === "usage-limit-reached") return server.notificationLevel;
  if (!agentEventCanNotify(event) && event.type !== "subagent-failed") return null;
  const agentId = agentEventAgentId(event);
  const hidden = agentId !== null && hiddenAgentIds?.has(agentId) === true;
  const level = agentNotificationLevel(server.notificationLevel, agentLevels, agentId, hidden);
  return level === "all" || (level === "needs-me" && agentEventNeedsUser(event)) ? level : null;
}

export const RETAINED_NOTIFICATION_LIMIT = 50;
const retained = new Set<Notification>();

export function releaseWhenNotificationGone(notification: Notification, release: () => void): void {
  notification.on("click", release);
  notification.on("failed", release);
  notification.on("close", (details) => {
    const movedToNotificationCenter = details.reason === "timedOut";
    if (!movedToNotificationCenter) release();
  });
}

export function showRetainedNotification(notification: Notification): void {
  releaseWhenNotificationGone(notification, () => retained.delete(notification));
  retained.add(notification);
  for (const oldest of retained) {
    if (retained.size <= RETAINED_NOTIFICATION_LIMIT) break;
    retained.delete(oldest);
  }
  notification.show();
}

export function closeRetainedNotification(notification: Notification): void {
  retained.delete(notification);
  notification.close();
}

export type NotificationChat = { agentId: string } | { channelId: string };

export interface NotificationPermissionRequest {
  platform: NodeJS.Platform;
  preference: Pick<NotificationPreferenceStore, "get" | "permissionRequested" | "markPermissionRequested">;
  showWelcome: () => void;
}

export const requestNotificationPermission = Effect.fn("requestNotificationPermission")(function* ({
  platform,
  preference,
  showWelcome,
}: NotificationPermissionRequest) {
  if (platform !== "darwin" || preference.permissionRequested() || !preference.get().desktopNotifications) return;
  yield* preference.markPermissionRequested();
  showWelcome();
});

const NOTIFICATION_SETTINGS_URLS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
  win32: "ms-settings:notifications",
};

export function notificationSettingsUrl(platform: NodeJS.Platform): string | null {
  return NOTIFICATION_SETTINGS_URLS[platform] ?? null;
}
