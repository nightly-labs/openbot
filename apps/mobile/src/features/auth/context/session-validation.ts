import type { MobileSession } from "../api/mobile-auth";

export function resolveSessionValidation(
  current: MobileSession | null,
  initiating: MobileSession,
  validated: MobileSession | null,
): MobileSession | null {
  // Called inside the profile queue: an earlier read applies before a later edit.
  // A different login can still replace this session independently of that queue.
  return current?.sessionToken === initiating.sessionToken && current.apiUrl === initiating.apiUrl
    ? validated
    : current;
}
