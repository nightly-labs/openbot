import type { NotificationSound } from "./notification-relay";

/**
 * One iOS Live Activity update that a host asks the OpenBot account service to send through Apple
 * Push Notification service. The content is sealed by the host with keys that only the phone knows,
 * so the service and Apple forward it without reading it. The service builds the Apple payload
 * itself, and an alert has only its own fixed text, so a host cannot use it to send an ordinary
 * notification.
 */
export interface LiveActivityRelayPush {
  /** The ActivityKit push token of the activity, as hex. */
  token: string;
  /** Development builds receive pushes from the APNs sandbox. */
  environment: "production" | "development";
  /** `end` ends the activity, as the phone does when nothing needs the user. */
  event: "update" | "end";
  /** The sealed props, base64url. `null` for `end`. */
  sealed: string | null;
  /** When the host made the update, in seconds. iOS ignores an update older than the one it shows. */
  timestamp: number;
  /** When iOS marks the content out of date, in seconds, or `null`. */
  staleAt: number | null;
  /**
   * 10 shows the update at once and uses the hourly budget that iOS has for them: an alert, a new
   * request, failure or reply, and an agent that finishes its work. 5 is for each other change, which
   * iOS can delay.
   */
  priority: 5 | 10;
  /**
   * An update that shows an event that notifies the member: iOS lights up the screen, shows the
   * activity, and plays the sound, in place of a notification. `null` for other updates. Hosts
   * before this field send none, and the service reads that as `null`.
   */
  alert: { sound: NotificationSound | null } | null;
}

/** A sealed update above this size would not fit the 4 KB Apple payload with its envelope. */
export const LIVE_ACTIVITY_SEALED_LIMIT = 3_600;
export const LIVE_ACTIVITY_TOKEN_PATTERN = /^(?:[0-9a-f]{2}){8,256}$/u;
