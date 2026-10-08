import type { ServerSummary } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { remoteUpdateServer } from "./server-capabilities";

const server: ServerSummary = {
  id: "host",
  name: "Host",
  kind: "remote",
  state: "online",
  role: "member",
  active: true,
  apiUrl: null,
  remoteDesktopAvailable: false,
  logoUrl: null,
  notificationsMuted: false,
  notificationsMutedUntil: null,
  notificationLevel: "all",
};

function host(role: ServerSummary["role"], capabilities: string[]): ServerSummary {
  return {
    ...server,
    role,
    compatibility: {
      localAppVersion: "1.0.0",
      hostAppVersion: "1.0.0",
      localProtocol: { minimum: 1, maximum: 6 },
      hostProtocol: { minimum: 1, maximum: 6 },
      negotiatedProtocol: 6,
      capabilities,
    },
  };
}

describe("remote update access", () => {
  it("requires explicit member support and preserves older administrator access", () => {
    expect(remoteUpdateServer(server)).toBeUndefined();
    expect(remoteUpdateServer(host("member", ["host-update-v1"]))).toBeUndefined();
    expect(remoteUpdateServer(host("member", ["host-member-update-v1"]))?.id).toBe("host");
    expect(remoteUpdateServer(host("admin", ["host-update-v1"]))?.id).toBe("host");
    expect(remoteUpdateServer(host("owner", ["host-update-v1"]))?.id).toBe("host");
    expect(remoteUpdateServer(host("admin", []))).toBeUndefined();
  });
});
