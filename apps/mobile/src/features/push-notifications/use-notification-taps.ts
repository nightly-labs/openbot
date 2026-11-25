import type { NotificationTarget, WorkflowTarget } from "./push-notifications-native.types";

export function useNotificationTaps(
  _open: (target: NotificationTarget) => void,
  _onScreen: (target: NotificationTarget) => boolean,
  _openWorkflow: (target: WorkflowTarget) => void,
): void {}

export function installNotificationHandler(): void {}
