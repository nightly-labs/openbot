import type { RemoteDesktopSession } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteDesktopManager } from "./remote-desktop-manager";
import { RemoteProtocolError, RemoteRequestError } from "./remote-server-errors";
import { remoteCall } from "./remote-service-effects";

const session: RemoteDesktopSession = {
  id: "desktop-1",
  serverId: "remote-1",
  viewerUrl: "https://studio.example.com/v1/remote-screen/sessions/desktop-1/viewer",
  viewerGrant: "viewer-grant",
  displays: [],
  selectedDisplayId: null,
  phase: "connecting",
  transport: "unknown",
  errorCode: null,
  message: "Connecting…",
  createdAt: "2026-08-21T12:00:00.000Z",
  grantExpiresAt: "2026-08-21T12:01:00.000Z",
};

function createManager(createRemoteDesktopSession: () => Promise<RemoteDesktopSession>) {
  return new RemoteDesktopManager({
    createRemoteDesktopSession: () => remoteCall(createRemoteDesktopSession),
    closeRemoteDesktopSession: vi.fn(() => Effect.void),
    selectRemoteDesktopDisplay: vi.fn(() => Effect.void),
  });
}

describe("RemoteDesktopManager.connect", () => {
  it("hands the renderer the host's own reason, because an IPC rejection carries no code", async () => {
    const manager = createManager(async () => {
      throw new RemoteRequestError(
        503,
        "The host has not allowed OpenBot to record its screen.",
        "host_permissions_required",
      );
    });

    await expect(runCauseEffect(manager.connect({ serverId: "remote-1" }))).resolves.toEqual({
      status: "refused",
      errorCode: "host_permissions_required",
      message: "The host has not allowed OpenBot to record its screen.",
    });
    expect(manager.list()).toEqual([]);
  });

  it("keeps a broken call a rejection, so a refusal stays the only named answer", async () => {
    const manager = createManager(async () => {
      throw new RemoteProtocolError("host_update_required", "Update OpenBot on the host.");
    });

    await expect(runCauseEffect(manager.connect({ serverId: "remote-1" }))).rejects.toThrow(
      "Update OpenBot on the host.",
    );
  });

  it("answers a session the host opened", async () => {
    const manager = createManager(async () => structuredClone(session));

    await expect(runCauseEffect(manager.connect({ serverId: "remote-1" }))).resolves.toEqual({
      status: "connected",
      session,
    });
    expect(manager.list()).toEqual([session]);
  });
});
