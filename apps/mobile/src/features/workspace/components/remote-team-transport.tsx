import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { isQueueEditRoute, QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteTeamDirectoryClient } from "@openbot/team-client";
import { runTeamEffect } from "@openbot/team-client";
import {
  createRemoteCommandMailbox,
  type RemoteFileUpload,
  type RemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamConnectionUpdate,
  type RemoteTeamDiagnostic,
  type RemoteUploadProgress,
} from "@openbot/team-client/remote-peer";
import { referenceFrom } from "@openbot/user-errors";
import type { DOMProps } from "expo/dom";
import * as Crypto from "expo-crypto";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import type {
  BrowserViewBridgeCommand,
  BrowserViewBridgeEvent,
  BrowserViewBridgeOpen,
  RemoteBrowserViewSession,
} from "@/features/browser/model/browser-view-bridge";
import { supportLog, supportLogUrl } from "@/features/support/model/support-log";
import { InactiveRequestError } from "@/features/workspace/model/pending-approvals";
import { referencedError } from "@/features/workspace/model/referenced-error";
import {
  BACKGROUND_READS_IN_FLIGHT,
  createRequestLimiter,
  isBackgroundRead,
} from "@/features/workspace/model/request-lanes";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { currentText } from "@/shared/lib/text";

import RemoteTeamBridge, { type RemoteTeamBridgeHandle } from "./remote-team-bridge.dom";

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
  /** Null until the peer page is ready for views. Events of a closed view are dropped. */
  openBrowserView(
    options: Omit<BrowserViewBridgeOpen, "viewId">,
    listener: (event: BrowserViewBridgeEvent) => void,
  ): RemoteBrowserViewSession | null;
}

interface RemoteTeamTransportProps {
  active: boolean;
  directory: RemoteTeamDirectoryClient;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => void;
  /** Signal says this account's server list changed on another device. */
  onMembershipChanged?: () => Promise<void>;
  /** The phone got a network again. */
  onNetworkRestored?: () => void;
  onTeamEvent: (hostId: string, event: AgentEvent | TeamRealtimeEvent) => void;
}

type RemoteTeamCommandInput =
  | { type: "connect"; hostId: string; hostPublicKey: string }
  | { type: "disconnect" }
  | { type: "request"; method: string; path: string; body: TeamProtocolV2Json; upload?: RemoteFileUpload };

// One object, not a new one for each render.
const BRIDGE_DOM: DOMProps = {
  ...expoGoDomOptions,
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
};

/**
 * The hidden page that holds the peer. Each render sends all props to the page, on Android through
 * the UI thread, so the props change only with `active`: the callbacks read the newest props here.
 */
