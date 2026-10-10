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
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileConnectionAnalytics } from "@/features/analytics/connection";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { referencedError } from "@/features/workspace/model/referenced-error";
import { RemoteTeamTransport, type RemoteTeamTransportRef } from "./remote-team-transport";

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
  onStatus(hostId: string, status: RemoteRecoveryStatus, failure: RemoteConnectionFailure | null): void;
  onMembershipChanged?(): Promise<void>;
  onTeamEvent(hostId: string, event: AgentEvent | TeamRealtimeEvent): void;
}

/** Each mounted membership owns its transport; selection does not change its lifetime. */
export function ServerConnection({
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
  const attach = useCallback((value: RemoteTeamTransportRef | null) => setClient(value), []);

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
        onStatus(hostId, status, failure);
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
    if (!active) {
      generation.current += 1;
      analytics.background();
    }
    controller.current?.setActive(active);
    if (active && membershipRefreshPending.current) {
      membershipRefreshPending.current = false;
      void onMembershipChanged?.().catch(() => undefined);
    }
  }, [active, onMembershipChanged, analytics]);

  return (
    <RemoteTeamTransport
      ref={attach}
      active={active}
      directory={directory}
      onMembershipChanged={onMembershipChanged}
      onNetworkRestored={() => {
        supportLog.add("info", "connection", `${hostId} network restored`);
        controller.current?.networkRestored();
      }}
      onTeamEvent={onTeamEvent}
      onConnectionUpdate={(update) => {
        if (update.hostId !== hostId) return;
        supportLog.add(
          update.state === "offline" ? "warn" : "info",
          "connection",
          `${hostId} ${update.state}${update.code ? ` (${update.code})` : ""}${update.message ? `: ${update.message}` : ""}${update.resync ? ", resync" : ""}`,
        );
        if (update.state === "offline") {
          if (activeRef.current) analytics.lost();
          if (update.code === "session_revoked") {
            if (activeRef.current) void onMembershipChanged?.().catch(() => undefined);
            else membershipRefreshPending.current = true;
          }
          const error = referencedError(update.message ?? sourceText("error.remote.desktopOffline"), update.reference);
          if (update.code === "protocol_error") controller.current?.suspend(error);
          else controller.current?.offline(error);
        }
        if (update.resync) controller.current?.refresh();
      }}
    />
  );
}
