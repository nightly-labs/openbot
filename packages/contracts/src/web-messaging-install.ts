import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const WEB_MESSAGING_INSTALL_CHANNEL = "openbot:messaging-install";

export const WEB_MESSAGING_INSTALL_TTL_MS = 15 * 60_000;

export const WEB_MESSAGING_INSTALL_PLATFORMS = ["slack", "discord"] as const;
export type WebMessagingInstallPlatform = (typeof WEB_MESSAGING_INSTALL_PLATFORMS)[number];

export const WEB_MESSAGING_INSTALL_KEY_PREFIX = "openbot:messaging-install:";

export function webMessagingInstallKey(nonce: string): string {
  return `${WEB_MESSAGING_INSTALL_KEY_PREFIX}${nonce}`;
}

export function encodeWebMessagingInstallMark(platform: WebMessagingInstallPlatform, now: number): string {
  return JSON.stringify({ platform, expiresAt: now + WEB_MESSAGING_INSTALL_TTL_MS });
}

export function decodeWebMessagingInstallMark(value: string | null, now: number): WebMessagingInstallPlatform | null {
  if (value === null) return null;
  let mark: unknown;
  try {
    mark = JSON.parse(value);
  } catch {
    return null;
  }
  return isDynamicRecord(mark) &&
    isOneOf(WEB_MESSAGING_INSTALL_PLATFORMS, mark.platform) &&
    isNumber(mark.expiresAt) &&
    mark.expiresAt > now
    ? mark.platform
    : null;
}

export interface WebMessagingInstallGrant {
  platform: WebMessagingInstallPlatform;
  nonce: string;
  grant: string;
}

export function decodeWebMessagingInstallGrant(value: unknown): WebMessagingInstallGrant | null {
  return isDynamicRecord(value) &&
    isOneOf(WEB_MESSAGING_INSTALL_PLATFORMS, value.platform) &&
    isBoundedString(value.nonce, 128) &&
    isBoundedString(value.grant, 16_384)
    ? { platform: value.platform, nonce: value.nonce, grant: value.grant }
    : null;
}

export function webMessagingInstallReceipt(nonce: string): { received: string } {
  return { received: nonce };
}

export function decodeWebMessagingInstallReceipt(value: unknown): string | null {
  return isDynamicRecord(value) && isBoundedString(value.received, 128) ? value.received : null;
}
