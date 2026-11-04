import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { LIVE_ACTIVITY_SECRET_BYTES, sealLiveActivity } from "./live-activity-seal";

/**
 * The host sends an iOS notification through the OpenBot relay and Apple, so it seals the agent name
 * and the text with keys that only the phone and the host know. The Notification Service Extension
 * of the app opens it before iOS shows it (`NotificationService.swift` in the mobile app plugins).
 *
 * The seal is the Live Activity seal with keys of their own, made from the same host secret, so a
 * sealed notification does not open as a Live Activity update or the reverse.
 */
export interface PushNotificationKeys {
  seal: Uint8Array;
  tag: Uint8Array;
}

export type PushNotificationKind = "reply" | "failed" | "input" | "approval" | "browser" | "usage-limit";

/** What the extension shows, and what the app opens when the user taps the notification. */
export interface PushNotificationContent {
  serverId: string;
  agentId: string;
  threadId: string | null;
  kind: PushNotificationKind;
  title: string;
  body: string;
}

export function pushNotificationKeys(secret: Uint8Array): PushNotificationKeys {
  if (secret.length !== LIVE_ACTIVITY_SECRET_BYTES) throw new Error("The notification secret has a wrong size.");
  const derive = (label: string) => hmac(sha256, secret, utf8ToBytes(`openbot push notification ${label}`));
  return { seal: derive("seal"), tag: derive("tag") };
}

/** Seals `content` for the extension. Use a new random `nonce` for each seal. */
export function sealPushNotification(
  content: PushNotificationContent,
  keys: PushNotificationKeys,
  nonce: Uint8Array,
): string {
  return sealLiveActivity(JSON.stringify(content), keys, nonce);
}
