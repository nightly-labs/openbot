/**
 * The app gets notifications on iOS and Android, where `use-notification-taps.native.ts` replaces
 * this file. The tests do not load `expo-notifications`.
 */
import type { NotificationTarget } from "./push-notifications-native.types";

export function useNotificationTaps(
  _open: (target: NotificationTarget) => void,
  _openChat: () => string | null,
): void {}

export function installNotificationHandler(): void {}
