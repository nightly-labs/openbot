import type { MobileSession } from "../api/mobile-auth";

export function resolveSessionValidation(
  current: MobileSession | null,
  initiating: MobileSession,
  validated: MobileSession | null,
): MobileSession | null {
  return current?.sessionToken === initiating.sessionToken && current.apiUrl === initiating.apiUrl
    ? validated
    : current;
}
