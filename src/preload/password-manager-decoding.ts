// What main answers for password managers. A status never holds a key or a password. Main sends
// only the managers that this build knows: it drops the others when it reads a host's answer. The
// host answers have their own decoders in `@openbot/contracts`.

import { decodePasswordManagerStatus, type PasswordManagerStatus } from "@openbot/contracts/ipc";

/** One status from main. Throws for a manager that this build does not know. */
export function decodePasswordManagerResponse(value: unknown): PasswordManagerStatus {
  const status = decodePasswordManagerStatus(value);
  if (!status) throw new Error("Invalid password manager response.");
  return status;
}

/** The managers from main. Throws when one of them is not a status that this build knows. */
export function decodePasswordManagerResponses(value: unknown): PasswordManagerStatus[] {
  if (!Array.isArray(value)) throw new Error("Invalid password manager list response.");
  return value.map(decodePasswordManagerResponse);
}

/** A `changed` event. Null drops an event for a manager that this build does not know. */
export function decodePasswordManagerChange(value: unknown): PasswordManagerStatus | null {
  return decodePasswordManagerStatus(value);
}
