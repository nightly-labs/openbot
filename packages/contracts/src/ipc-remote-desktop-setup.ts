import { isDynamicRecord, isOneOf } from "./runtime-values";

export const REMOTE_DESKTOP_SETUP_CAPABILITY = "remote-desktop-setup";
export const REMOTE_DESKTOP_CHECK_STATES = [
  "not-checked",
  "checking",
  "allowed",
  "blocked",
  "unavailable",
  "failed",
] as const;
export type RemoteDesktopCheckState = (typeof REMOTE_DESKTOP_CHECK_STATES)[number];

export interface RemoteDesktopSetupStatus {
  platform: "darwin" | "win32" | "linux";
  hostName: string;
  username: string;
  checkedAt: string | null;
  screenRecording: RemoteDesktopCheckState;
  accessibility: RemoteDesktopCheckState;
  service: RemoteDesktopCheckState;
  displays: RemoteDesktopCheckState;
  guiSession: RemoteDesktopCheckState;
  restartRequired: boolean;
  activeSessions: number;
  message: string | null;
}

export interface RemoteDesktopTestStatus {
  active: boolean;
  mouse: boolean;
  keyboard: boolean;
  code: string;
}

export interface RemoteDesktopTestInput {
  serverId: string;
  sessionId: string;
  action: "start" | "status" | "stop";
}

export type RemoteDesktopSetupAction = "screen-recording" | "accessibility" | "reveal";

export function isRemoteDesktopSetupStatus(value: unknown): value is RemoteDesktopSetupStatus {
  return (
    isDynamicRecord(value) &&
    isOneOf(["darwin", "win32", "linux"] as const, value.platform) &&
    typeof value.hostName === "string" &&
    value.hostName.length <= 255 &&
    typeof value.username === "string" &&
    value.username.length <= 255 &&
    (value.checkedAt === null ||
      (typeof value.checkedAt === "string" &&
        value.checkedAt.length <= 40 &&
        Number.isFinite(Date.parse(value.checkedAt)))) &&
    [value.screenRecording, value.accessibility, value.service, value.displays, value.guiSession].every((state) =>
      isOneOf(REMOTE_DESKTOP_CHECK_STATES, state),
    ) &&
    typeof value.restartRequired === "boolean" &&
    typeof value.activeSessions === "number" &&
    Number.isSafeInteger(value.activeSessions) &&
    value.activeSessions >= 0 &&
    (value.message === null || (typeof value.message === "string" && value.message.length <= 1000))
  );
}

export function isRemoteDesktopTestStatus(value: unknown): value is RemoteDesktopTestStatus {
  return (
    isDynamicRecord(value) &&
    typeof value.active === "boolean" &&
    typeof value.mouse === "boolean" &&
    typeof value.keyboard === "boolean" &&
    typeof value.code === "string" &&
    /^(?:[0-9]{4})?$/u.test(value.code)
  );
}
