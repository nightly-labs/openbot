// Frozen payloads for the remote-desktop-setup capability. Keep these fields and
// bounds independent of the current IPC model.
import { isDynamicRecord, isOneOf } from "../runtime-values";
import type { TeamProtocolV4BaseJsonObject } from "./v4-base";

export function isRemoteDesktopSetupRoute(method: string, path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return (
    (method === "POST" && pathname === "/v1/remote-screen/setup") ||
    (method === "POST" && pathname === "/v1/remote-screen/test")
  );
}

export function decodeRemoteDesktopSetupRequest(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote desktop setup request.");
  if (new URL(path, "http://openbot.invalid").pathname.endsWith("/setup")) {
    if (Object.keys(value).length !== 0) throw new Error("Invalid remote desktop setup request.");
    return {};
  }
  if (
    Object.keys(value).length !== 2 ||
    typeof value.sessionId !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/u.test(value.sessionId) ||
    !isOneOf(["start", "status", "stop"] as const, value.action)
  ) {
    throw new Error("Invalid remote desktop test request.");
  }
  return { sessionId: value.sessionId, action: value.action };
}

function checkState(value: unknown) {
  return isOneOf(["not-checked", "checking", "allowed", "blocked", "unavailable", "failed"] as const, value);
}

export function decodeRemoteDesktopSetupResponse(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  if (new URL(path, "http://openbot.invalid").pathname.endsWith("/setup")) {
    if (
      !isDynamicRecord(value) ||
      !isOneOf(["darwin", "win32", "linux"] as const, value.platform) ||
      typeof value.hostName !== "string" ||
      value.hostName.length > 255 ||
      typeof value.username !== "string" ||
      value.username.length > 255 ||
      !(
        value.checkedAt === null ||
        (typeof value.checkedAt === "string" &&
          value.checkedAt.length <= 40 &&
          Number.isFinite(Date.parse(value.checkedAt)))
      ) ||
      !checkState(value.screenRecording) ||
      !checkState(value.accessibility) ||
      !checkState(value.service) ||
      !checkState(value.displays) ||
      !checkState(value.guiSession) ||
      typeof value.restartRequired !== "boolean" ||
      typeof value.activeSessions !== "number" ||
      !Number.isSafeInteger(value.activeSessions) ||
      value.activeSessions < 0 ||
      !(value.message === null || (typeof value.message === "string" && value.message.length <= 1000))
    )
      throw new Error("Invalid remote desktop setup response.");
    return {
      platform: value.platform,
      hostName: value.hostName,
      username: value.username,
      checkedAt: value.checkedAt,
      screenRecording: value.screenRecording,
      accessibility: value.accessibility,
      service: value.service,
      displays: value.displays,
      guiSession: value.guiSession,
      restartRequired: value.restartRequired,
      activeSessions: value.activeSessions,
      message: value.message,
    };
  }
  if (
    !isDynamicRecord(value) ||
    typeof value.active !== "boolean" ||
    typeof value.mouse !== "boolean" ||
    typeof value.keyboard !== "boolean" ||
    typeof value.code !== "string" ||
    !/^(?:[0-9]{4})?$/u.test(value.code)
  )
    throw new Error("Invalid remote desktop test response.");
  return { active: value.active, mouse: value.mouse, keyboard: value.keyboard, code: value.code };
}
