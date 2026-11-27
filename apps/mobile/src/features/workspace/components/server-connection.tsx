import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteConnectionRecovery,
  type RemoteConnectionFailure,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  type RemoteTeamDirectoryClient,
  remoteConnectionFailureDetails,
} from "@openbot/team-client";
import {
  REMOTE_PEER_LOST_AFTER_MS,
  type RemoteTeamConnectionUpdate,
  type RemoteTeamDiagnostic,
  type RemoteTeamEvent,
} from "@openbot/team-client/remote-peer";
import { errorReference } from "@openbot/user-errors/reference";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MobileConnectionAnalytics } from "@/features/analytics/connection";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { phoneVpn } from "@/features/support/model/phone-network-capture";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { referencedError } from "@/features/workspace/model/referenced-error";
import { type NetworkChange, strongerChange } from "@/shared/lib/network-change";
import { subscribeNetworkMoves } from "@/shared/lib/network-path";
import { RemoteTeamTransport, type RemoteTeamTransportRef } from "./remote-team-transport";

const QUIET_RESUME_MS = 5_000;

function endsQuietResume(status: RemoteRecoveryStatus): boolean {
  return (
    status.phase === "online" ||
    status.phase === "suspended" ||
    status.phase === "cooldown" ||
    (status.phase === "waiting" && status.attempt > 0)
  );
}

export interface ServerConnectionHandle {
  client: RemoteTeamTransportRef;
  refresh(): void;
  reconnect(): void;
  quietStart(): void;
}

export interface ServerLoadContext {
  isCurrent(): boolean;
  stage: RemoteConnectionStage;
  check: boolean;
}

interface Props {
  hostId: string;
  publicKey: string;
  active: boolean;
  background: boolean;
  directory: RemoteTeamDirectoryClient;
  register(hostId: string, handle: ServerConnectionHandle | null): void;
  load(hostId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext): Promise<void>;
  onStatus(
    hostId: string,
    status: RemoteRecoveryStatus,
    failure: RemoteConnectionFailure | null,
    resuming: boolean,
  ): void;
  onMembershipChanged?(): Promise<void>;
  onTeamEvent(hostId: string, event: RemoteTeamEvent): void;
  onUnavailable?(hostId: string): void;
}

