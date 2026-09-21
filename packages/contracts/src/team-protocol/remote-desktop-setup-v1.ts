import { isRemoteDesktopSetupStatus, isRemoteDesktopTestStatus } from "../ipc-remote-desktop-setup";
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

export function decodeRemoteDesktopSetupResponse(path: string, value: unknown): TeamProtocolV4BaseJsonObject {
  if (new URL(path, "http://openbot.invalid").pathname.endsWith("/setup")) {
    if (!isRemoteDesktopSetupStatus(value)) throw new Error("Invalid remote desktop setup response.");
    return { ...value };
  }
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}
