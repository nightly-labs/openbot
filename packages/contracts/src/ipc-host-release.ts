import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const HOST_RELEASE_PHASES = ["idle", "checking", "available", "up-to-date", "error", "unavailable"] as const;
export const HOST_RELEASE_METHODS = [
  "self-update",
  "host-manager",
  "hosted",
  "system",
  "container",
  "manual",
  "unavailable",
] as const;

/** IPC values stay native: the sandboxed preload cannot load Effect. */
export interface HostReleaseStatus {
  currentVersion: string;
  latestVersion: string | null;
  phase: (typeof HOST_RELEASE_PHASES)[number];
  method: (typeof HOST_RELEASE_METHODS)[number];
}

export function decodeHostReleaseStatus(value: unknown): HostReleaseStatus {
  if (
    !isDynamicRecord(value) ||
    !isString(value.currentVersion) ||
    value.currentVersion.length > 64 ||
    (value.latestVersion !== null && (!isString(value.latestVersion) || value.latestVersion.length > 64)) ||
    !isOneOf(HOST_RELEASE_PHASES, value.phase) ||
    !isOneOf(HOST_RELEASE_METHODS, value.method)
  ) {
    throw new Error("Invalid host release status.");
  }
  return {
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    phase: value.phase,
    method: value.method,
  };
}
