/**
 * The server personality (`host-personality-v1`), as the desktop main process, the preload and the
 * browser client read it. On the wire the route codec has already checked its fields; this gives
 * them their IPC types and fails closed on anything else.
 */

import { isDynamicRecord } from "./runtime-values";

/**
 * How the server's agents talk while they work. `natural`: a short update when a finding changes the
 * plan or before a long step, and the chat shows each update as a message. `classic`: no updates
 * between steps, and the chat keeps them in the steps.
 */
export const RESPONSE_STYLES = ["natural", "classic"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];
export const DEFAULT_RESPONSE_STYLE: ResponseStyle = "natural";
/** A host that does not advertise `host-personality-v1` uses the classic prompt. */
export const LEGACY_RESPONSE_STYLE: ResponseStyle = "classic";

export interface HostPersonality {
  responseStyle: ResponseStyle;
}

export function isResponseStyle(value: unknown): value is ResponseStyle {
  return RESPONSE_STYLES.some((style) => style === value);
}

export function decodeHostPersonality(value: unknown): HostPersonality {
  if (!isDynamicRecord(value) || !isResponseStyle(value.responseStyle)) {
    throw new Error("Invalid server personality.");
  }
  return { responseStyle: value.responseStyle };
}
