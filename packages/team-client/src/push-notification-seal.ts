import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { LIVE_ACTIVITY_SECRET_BYTES, sealLiveActivity } from "./live-activity-seal";

export interface PushNotificationKeys {
  seal: Uint8Array;
  tag: Uint8Array;
}

export type PushNotificationKind = "reply" | "failed" | "input" | "approval" | "browser" | "sign-in";

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

export function sealPushNotification(
  content: PushNotificationContent,
  keys: PushNotificationKeys,
  nonce: Uint8Array,
): string {
  return sealLiveActivity(JSON.stringify(content), keys, nonce);
}
