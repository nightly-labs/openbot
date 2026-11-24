import type { NotificationTarget } from "./push-notifications-native.types";

export function useNotificationTaps(
  _open: (target: NotificationTarget) => void,
  _onScreen: (target: NotificationTarget) => boolean,
  _openWorkflows: (serverId: string) => void,
): void {}

export function installNotificationHandler(): void {}
