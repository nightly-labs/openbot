import { isDynamicRecord } from "../runtime-values";

export const BROWSER_PROFILES_EVENTS_CAPABILITY = "browser-profiles-events-v1";

export type BrowserProfilesEvent = { type: "browser-profiles-changed" };

export function browserProfilesEvent(value: unknown): BrowserProfilesEvent | null {
  if (!isDynamicRecord(value) || value.type !== "browser-profiles-changed") return null;
  return { type: "browser-profiles-changed" };
}
