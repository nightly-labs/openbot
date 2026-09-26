import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { isQueueEditRoute, QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteTeamDirectoryClient } from "@openbot/team-client";
import {
  createRemoteCommandMailbox,
  type RemoteFileUpload,
  type RemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamConnectionUpdate,
  type RemoteUploadProgress,
} from "@openbot/team-client/remote-peer";
import * as Crypto from "expo-crypto";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { currentText } from "@/shared/lib/text";

import RemoteTeamBridge from "./remote-team-bridge.dom";

export interface RemoteTeamTransportRef {
  connect(hostId: string, hostPublicKey: string): Promise<void>;
  disconnect(): Promise<void>;
  request<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    /** Hears the fraction of the uploaded file sent so far, from 0 to 1. */
    onUploadProgress?: (fraction: number) => void,
  ): Promise<T>;
}

interface RemoteTeamTransportProps {
  active: boolean;
  directory: RemoteTeamDirectoryClient;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => void;
  /** Signal says this account's server list changed on another device. */
  onMembershipChanged?: () => Promise<void>;
  onTeamEvent: (hostId: string, event: AgentEvent | TeamRealtimeEvent) => void;
}

type RemoteTeamCommandInput =
  | { type: "connect"; hostId: string; hostPublicKey: string }
  | { type: "disconnect" }
  | { type: "request"; method: string; path: string; body: TeamProtocolV2Json; upload?: RemoteFileUpload };

export const RemoteTeamTransport = forwardRef<RemoteTeamTransportRef, RemoteTeamTransportProps>(
  function RemoteTeamTransport(
    { active: foreground, directory, onConnectionUpdate, onMembershipChanged, onTeamEvent },
    ref,
  ) {
    const { refreshProfile } = useMobileSession();
    const [commands, setCommands] = useState<RemoteTeamCommand[]>([]);
    const mailboxRef = useRef<ReturnType<typeof createRemoteCommandMailbox> | null>(null);
    if (!mailboxRef.current) mailboxRef.current = createRemoteCommandMailbox(setCommands);
    const mailbox = mailboxRef.current;
    useEffect(() => () => mailbox.dispose(), [mailbox]);

    // Upload progress arrives from the web view by command ID, while the command is still pending.
    const uploadListeners = useRef(new Map<string, (fraction: number) => void>());
    const enqueue = useCallback(
      (
        next: RemoteTeamCommandInput,
        onUploadProgress?: (fraction: number) => void,
      ): Promise<RemoteTeamCommandResult> => {
        const id = Crypto.randomUUID();
        const command: RemoteTeamCommand =
          next.type === "connect"
            ? { id, type: "connect", hostId: next.hostId, hostPublicKey: next.hostPublicKey }
            : next.type === "request"
              ? { id, type: "request", method: next.method, path: next.path, body: next.body, upload: next.upload }
              : { id, type: "disconnect" };
        if (!onUploadProgress) return mailbox.send(command);
        uploadListeners.current.set(id, onUploadProgress);
        return mailbox.send(command).finally(() => uploadListeners.current.delete(id));
      },
      [mailbox],
    );

    useImperativeHandle(
      ref,
      () => ({
        connect: async (hostId, hostPublicKey) => {
          const result = await enqueue({ type: "connect", hostId, hostPublicKey });
          if (!result.ok) throw new Error(result.error ?? currentText().t("mobile.workspace.error.connectFailed"));
        },
        disconnect: async () => {
          const result = await enqueue({ type: "disconnect" });
          if (!result.ok) throw new Error(result.error ?? currentText().t("mobile.workspace.error.disconnectFailed"));
        },
        request: async <T,>(
          method: string,
          path: string,
          decode: (value: unknown) => T,
          body: TeamProtocolV2Json = {},
          upload?: RemoteFileUpload,
          onUploadProgress?: (fraction: number) => void,
        ): Promise<T> => {
          const result = await enqueue({ type: "request", method, path, body, upload }, onUploadProgress);
          if (!result.ok) throw new Error(result.error ?? sourceText("error.remote.serverRequestFailed"));
          if (result.status === 409 && isQueueEditRoute(method, path))
            throw new QueueEditRejectedError(currentText().t("mobile.workspace.error.queueEditRejected"));
          if (result.status !== undefined && result.status >= 400)
            throw new Error(sourceText("error.remote.serverRequestFailed"));
          return decode(result.body);
        },
      }),
      [enqueue],
    );

    const handleCommandResult = useCallback(
      async (result: RemoteTeamCommandResult) => {
        mailbox.receive(result);
      },
      [mailbox],
    );

    return (
      <RemoteTeamBridge
        active={foreground}
        commands={commands}
        dom={{
          containerStyle: {
            flex: 0,
            height: 1,
            left: 0,
            opacity: 0,
            position: "absolute",
            top: 0,
            width: 1,
          },
          pointerEvents: "none",
          scrollEnabled: false,
          style: { flex: 0, height: 1, width: 1 },
        }}
        endSession={(sessionId) => directory.endSession(sessionId)}
        getBootstrap={(hostId, clientPublicKey, existingSessionId) =>
          directory.createBootstrap(hostId, clientPublicKey, existingSessionId)
        }
        onCommandResult={handleCommandResult}
        onUploadProgress={async ({ commandId, sent, total }: RemoteUploadProgress) =>
          uploadListeners.current.get(commandId)?.(total > 0 ? sent / total : 1)
        }
        onAccountProfileChanged={refreshProfile}
        onAccountServersChanged={onMembershipChanged}
        onConnectionUpdate={async (update) => onConnectionUpdate(update)}
        onTeamEvent={async (hostId, event) => onTeamEvent(hostId, event)}
      />
    );
  },
);
