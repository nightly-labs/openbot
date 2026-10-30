import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteConnectionRecovery,
  type RemoteConnectionFailure,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  type RemoteTeamDirectoryClient,
  remoteConnectionFailureDetails,
} from "@openbot/team-client";
import { REMOTE_PEER_LOST_AFTER_MS, type RemoteTeamConnectionUpdate } from "@openbot/team-client/remote-peer";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MobileConnectionAnalytics } from "@/features/analytics/connection";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { referencedError } from "@/features/workspace/model/referenced-error";
import { RemoteTeamTransport, type RemoteTeamTransportRef } from "./remote-team-transport";

/**
 * How long the first attempt after a return to the app runs without a reconnect status. The app
 * stops its connection work in the background on iOS and Android, so the connection must come back
 * on each return. Most returns are online again in this time, and the app looks as the user left it.
 */
const QUIET_RESUME_MS = 5_000;

/** A failed attempt or a stop ends the quiet return: the user then sees the reconnect status. */
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
}

export interface ServerLoadContext {
  isCurrent(): boolean;
  stage: RemoteConnectionStage;
}

interface Props {
  hostId: string;
  publicKey: string;
  active: boolean;
  directory: RemoteTeamDirectoryClient;
  register(hostId: string, handle: ServerConnectionHandle | null): void;
  load(hostId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext): Promise<void>;
  /** `resuming` is true while a return to the app connects again in its quiet time. */
  onStatus(
    hostId: string,
    status: RemoteRecoveryStatus,
    failure: RemoteConnectionFailure | null,
    resuming: boolean,
  ): void;
  onMembershipChanged?(): Promise<void>;
  onTeamEvent(hostId: string, event: AgentEvent | TeamRealtimeEvent): void;
}

/**
 * Each mounted membership owns its transport; selection does not change its lifetime. Memoized: a
 * render of the transport sends its props to its hidden page, so a workspace render must not reach it.
 */
