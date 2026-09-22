import {
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
} from "@openbot/contracts/ipc";

export function decodeRemoteDesktopSetupFromHost(value: unknown): RemoteDesktopSetupStatus {
  if (!isRemoteDesktopSetupStatus(value)) throw new Error("Invalid remote desktop setup response.");
  return { ...value };
}

export function decodeRemoteDesktopTestFromHost(value: unknown): RemoteDesktopTestStatus {
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}
