import type { NotificationSound } from "@openbot/contracts/notification-relay";
import type { NotificationPermission } from "@/features/settings/model/push-notifications";

/** The data key of a sound preview. The notification handler plays it and shows nothing. */
export const SOUND_PREVIEW_KEY = "openbotSoundPreview";

/**
 * The native side of notifications: permission, the push token, and the keys that open a sealed
 * notification. iOS opens it in the Notification Service Extension, Android in the Firebase messaging
 * service of the app.
 */
export interface PushNotificationsNative {
  /**
   * Reads the permission, and asks once when the phone has not asked yet. `asked` receives the answer
   * only when the phone showed its prompt.
   */
  permission(asked?: (answer: NotificationPermission) => void): Promise<NotificationPermission>;
  /**
   * The push token of the app, or `null` when the phone gives none: the APNs token as lowercase hex on
   * iOS, the Firebase Cloud Messaging token on Android.
   */
  deviceToken(): Promise<string | null>;
  /** The phone can give the app a new token. Returns the function that stops listening. */
  onDeviceToken(listener: (token: string | null) => void): () => void;
  /**
   * Writes the notification keys of each server where the code that opens notifications reads them,
   * with the server names, so a notification says its server when the phone has more than one.
   */
  writeKeys(servers: readonly { serverId: string; name: string; seal: string; tag: string }[]): void;
  /** Sign-out removes the keys, so a notification sent after it shows nothing of the workspace. */
  removeKeys(): void;
  /** Plays `sound` as a notification plays it. In silent mode the phone plays it as it plays a notification. */
  previewSound(sound: NotificationSound): Promise<void>;
}

/** What a notification names: its agent, and the server and thread of the event. */
export interface NotificationTarget {
  agentId: string;
  serverId: string | null;
  /** The thread of the event. A thread of a channel opens the channel. */
  threadId: string | null;
}
