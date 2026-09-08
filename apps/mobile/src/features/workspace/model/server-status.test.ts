import { createRemoteConnectionRecovery, REMOTE_RETRY_INTERVAL_MS } from "@openbot/team-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyServerFailure, applyServerRecovery, serverKind, serverStatusLabel } from "./server-status";
import type { MobileServer } from "./workspace-types";

const server: MobileServer = {
  id: "desktop",
  name: "My desktop",
  kind: "local",
  state: "online",
  initialConnectionPending: false,
  connectionMessage: null,
  address: null,
  accent: "",
  publicKey: "key",
  membershipId: "member",
  role: "owner",
};

afterEach(() => vi.useRealTimers());

describe("mobile server availability", () => {
  it("keeps the protocol error visible when suspending RTC rejects an in-flight workspace load", async () => {
    let current: MobileServer = { ...server, state: "unknown" };
    let connection = Promise.withResolvers<void>();
    const onError = vi.fn(() => {
      current = applyServerFailure(current, "The desktop request failed.");
    });
    const controller = createRemoteConnectionRecovery(
      () => connection.promise,
      onError,
      (status) => {
        current = applyServerRecovery(current, status, "Signal returned an invalid message.");
      },
    );
    try {
      controller.setActive(true);
      controller.suspend(new Error("Signal returned an invalid message."));
      const protocolMessage = current.connectionMessage;
      connection.reject(new Error("The server disconnected."));
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
      expect(serverStatusLabel(current)).toBe("Connection error");
      expect(current.connectionMessage).toBe(protocolMessage);

      connection = Promise.withResolvers<void>();
      controller.refresh();
      expect(serverStatusLabel(current)).toBe("Offline");
      connection.resolve();
      await vi.waitFor(() => expect(serverStatusLabel(current)).toBe("Online"));
      expect(current.connectionMessage).toBeNull();
    } finally {
      controller.dispose();
    }
  });

  it("shows retry, protocol error, and recovery states from the live connection controller", async () => {
    vi.useFakeTimers();
    let current: MobileServer = { ...server, state: "unknown", initialConnectionPending: true };
    let connection = Promise.withResolvers<void>();
    const controller = createRemoteConnectionRecovery(
      () => connection.promise,
      () => {},
      (status) => {
        current = applyServerRecovery(current, status, null);
      },
    );
    controller.setActive(true);
    expect(serverStatusLabel(current)).toBe("Connecting…");
    connection.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.state).toBe("online");
    connection = Promise.withResolvers<void>();
    controller.offline();
    expect(current.state).toBe("offline");
    await vi.advanceTimersByTimeAsync(REMOTE_RETRY_INTERVAL_MS);
    expect(current.state).toBe("connecting");
    expect(serverStatusLabel(current)).toBe("Offline");
    connection.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(serverStatusLabel(current)).toBe("Online");
    controller.suspend();
    expect(current.state).toBe("error");
    controller.refresh();
    expect(serverStatusLabel(current)).toBe("Offline");
    await vi.advanceTimersByTimeAsync(0);
    expect(current.state).toBe("online");
    controller.dispose();
  });
});

it("labels only the paired desktop as local", () => {
  expect([
    serverKind("paired", "paired"),
    serverKind("another-owned-host", "paired"),
    serverKind("host", undefined),
  ]).toEqual(["local", "remote", "remote"]);
});
