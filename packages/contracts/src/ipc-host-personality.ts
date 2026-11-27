import { isDynamicRecord } from "./runtime-values";

export const RESPONSE_STYLES = ["natural", "classic"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];
export const DEFAULT_RESPONSE_STYLE: ResponseStyle = "natural";
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
