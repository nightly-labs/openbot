import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import {
  createRemoteConnectionRecovery,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  type RemoteTeamDirectoryClient,
  remoteConnectionFailure,
} from "@openbot/team-client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  onStatus(hostId: string, status: RemoteRecoveryStatus, failure: string | null): void;
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
  const membershipRefreshPending = useRef(false);
  const attach = useCallback((value: RemoteTeamTransportRef | null) => setClient(value), []);

  useEffect(() => {
    if (!client) return;
    let disposed = false;
    let failure: string | null = null;
    let context: ServerLoadContext = { stage: "connection", isCurrent: () => false };
    const recovery = createRemoteConnectionRecovery(
      () => {
        const attempt = ++generation.current;
        context = {
          stage: "connection",
          isCurrent: () => !disposed && activeRef.current && attempt === generation.current,
        };
        return load(hostId, publicKey, client, context);
      },
      (error) => {
        failure = remoteConnectionFailure(context.stage, error);
      },
      (status) => {
        if (disposed) return;
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
  }, [client, hostId, publicKey, register, load, onStatus]);

  useEffect(() => {
    if (!active) generation.current += 1;
    controller.current?.setActive(active);
    if (active && membershipRefreshPending.current) {
      membershipRefreshPending.current = false;
      void onMembershipChanged?.().catch(() => undefined);
    }
  }, [active, onMembershipChanged]);

  return (
    <RemoteTeamTransport
      ref={attach}
      active={active}
      directory={directory}
      onTeamEvent={onTeamEvent}
      onConnectionUpdate={(update) => {
        if (update.hostId !== hostId) return;
        if (update.state === "offline") {
          if (update.code === "session_revoked") {
            if (activeRef.current) void onMembershipChanged?.().catch(() => undefined);
            else membershipRefreshPending.current = true;
          }
          const error = new Error(update.message ?? "The desktop went offline.");
          if (update.code === "protocol_error") controller.current?.suspend(error);
          else controller.current?.offline(error);
        }
        if (update.resync) controller.current?.refresh();
      }}
    />
  );
}
