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

export function recoveryAttempt(status: RemoteRecoveryStatus): number {
  return Math.max(1, status.attempt);
}

export function recoveryCountdown(status: RemoteRecoveryStatus): number | null {
  const waitingForRetry = status.phase === "waiting" || status.phase === "cooldown";
  return waitingForRetry && status.remainingSeconds > 0 ? status.remainingSeconds : null;
}

export function serverKind(hostId: string, pairedHostId: string | undefined): MobileServer["kind"] {
  return hostId === pairedHostId ? "local" : "remote";
}

export function serverFromHost(
  host: RemoteTeamHost,
  kind: MobileServer["kind"],
  previous?: MobileServer,
): MobileServer {
  return {
    id: host.hostId,
    name: host.name,
    logoKey: host.logoKey,
    ...(previous?.appearance !== undefined && (host.appearance === undefined || previous.state === "online")
      ? { appearance: previous.appearance }
      : host.appearance === undefined
        ? {}
        : { appearance: host.appearance }),
    kind,
    state: previous?.state ?? "unknown",
    initialConnectionPending: previous?.initialConnectionPending ?? true,
    connectionMessage: previous?.connectionMessage ?? null,
    connectionFailure: previous?.connectionFailure,
    recoveryStatus: previous?.recoveryStatus,
    resuming: previous?.resuming,
    address: null,
    accent: serverAccent(host.hostId),
    publicKey: host.devicePublicKey,
    membershipId: host.membershipId,
    role: host.role,
    ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
    ...(host.hosted === undefined ? {} : { hosted: host.hosted }),
    ...(host.hidden ? { hidden: host.hidden } : {}),
    ...(host.storageGb === undefined ? {} : { storageGb: host.storageGb }),
    ...(host.restartAvailable === undefined ? {} : { restartAvailable: host.restartAvailable }),
    ...(host.keyChangedAt === undefined ? {} : { keyChangedAt: host.keyChangedAt }),
  };
}

export function hostWithHidden(host: RemoteTeamHost, hidden: boolean): RemoteTeamHost {
  const { hidden: _hidden, ...shown } = host;
  return hidden ? { ...shown, hidden: true } : shown;
}

export function serverWithHidden(server: MobileServer, hidden: boolean): MobileServer {
  const { hidden: _hidden, ...shown } = server;
  return hidden ? { ...shown, hidden: true } : shown;
}
