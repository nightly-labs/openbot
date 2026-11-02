// Frozen optional browser-profiles-events-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host tells each client
// that negotiated the capability that its named browser profiles, or the profile of one of its
// agents, changed, so the client reads them again. The event carries no data: the profiles stay
// behind the `browser-profiles-v1` routes that already guard them, the admin routes for an owner or
// admin and the tab route for every member. Widening any of it needs a second capability.
import { isDynamicRecord } from "../runtime-values";

export const BROWSER_PROFILES_EVENTS_CAPABILITY = "browser-profiles-events-v1";

export type BrowserProfilesEvent = { type: "browser-profiles-changed" };

/** The browser profiles event in `value`, or null for any other event. */
export function browserProfilesEvent(value: unknown): BrowserProfilesEvent | null {
  if (!isDynamicRecord(value) || value.type !== "browser-profiles-changed") return null;
  return { type: "browser-profiles-changed" };
}
