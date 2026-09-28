/**
 * The update snapshot of a host (`host-update-v1`), as the desktop main process, the preload and the
 * browser client read it. On the wire the route codec has already checked its fields; this gives
 * them their IPC types and fails closed on anything else.
 */

import {
  type HostUpdateStatus,
  REMOTE_UPDATES_STATES,
  type ScheduledUpdateRestart,
  UPDATE_FAILURE_CODES,
  UPDATE_PHASES,
  UPDATE_RESTART_MODES,
} from "./ipc-app-auth";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export function decodeScheduledUpdateRestart(value: unknown): ScheduledUpdateRestart {
  if (
    !isDynamicRecord(value) ||
    (value.requestedBy !== null && !isString(value.requestedBy)) ||
    !isOneOf(UPDATE_RESTART_MODES, value.mode) ||
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
    (value.errorCode !== null && !isOneOf(UPDATE_FAILURE_CODES, value.errorCode)) ||
    !isOneOf(REMOTE_UPDATES_STATES, value.remoteUpdates) ||
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
