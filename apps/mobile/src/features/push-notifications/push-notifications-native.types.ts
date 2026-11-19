import type { NotificationSound } from "@openbot/contracts/notification-relay";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";
import type { OutsideTarget } from "@/features/workspace/model/outside-target";

export const SOUND_PREVIEW_KEY = "openbotSoundPreview";

export interface PushNotificationsNative {
  permission(asked?: (answer: NotificationPermission) => void): Promise<NotificationPermission>;
  deviceToken(): Promise<string | null>;
  onDeviceToken(listener: (token: string | null) => void): () => void;
  writeKeys(servers: readonly { serverId: string; name: string; seal: string; tag: string }[]): void;
  removeKeys(): void;
  previewSound(sound: NotificationSound): Promise<void>;
}

export type NotificationTarget = OutsideTarget;
