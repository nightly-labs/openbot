import { type RemoteRecoveryStatus, remoteRecoveryMessage } from "@openbot/team-client";
import type { MobileServer, MobileServerState } from "./workspace-types";

const LABELS: Record<MobileServerState, string> = {
  unknown: "Not connected",
  connecting: "Connecting…",
  online: "Online",
  offline: "Offline",
  error: "Connection error",
};

export function serverStatusLabel(server: Pick<MobileServer, "state" | "initialConnectionPending">): string {
  if (server.state === "connecting" && !server.initialConnectionPending) return LABELS.offline;
  return LABELS[server.state];
}

export function applyServerFailure(server: MobileServer, connectionMessage: string | null): MobileServer {
  // Suspending RTC also rejects in-flight loads; their failure must not replace the protocol error.
  if (server.recoveryStatus?.phase === "suspended") return server;
  return { ...server, state: "offline", initialConnectionPending: false, connectionMessage };
}

export function applyServerRecovery(
  server: MobileServer,
  status: RemoteRecoveryStatus,
  failure: string | null,
): MobileServer {
  const state: MobileServerState =
    status.phase === "online"
      ? "online"
      : status.phase === "connecting"
        ? "connecting"
        : status.phase === "suspended"
          ? "error"
          : "offline";
  return {
    ...server,
    state,
    connectionMessage: remoteRecoveryMessage(status, failure),
    recoveryStatus: status,
    initialConnectionPending: server.initialConnectionPending && state === "connecting",
  };
}

/** A directory entry is membership, not proof of a usable connection. */
export function resetServerStatus(server: MobileServer): MobileServer {
  return {
    ...server,
    state: "unknown",
    connectionMessage: null,
    recoveryStatus: undefined,
  };
}

export function serverKind(hostId: string, pairedHostId: string | undefined): MobileServer["kind"] {
  return hostId === pairedHostId ? "local" : "remote";
}
