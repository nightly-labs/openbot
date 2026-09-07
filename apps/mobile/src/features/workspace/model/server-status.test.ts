import { createRemoteConnectionRecovery, REMOTE_RETRY_INTERVAL_MS } from "@openbot/team-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyServerRecovery, resetServerStatus, serverStatusLabel } from "./server-status";
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
};

afterEach(() => vi.useRealTimers());

describe("mobile server availability", () => {
  it("shows retry, protocol error, and recovery states from the live connection controller", async () => {
    vi.useFakeTimers();
    let current = { ...resetServerStatus(server), initialConnectionPending: true };
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
  it("stops claiming a server is online when its connection is no longer observed", () => {
    const reset = resetServerStatus({
      ...server,
      recoveryStatus: { phase: "online", attempt: 0, remainingSeconds: 0 },
    });
    expect(serverStatusLabel(reset)).toBe("Unknown");
    expect(reset.recoveryStatus).toBeUndefined();
    expect(reset.initialConnectionPending).toBe(false);
    expect(reset.publicKey).toBe(server.publicKey);
    expect(serverStatusLabel({ ...server, state: "error" })).toBe("Connection error");
  });
});
