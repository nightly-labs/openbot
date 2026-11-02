import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import {
  type RemoteConnectionFailure,
  type RemoteRecoveryStatus,
  type RemoteTeamHost,
  remoteRecoveryMessage,
} from "@openbot/team-client";
import { serverAccent } from "./server-order";
import type { MobileServer, MobileServerState } from "./workspace-types";

const LABELS = {
  unknown: "mobile.workspace.status.notConnected",
  connecting: "common.connecting",
  online: "mobile.workspace.status.online",
  offline: "mobile.workspace.status.offline",
  error: "mobile.workspace.status.error",
} as const satisfies Record<MobileServerState, MobileTextKey>;

/**
 * What the screens show: online, also while a return to the app connects again quietly. Actions
 * can use it too, because a request then waits for the connection. Code that needs the live
 * connection itself, such as the outbox or the browser view, reads `state`.
 */
export function showsOnline(server: Pick<MobileServer, "state" | "resuming"> | undefined): boolean {
  return server?.state === "online" || server?.resuming === true;
}

export function serverStatusLabel(
  server: Pick<MobileServer, "state" | "initialConnectionPending" | "resuming">,
  t: MobileTranslate,
): string {
  if (showsOnline(server)) return t(LABELS.online);
  if (server.state === "connecting" && !server.initialConnectionPending) return t(LABELS.offline);
  return t(LABELS[server.state]);
}

export function applyServerRecovery(
  server: MobileServer,
  status: RemoteRecoveryStatus,
  failure: string | null,
  details: RemoteConnectionFailure | null = null,
  resuming = false,
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
    connectionFailure: status.phase === "online" ? null : details,
    recoveryStatus: status,
    resuming: resuming && state !== "online",
    initialConnectionPending: server.initialConnectionPending && state === "connecting",
  };
}

/** True when `next` differs from `server` only in the recovery countdown. */
export function sameServerRecovery(server: MobileServer, next: MobileServer): boolean {
  const previous = server.recoveryStatus;
  const status = next.recoveryStatus;
  return (
    previous?.phase === status?.phase &&
    previous?.attempt === status?.attempt &&
    server.state === next.state &&
    server.resuming === next.resuming &&
    server.initialConnectionPending === next.initialConnectionPending &&
    server.connectionFailure?.message === next.connectionFailure?.message &&
    server.connectionFailure?.reference === next.connectionFailure?.reference
  );
}

/** A lost connection reports attempt 0 while its first attempt is due; show that attempt. */
export function recoveryAttempt(status: RemoteRecoveryStatus): number {
  return Math.max(1, status.attempt);
}

/**
 * Seconds for the reconnect countdown, or null to hide it. Connecting shows the wait that follows a
 * failure. A lost connection reports zero before its first attempt starts, with no wait to show.
 */
export function recoveryCountdown(status: RemoteRecoveryStatus): number | null {
  return status.remainingSeconds > 0 ? status.remainingSeconds : null;
}

export function serverKind(hostId: string, pairedHostId: string | undefined): MobileServer["kind"] {
  return hostId === pairedHostId ? "local" : "remote";
}

/** The server of a directory host. A server that is already listed keeps its connection state. */
export function serverFromHost(
  host: RemoteTeamHost,
  kind: MobileServer["kind"],
  previous?: MobileServer,
): MobileServer {
  return {
    id: host.hostId,
    name: host.name,
    logoKey: host.logoKey,
    kind,
    state: previous?.state ?? "unknown",
    initialConnectionPending: previous?.initialConnectionPending ?? true,
    connectionMessage: previous?.connectionMessage ?? null,
    connectionFailure: previous?.connectionFailure,
    recoveryStatus: previous?.recoveryStatus,
    resuming: previous?.resuming,
    address: null,
    accent: serverAccent(host.hostId),
    // The directory gives the key that this app trusts: the pinned key, or the new key of a signed
    // handover. A changed key connects again with it.
    publicKey: host.devicePublicKey,
    membershipId: host.membershipId,
    role: host.role,
    ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
    ...(host.hosted === undefined ? {} : { hosted: host.hosted }),
    ...(host.keyChangedAt === undefined ? {} : { keyChangedAt: host.keyChangedAt }),
  };
}
