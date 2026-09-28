/**
 * The update snapshot of a host (`host-update-v1`), as the desktop main process, the preload and the
 * browser client read it. On the wire the route codec has already checked its fields; this gives
 * them their IPC types and fails closed on anything else.
 */

import {
  type HostUpdateStatus,
  type ScheduledUpdateRestart,
  UPDATE_PHASES,
  type UpdateRestartMode,
} from "./ipc-app-auth";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

const RESTART_MODES: readonly UpdateRestartMode[] = ["when-idle", "now"];

export function decodeScheduledUpdateRestart(value: unknown): ScheduledUpdateRestart {
  if (
    !isDynamicRecord(value) ||
    (value.requestedBy !== null && !isString(value.requestedBy)) ||
    !isOneOf(RESTART_MODES, value.mode) ||
    !Array.isArray(value.waitingFor) ||
    !value.waitingFor.every(isString)
  ) {
    throw new Error("Invalid scheduled restart.");
  }
  return { requestedBy: value.requestedBy, mode: value.mode, waitingFor: [...value.waitingFor] };
}

export function decodeHostUpdateStatus(value: unknown): HostUpdateStatus {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(UPDATE_PHASES, value.phase) ||
    !isString(value.currentVersion) ||
    (value.availableVersion !== null && !isString(value.availableVersion)) ||
    (value.progress !== null && !isNumber(value.progress)) ||
    (value.errorCode !== null &&
      !isOneOf(["check_failed", "download_failed", "install_failed"] as const, value.errorCode)) ||
    !isOneOf(["allowed", "disabled", "managed"] as const, value.remoteUpdates) ||
    !isBoolean(value.autoDownload) ||
    !isBoolean(value.autoInstall)
  ) {
    throw new Error("Invalid host update status.");
  }
  return {
    phase: value.phase,
    currentVersion: value.currentVersion,
    availableVersion: value.availableVersion,
    progress: value.progress,
    errorCode: value.errorCode,
    remoteUpdates: value.remoteUpdates,
    autoDownload: value.autoDownload,
    autoInstall: value.autoInstall,
    restart: value.restart === null ? null : decodeScheduledUpdateRestart(value.restart),
  };
}