export const ServerConnection = memo(function ServerConnection({
  hostId,
  publicKey,
  active,
  directory,
  register,
  load,
  onStatus,
  onTeamEvent,
  onMembershipChanged,
}: Props) {
  const [client, setClient] = useState<RemoteTeamTransportRef | null>(null);
  const controller = useRef<ReturnType<typeof createRemoteConnectionRecovery> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const generation = useRef(0);
  const [analytics] = useState(() => new MobileConnectionAnalytics(mobileAnalytics));
  const membershipRefreshPending = useRef(false);
  /** When this connection last became inactive, such as when the app went to the background. */
  const inactiveSince = useRef<number | null>(null);
  const lastStatus = useRef<{ status: RemoteRecoveryStatus; failure: RemoteConnectionFailure | null } | null>(null);
  const resuming = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set when the connection becomes inactive online, or in its quiet return. */
  const resumeOnReturn = useRef(false);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  /** Shows the status that the quiet time held back, such as an attempt that still connects. */
  const endResume = useCallback(() => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = undefined;
    if (!resuming.current) return;
    resuming.current = false;
    const last = lastStatus.current;
    if (last && last.status.phase !== "online") onStatusRef.current(hostId, last.status, last.failure, false);
  }, [hostId]);
  useEffect(() => () => clearTimeout(resumeTimer.current), []);
  const attach = useCallback((value: RemoteTeamTransportRef | null) => setClient(value), []);
  const onMembershipChangedRef = useRef(onMembershipChanged);
  onMembershipChangedRef.current = onMembershipChanged;
  const handleNetworkRestored = useCallback(() => {
    supportLog.add("info", "connection", `${hostId} network restored`);
    controller.current?.networkRestored();
  }, [hostId]);
  const handleConnectionUpdate = useCallback(
    (update: RemoteTeamConnectionUpdate) => {
      if (update.hostId !== hostId) return;
      supportLog.add(
        update.state === "offline" ? "warn" : "info",
        "connection",
        `${hostId} ${update.state}${update.code ? ` (${update.code})` : ""}${update.message ? `: ${update.message}` : ""}${update.resync ? ", resync" : ""}`,
      );
      if (update.state === "offline") {
        if (activeRef.current) analytics.lost();
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
    let context: ServerLoadContext = { stage: "connection", isCurrent: () => false };
    const recovery = createRemoteConnectionRecovery(
      () => {
        const attempt = ++generation.current;
        context = {
          stage: "connection",
          isCurrent: () => !disposed && activeRef.current && attempt === generation.current,
        };
        const finish = analytics.attempt();
        const initiatingContext = context;
        const started = Date.now();
        supportLog.add("info", "connection", `${hostId} attempt ${attempt} started`);
        return load(hostId, publicKey, client, initiatingContext).then(
          () => {
            if (initiatingContext.isCurrent()) finish("succeeded", initiatingContext.stage);
            supportLog.add("info", "connection", `${hostId} attempt ${attempt} loaded (${Date.now() - started} ms)`);
          },
          (error) => {
            if (initiatingContext.isCurrent()) finish("failed", initiatingContext.stage);
            supportLog.add(
              "warn",
              "connection",
              `${hostId} attempt ${attempt} failed at ${initiatingContext.stage} (${Date.now() - started} ms): ${supportLogValue(error)}`,
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
        // The status repeats each second for its countdown. Log only a new phase or attempt.
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
    register(hostId, { client, refresh: () => recovery.refresh() });
    recovery.setActive(activeRef.current);
    return () => {
      disposed = true;
      generation.current += 1;
      recovery.dispose();
      controller.current = null;
      register(hostId, null);
    };
  }, [client, hostId, publicKey, register, load, onStatus, analytics]);

  useEffect(() => {
    const returned = active && inactiveSince.current !== null;
    if (!active) {
      generation.current += 1;
      analytics.background();
      inactiveSince.current ??= Date.now();
      // The workspace keeps the server as the user left it. The next return starts a new quiet time.
      resumeOnReturn.current ||= resuming.current || lastStatus.current?.status.phase === "online";
      clearTimeout(resumeTimer.current);
      resumeTimer.current = undefined;
      resuming.current = false;
    } else if (inactiveSince.current !== null) {
      // Set before the controller starts the attempt, so its first status is already quiet.
      if (resumeOnReturn.current) {
        resumeOnReturn.current = false;
        resuming.current = true;
        resumeTimer.current = setTimeout(endResume, QUIET_RESUME_MS);
        // An attempt that still runs from the last visit sends no new status, so repeat the last one.
        const last = lastStatus.current;
        if (last && last.status.phase !== "online") onStatusRef.current(hostId, last.status, last.failure, true);
      }
      // After this long the peer replaces its connection when it becomes active, so the first attempt
      // shows that it connects instead of an online server whose requests fail. In the quiet time
      // the server still shows online, and its requests wait for the new connection.
      if (Date.now() - inactiveSince.current >= REMOTE_PEER_LOST_AFTER_MS) controller.current?.offline();
      inactiveSince.current = null;
    }
    controller.current?.setActive(active);
    // The user opened the app to use this server. A wait from before, such as the cooldown after five
    // failed attempts, does not continue: one attempt starts now, and a failure starts the backoff again.
    const phase = lastStatus.current?.status.phase;
    if (returned && (phase === "waiting" || phase === "cooldown")) controller.current?.refresh();
    if (active && membershipRefreshPending.current) {
      membershipRefreshPending.current = false;
      void onMembershipChanged?.().catch(() => undefined);
    }
  }, [active, hostId, onMembershipChanged, analytics, endResume]);

  return (
    <RemoteTeamTransport
      ref={attach}
      active={active}
      directory={directory}
      onMembershipChanged={onMembershipChanged}
      onNetworkRestored={handleNetworkRestored}
      onTeamEvent={onTeamEvent}
      onConnectionUpdate={handleConnectionUpdate}
    />
  );
});
