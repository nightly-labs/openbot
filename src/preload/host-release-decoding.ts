import { HOST_RELEASE_METHODS, HOST_RELEASE_PHASES, type HostReleaseStatus } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

/** Independent main-to-renderer boundary. Do not import the remote host decoder here. */
export function decodeHostReleaseStatusFromMain(value: unknown): HostReleaseStatus {
  if (
    !isDynamicRecord(value) ||
    !isString(value.currentVersion) ||
    value.currentVersion.length > 64 ||
    (value.latestVersion !== null && (!isString(value.latestVersion) || value.latestVersion.length > 64)) ||
    !isOneOf(HOST_RELEASE_PHASES, value.phase) ||
    !isOneOf(HOST_RELEASE_METHODS, value.method)
  ) {
    throw new Error("Invalid release status from main.");
  }
  return {
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    phase: value.phase,
    method: value.method,
  };
}