export const ServerConnection = memo(function ServerConnection({
  hostId,
  publicKey,
  active,
  background,
  directory,
  register,
  load,
  onStatus,
  onTeamEvent,
  onMembershipChanged,
  onUnavailable,
}: Props) {
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const [client, setClient] = useState<RemoteTeamTransportRef | null>(null);
  const controller = useRef<ReturnType<typeof createRemoteConnectionRecovery> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const generation = useRef(0);
  const [analytics] = useState(() => new MobileConnectionAnalytics(mobileAnalytics, phoneVpn));
  const membershipRefreshPending = useRef(false);
  const inactiveSince = useRef<number | null>(null);
  const lastStatus = useRef<{ status: RemoteRecoveryStatus; failure: RemoteConnectionFailure | null } | null>(null);
  const resuming = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resumeOnReturn = useRef(false);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const endResume = useCallback(() => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = undefined;
    if (!resuming.current) return;
    resuming.current = false;
    const last = lastStatus.current;
    if (last && last.status.phase !== "online") onStatusRef.current(hostId, last.status, last.failure, false);
  }, [hostId]);
  useEffect(() => () => clearTimeout(resumeTimer.current), []);
  const quietStartUsed = useRef(false);
  const quietStart = useCallback(() => {
    const last = lastStatus.current;
    if (quietStartUsed.current || !activeRef.current || resuming.current || inactiveSince.current !== null) return;
    quietStartUsed.current = true;
    if (last && (last.status.phase !== "connecting" || last.status.attempt > 1)) return;
    resuming.current = true;
    resumeTimer.current = setTimeout(endResume, QUIET_RESUME_MS);
    if (last) onStatusRef.current(hostId, last.status, last.failure, true);
  }, [hostId, endResume]);
  const attach = useCallback((value: RemoteTeamTransportRef | null) => setClient(value), []);
  const onMembershipChangedRef = useRef(onMembershipChanged);
  onMembershipChangedRef.current = onMembershipChanged;
  const handleNetworkRestored = useCallback(() => {
    supportLog.add("info", "connection", `${hostId} network restored`);
    controller.current?.networkRestored();
  }, [hostId]);
  const networkMoved = useRef<NetworkChange | null>(null);
  const clientRef = useRef(client);
  clientRef.current = client;
  useEffect(() => {
    if (!client) return;
    return subscribeNetworkMoves((change) => {
      supportLog.add("info", "connection", `${hostId} network ${change}${activeRef.current ? "" : " while inactive"}`);
      if (activeRef.current) client.networkChanged(change);
      else networkMoved.current = strongerChange(networkMoved.current, change);
    });
  }, [client, hostId]);
  const handleDiagnostic = useCallback(
    (step: RemoteTeamDiagnostic["step"], detail: string | undefined) => analytics.diagnostic(step, detail),
    [analytics],
  );
  const lostAfterMs = useRef(REMOTE_PEER_LOST_AFTER_MS);
  const handleConnectionUpdate = useCallback(
    (update: RemoteTeamConnectionUpdate) => {
      if (update.hostId !== hostId) return;
      supportLog.add(
        update.state === "offline" ? "warn" : "info",
        "connection",
        `${hostId} ${update.state}${update.code ? ` (${update.code})` : ""}${update.message ? `: ${update.message}` : ""}${update.reference ? ` [${update.reference}]` : ""}${update.hostOffline ? ", host not on Signal" : ""}${update.resync ? ", resync" : ""}`,
      );
      if (update.hostOffline && activeRef.current) onUnavailableRef.current?.(hostId);
      if (update.state === "online" && update.lostAfterMs !== undefined) lostAfterMs.current = update.lostAfterMs;
      if (update.state === "offline") {
        if (activeRef.current && !backgroundRef.current) analytics.lost();
        if (update.code === "session_revoked") {
          if (activeRef.current) void onMembershipChangedRef.current?.().catch(() => undefined);
          else membershipRefreshPending.current = true;
        }
        const error = referencedError(update.message ?? sourceText("error.remote.desktopOffline"), update.reference);
        if (update.code === "protocol_error") controller.current?.suspend(error);
        else controller.current?.offline(error);
      }
      if (update.resync) controller.current?.refresh();
    },
    [hostId, analytics],
  );

  useEffect(() => {
    if (!client) return;
    let disposed = false;
    let failure: RemoteConnectionFailure | null = null;
    let loggedStatus = "";
    let context: ServerLoadContext = { stage: "connection", isCurrent: () => false, check: false };
    const recovery = createRemoteConnectionRecovery(
      (check) => {
        const attempt = ++generation.current;
        context = {
          stage: "connection",
          isCurrent: () => !disposed && activeRef.current && attempt === generation.current,
          check,
        };
        const finish = backgroundRef.current ? null : analytics.attempt();
        const initiatingContext = context;
        const started = Date.now();
        supportLog.add("info", "connection", `${hostId} attempt ${attempt} started${check ? ", check" : ""}`);
        return load(hostId, publicKey, client, initiatingContext).then(
          () => {
            if (initiatingContext.isCurrent()) finish?.("succeeded", initiatingContext.stage);
            supportLog.add("info", "connection", `${hostId} attempt ${attempt} loaded (${Date.now() - started} ms)`);
          },
          (error) => {
            if (initiatingContext.isCurrent()) {
              finish?.("failed", initiatingContext.stage);
              onUnavailableRef.current?.(hostId);
            }
            const reference = errorReference(error);
            supportLog.add(
              "warn",
              "connection",
              `${hostId} attempt ${attempt} failed at ${initiatingContext.stage} (${Date.now() - started} ms): ${supportLogValue(error)}${reference ? ` [${reference}]` : ""}`,
            );
            throw error;
          },
        );
      },
      (error) => {
        failure = remoteConnectionFailureDetails(context.stage, error);
      },
      (status) => {
        if (disposed) return;
        const logged = `${status.phase}:${status.attempt}`;
        if (logged !== loggedStatus) {
          loggedStatus = logged;
          supportLog.add(
            "info",
            "connection",
            `${hostId} recovery ${status.phase}, attempt ${status.attempt}${status.phase !== "connecting" && status.remainingSeconds ? `, retry in ${status.remainingSeconds} s` : ""}`,
          );
        }
        if (status.phase === "online") failure = null;
        if (resuming.current && endsQuietResume(status)) {
          clearTimeout(resumeTimer.current);
          resumeTimer.current = undefined;
          resuming.current = false;
        }
        lastStatus.current = { status, failure };
        onStatus(hostId, status, failure, resuming.current);
      },
    );
    controller.current = recovery;
    register(hostId, {
      client,
      refresh: () => recovery.refresh(),
      reconnect: () => {
        if (activeRef.current && lastStatus.current && lastStatus.current.status.phase !== "online") client.newPage();
        recovery.refresh();
      },
      quietStart,
    });
    recovery.setActive(activeRef.current);
    return () => {
      disposed = true;
      generation.current += 1;
      recovery.dispose();
      controller.current = null;
      register(hostId, null);
    };
  }, [client, hostId, publicKey, register, load, onStatus, analytics, quietStart]);

  useEffect(() => {
    const returned = active && inactiveSince.current !== null;
    if (!active) {
      generation.current += 1;
      analytics.background();
      inactiveSince.current ??= Date.now();
      resumeOnReturn.current ||= resuming.current || lastStatus.current?.status.phase === "online";
      clearTimeout(resumeTimer.current);
      resumeTimer.current = undefined;
      resuming.current = false;
    } else if (inactiveSince.current !== null) {
      if (resumeOnReturn.current) {
        resumeOnReturn.current = false;
        resuming.current = true;
        resumeTimer.current = setTimeout(endResume, QUIET_RESUME_MS);
        const last = lastStatus.current;
        if (last && last.status.phase !== "online") onStatusRef.current(hostId, last.status, last.failure, true);
      }
      if (Date.now() - inactiveSince.current >= lostAfterMs.current) controller.current?.offline();
      inactiveSince.current = null;
    }
    controller.current?.setActive(active);
    const moved = networkMoved.current;
    if (active && moved) {
      networkMoved.current = null;
      clientRef.current?.networkChanged(moved);
    }
    const phase = lastStatus.current?.status.phase;
    if (returned && (phase === "waiting" || phase === "cooldown")) controller.current?.refresh();
    if (active && membershipRefreshPending.current) {
      membershipRefreshPending.current = false;
      void onMembershipChanged?.().catch(() => undefined);
    }
  }, [active, hostId, onMembershipChanged, analytics, endResume]);

  const wasBackground = useRef(background);
  useEffect(() => {
    const opened = wasBackground.current && !background;
    wasBackground.current = background;
    if (opened) controller.current?.resetBackoff();
  }, [background]);

  return (
    <RemoteTeamTransport
      ref={attach}
      hostId={hostId}
      active={active}
      directory={directory}
      onMembershipChanged={onMembershipChanged}
      onNetworkRestored={handleNetworkRestored}
      onTeamEvent={onTeamEvent}
      onConnectionUpdate={handleConnectionUpdate}
      onDiagnostic={handleDiagnostic}
    />
  );
});
