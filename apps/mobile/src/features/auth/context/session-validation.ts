import { type MobileSession, sameCredential } from "../api/mobile-auth";

export function resolveSessionValidation(
  current: MobileSession | null,
  initiating: MobileSession,
  validated: MobileSession | null,
): MobileSession | null {
  return current && sameCredential(current, initiating) ? validated : current;
}
