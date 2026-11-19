import { decodePasswordManagerStatus, type PasswordManagerStatus } from "@openbot/contracts/ipc";

export function decodePasswordManagerResponse(value: unknown): PasswordManagerStatus {
  const status = decodePasswordManagerStatus(value);
  if (!status) throw new Error("Invalid password manager response.");
  return status;
}

export function decodePasswordManagerResponses(value: unknown): PasswordManagerStatus[] {
  if (!Array.isArray(value)) throw new Error("Invalid password manager list response.");
  return value.map(decodePasswordManagerResponse);
}

export function decodePasswordManagerChange(value: unknown): PasswordManagerStatus | null {
  return decodePasswordManagerStatus(value);
}
