import {
  decodeHostReleaseStatus,
  decodeWorkflowFoldersSnapshot,
  type HostReleaseStatus,
  type WorkflowFoldersSnapshot,
} from "@openbot/contracts/ipc";

import { emptyDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export type ResponseDecoder<T> = (value: unknown) => T;

export const decodeVoid = emptyDecoder("The remote server returned data.");

export const acceptEmpty = (): undefined => undefined;

export const decodeComputerActivityReply = (value: unknown): boolean => isDynamicRecord(value) && value.phones === true;

export function decodeHostReleaseStatusFromHost(value: unknown): HostReleaseStatus {
  return decodeHostReleaseStatus(value);
}

export function decodeWorkflowFoldersSnapshotFromHost(value: unknown): WorkflowFoldersSnapshot {
  return decodeWorkflowFoldersSnapshot(value);
}
