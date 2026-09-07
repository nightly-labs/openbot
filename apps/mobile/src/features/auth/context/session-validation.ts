import type { MobileSession } from "../api/mobile-auth";

export function resolveSessionValidation(
  current: MobileSession | null,
  initiating: MobileSession,
  validated: MobileSession | null,
): MobileSession | null {
  if (validated === null) {
    return current?.sessionToken === initiating.sessionToken && current.apiUrl === initiating.apiUrl ? null : current;
  }
  return current === initiating ? validated : current;
}