export const RemoteTeamTransport = memo(
  forwardRef<RemoteTeamTransportRef, RemoteTeamTransportProps>(function RemoteTeamTransport(props, ref) {
    const { refreshProfile } = useMobileSession();
    const latest = useRef({ props, refreshProfile });
    latest.current = { props, refreshProfile };

    const bridge = useRef<RemoteTeamBridgeHandle>(null);
    // A command goes to the page once. A page that is not ready yet gets it when it reports ready.
    const deliverCommands = useCallback((commands: RemoteTeamCommand[]) => {
      // The handle has the method only after the page has registered it.
      const teamCommands = bridge.current?.teamCommands;
      if (typeof teamCommands === "function" && commands.length > 0) teamCommands(commands);
    }, []);
    // Runs before the effect of the parent `ServerConnection` that starts the connect at a return, so
    // the page is active before the command arrives. The prop alone arrives after it.
    const sendActive = useCallback((active: boolean) => {
      const setActive = bridge.current?.setActive;
      if (typeof setActive === "function") setActive(active);
    }, []);
    useEffect(() => sendActive(props.active), [props.active, sendActive]);
    const mailboxRef = useRef<ReturnType<typeof createRemoteCommandMailbox> | null>(null);
    if (!mailboxRef.current) mailboxRef.current = createRemoteCommandMailbox((command) => deliverCommands([command]));
    const mailbox = mailboxRef.current;
    // The server of this transport, for support log lines. Requests do not name it.
    const hostIdRef = useRef<string | null>(null);
    useEffect(() => () => mailbox.dispose(), [mailbox]);
    const backgroundReads = useRef<ReturnType<typeof createRequestLimiter> | null>(null);
    backgroundReads.current ??= createRequestLimiter(BACKGROUND_READS_IN_FLIGHT);
    const backgroundLane = backgroundReads.current;

    const viewListeners = useRef(new Map<string, (event: BrowserViewBridgeEvent) => void>());
    const sendViewCommand = useCallback((command: BrowserViewBridgeCommand) => {
      // The handle has the method only after the page has registered it.
      const browserView = bridge.current?.browserView;
      if (typeof browserView !== "function") return false;
      browserView(command);
      return true;
    }, []);

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
              ? {
                  id,
                  type: "request",
                  method: next.method,
                  path: next.path,
                  body: next.body,
                  upload: next.upload,
                  // The transfer file is the one answer larger than an attachment.
                  ...(next.path === INSTANCE_TRANSFER_ROUTES.export
                    ? { largeDownload: { maxBytes: INSTANCE_TRANSFER_REMOTE_BYTES, mimeType: "application/zip" } }
                    : {}),
                }
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
          hostIdRef.current = hostId;
          const result = await enqueue({ type: "connect", hostId, hostPublicKey });
          if (!result.ok)
            throw referencedError(
              result.error ?? currentText().t("mobile.workspace.error.connectFailed"),
              result.reference,
            );
        },
        disconnect: async () => {
          const result = await enqueue({ type: "disconnect" });
          if (!result.ok)
            throw referencedError(
              result.error ?? currentText().t("mobile.workspace.error.disconnectFailed"),
              result.reference,
            );
        },
        request: async <T,>(
          method: string,
          path: string,
          decode: (value: unknown) => T,
          body: TeamProtocolV2Json = {},
          upload?: RemoteFileUpload,
          onUploadProgress?: (fraction: number) => void,
        ): Promise<T> => {
          const started = Date.now();
          const send = () => enqueue({ type: "request", method, path, body, upload }, onUploadProgress);
          const result = await (isBackgroundRead(method, path) ? backgroundLane(send) : send());
          // Method, path, status and time only. Never the body or the upload.
          const request = `${hostIdRef.current ?? "unknown server"} ${method} ${supportLogUrl(path)}`;
          const time = `(${Date.now() - started} ms)`;
          if (!result.ok)
            supportLog.add("warn", "connection", `${request} -> failed: ${result.error ?? "no error"} ${time}`);
          else
            supportLog.add(
              result.status !== undefined && result.status >= 400 ? "warn" : "info",
              "connection",
              `${request} -> ${result.status ?? "no status"} ${time}`,
            );
          if (!result.ok)
            throw referencedError(result.error ?? sourceText("error.remote.serverRequestFailed"), result.reference);
          if (result.status === 409 && isQueueEditRoute(method, path))
            throw new QueueEditRejectedError(currentText().t("mobile.workspace.error.queueEditRejected"));
          // The host answers 409 when a form or an approval no longer waits: answered elsewhere, or ended.
          if (result.status === 409 && method === "POST" && path === TEAM_API_ROUTES.respond.approval)
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
          if (result.status === 409 && method === "POST" && path === TEAM_API_ROUTES.respond.prompt)
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.formUnavailable"));
          if (result.status !== undefined && result.status >= 400)
            throw referencedError(sourceText("error.remote.serverRequestFailed"), referenceFrom("http", result.status));
          return decode(result.body);
        },
        openBrowserView: (options, listener) => {
          const viewId = Crypto.randomUUID();
          viewListeners.current.set(viewId, listener);
          if (!sendViewCommand({ type: "open", viewId, ...options })) {
            viewListeners.current.delete(viewId);
            return null;
          }
          return {
            input: (inputs) => {
              if (inputs.length > 0) sendViewCommand({ type: "input", viewId, inputs });
            },
            frameDone: (sequence, drawn) => sendViewCommand({ type: "frame-done", viewId, sequence, drawn }),
            close: () => {
              if (!viewListeners.current.delete(viewId)) return;
              sendViewCommand({ type: "close", viewId });
            },
          };
        },
      }),
      [enqueue, sendViewCommand, backgroundLane],
    );

    // A page that loads again, such as after Android ends its renderer, has none of the commands.
    // The page takes later states from the handle only, so it gets the current one before its commands.
    const handleReady = useCallback(async () => {
      sendActive(latest.current.props.active);
      deliverCommands(mailbox.outstanding());
    }, [sendActive, deliverCommands, mailbox]);
    const handleCommandResult = useCallback(
      async (result: RemoteTeamCommandResult) => {
        mailbox.receive(result);
      },
      [mailbox],
    );
    const [actions] = useState(() => ({
      endSession: (sessionId: string) => runTeamEffect(latest.current.props.directory.endSession(sessionId)),
      getBootstrap: (hostId: string, clientPublicKey: string, existingSessionId: string | null) =>
        runTeamEffect(latest.current.props.directory.createBootstrap(hostId, clientPublicKey, existingSessionId)),
      onUploadProgress: async ({ commandId, sent, total }: RemoteUploadProgress) =>
        uploadListeners.current.get(commandId)?.(total > 0 ? sent / total : 1),
      onAccountProfileChanged: () => latest.current.refreshProfile(),
      onBrowserViewEvent: async (event: BrowserViewBridgeEvent) => {
        const listener = viewListeners.current.get(event.viewId);
        if (event.type === "ended") viewListeners.current.delete(event.viewId);
        listener?.(event);
      },
      onAccountServersChanged: async () => latest.current.props.onMembershipChanged?.(),
      onConnectionUpdate: async (update: RemoteTeamConnectionUpdate) => latest.current.props.onConnectionUpdate(update),
      onDiagnostic: async ({ hostId, step, detail }: RemoteTeamDiagnostic) =>
        supportLog.add(
          step === "failed" ? "warn" : "info",
          "connection",
          `${hostId} peer ${step}${detail ? `: ${detail}` : ""}`,
        ),
      onNetworkRestored: async () => latest.current.props.onNetworkRestored?.(),
      onTeamEvent: async (hostId: string, event: AgentEvent | TeamRealtimeEvent) =>
        latest.current.props.onTeamEvent(hostId, event),
    }));

    return (
      <RemoteTeamBridge
        ref={bridge}
        active={props.active}
        dom={BRIDGE_DOM}
        onCommandResult={handleCommandResult}
        onReady={handleReady}
        {...actions}
      />
    );
  }),
);
