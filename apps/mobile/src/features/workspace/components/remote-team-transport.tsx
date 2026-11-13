import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { LIVE_VOICE_ROUTES } from "@openbot/contracts/team-protocol/live-voice-v1";
import { PENDING_APPROVAL_ROUTES } from "@openbot/contracts/team-protocol/pending-approval-v1";
import { isQueueEditRoute, QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteTeamDirectoryClient } from "@openbot/team-client";
import { runTeamEffect } from "@openbot/team-client";
import {
  createRemoteCommandMailbox,
  type RemoteFileUpload,
  type RemoteLargeDownload,
  type RemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamConnectionUpdate,
  type RemoteTeamDiagnostic,
  type RemoteTeamEvent,
  type RemoteUploadProgress,
} from "@openbot/team-client/remote-peer";
import { remoteWorkspaceReadTimeout } from "@openbot/team-client/remote-recovery";
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
import type {
  RemoteDesktopRelayCommand,
  RemoteDesktopRelayEvent,
} from "@/features/remote-desktop/model/remote-desktop-relay";
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
  /** `kept`: the authenticated connection from before stays, and its event stream lost no event. */
  connect(hostId: string, hostPublicKey: string): Promise<{ kept: boolean }>;
  disconnect(): Promise<void>;
  /** The phone moved to another network, such as from Wi-Fi to mobile data. The peer makes a new connection. */
  networkChanged(): void;
  request<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    /** Hears the fraction of the uploaded file sent so far, from 0 to 1. */
    onUploadProgress?: (fraction: number) => void,
    /** Lets one file larger than the attachment limit answer this request. */
    largeDownload?: RemoteLargeDownload,
  ): Promise<T>;
  /** Null until the peer page is ready for views. Events of a closed view are dropped. */
  openBrowserView(
    options: Omit<BrowserViewBridgeOpen, "viewId">,
    listener: (event: BrowserViewBridgeEvent) => void,
  ): RemoteBrowserViewSession | null;
  /**
   * A request whose answer the caller reads: the status, and a JSON body or a file as
   * `{ name, mimeType, base64 }`. For the remote desktop viewer's own files, so it writes no support log line.
   */
  fetchRaw(
    method: string,
    path: string,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
  ): Promise<{ status: number; body: unknown }>;
  /** A socket of the remote desktop viewer. Null until the peer page is ready. */
  openRemoteDesktopStream(path: string, listener: (event: RemoteDesktopRelayEvent) => void): RemoteDesktopStream | null;
}

/** What the remote desktop viewer uses of a connected peer. */
export type RemoteDesktopConnection = Pick<RemoteTeamTransportRef, "fetchRaw" | "openRemoteDesktopStream">;

/** One socket of the remote desktop viewer, through the peer's desktop channel. */
export interface RemoteDesktopStream {
  sendText(data: string): void;
  sendBinary(base64: string): void;
  close(code: number, reason: string): void;
}

interface RemoteTeamTransportProps {
  /** The server of this transport. The first connect asks for its session while the hidden page starts. */
  hostId: string;
  active: boolean;
  directory: RemoteTeamDirectoryClient;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => void;
  /** Signal says this account's server list changed on another device. */
  onMembershipChanged?: () => Promise<void>;
  /** The phone got a network again. */
  onNetworkRestored?: () => void;
  onTeamEvent: (hostId: string, event: RemoteTeamEvent) => void;
}

type RemoteTeamCommandInput =
  | { type: "connect"; hostId: string; hostPublicKey: string }
  | { type: "disconnect" }
  | {
      type: "request";
      method: string;
      path: string;
      body: TeamProtocolV2Json;
      upload?: RemoteFileUpload;
      largeDownload?: RemoteLargeDownload;
    };

/**
 * The text for a refused live voice request. A 409 has the host's sentence: no Codex sign-in with
 * ChatGPT on the host, no event connection, or a timeout. The screen translates it and removes
 * secrets from it. A 500 of a start is a Codex failure on the host, whose reason stays in the host log.
 */
function liveVoiceErrorText(path: string, status: number, body: unknown): string | null {
  if (path === LIVE_VOICE_ROUTES.start && status >= 500) return sourceText("error.voice.live.hostFailed");
  if (path !== LIVE_VOICE_ROUTES.start && path !== LIVE_VOICE_ROUTES.stop) return null;
  return isDynamicRecord(body) && isString(body.error) && body.error ? body.error : null;
}

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

    const desktopListeners = useRef(new Map<string, (event: RemoteDesktopRelayEvent) => void>());
    const sendDesktopCommand = useCallback((command: RemoteDesktopRelayCommand) => {
      // The handle has the method only after the page has registered it.
      const remoteDesktop = bridge.current?.remoteDesktop;
      if (typeof remoteDesktop !== "function") return false;
      remoteDesktop(command);
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
                  // As on desktop and web: a read that makes the server usable fails in seconds, so a
                  // dead path does not keep the connection attempt running for the 10 min request limit.
                  timeoutMs: remoteWorkspaceReadTimeout(next.method, next.path),
                  // The transfer file, and a large file that the user asked for, can be larger than an attachment.
                  ...(next.path === INSTANCE_TRANSFER_ROUTES.export
                    ? { largeDownload: { maxBytes: INSTANCE_TRANSFER_REMOTE_BYTES, mimeType: "application/zip" } }
                    : next.largeDownload
                      ? { largeDownload: next.largeDownload }
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
          return { kept: result.kept === true };
        },
        networkChanged: () => {
          // The handle has the method only after the page has registered it.
          const networkChanged = bridge.current?.networkChanged;
          if (typeof networkChanged === "function") networkChanged(null);
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
          largeDownload?: RemoteLargeDownload,
        ): Promise<T> => {
          const started = Date.now();
          const send = () => enqueue({ type: "request", method, path, body, upload, largeDownload }, onUploadProgress);
          const result = await (isBackgroundRead(method, path) ? backgroundLane(send) : send());
          // Method, path, status and time only. Never the body or the upload.
          const request = `${hostIdRef.current ?? "unknown server"} ${method} ${supportLogUrl(path)}`;
          const time = `(${Date.now() - started} ms)`;
          if (!result.ok)
            supportLog.add(
              "warn",
              "connection",
              `${request} -> failed: ${result.error ?? "no error"}${result.reference ? ` [${result.reference}]` : ""} ${time}`,
            );
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
          if (
            result.status === 409 &&
            method === "POST" &&
            (path === TEAM_API_ROUTES.respond.approval || path === PENDING_APPROVAL_ROUTES.read)
          )
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
          if (result.status === 409 && method === "POST" && path === TEAM_API_ROUTES.respond.prompt)
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.formUnavailable"));
          if (result.status !== undefined && result.status >= 400)
            throw referencedError(
              liveVoiceErrorText(path, result.status, result.body) ?? sourceText("error.remote.serverRequestFailed"),
              referenceFrom("http", result.status),
            );
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
        fetchRaw: async (method, path, body = {}, upload) => {
          const result = await enqueue({ type: "request", method, path, body, upload });
          if (!result.ok)
            throw referencedError(result.error ?? sourceText("error.remote.serverRequestFailed"), result.reference);
          return { status: result.status ?? 200, body: result.body };
        },
        openRemoteDesktopStream: (path, listener) => {
          const streamId = Crypto.randomUUID();
          desktopListeners.current.set(streamId, listener);
          if (!sendDesktopCommand({ type: "open", streamId, path })) {
            desktopListeners.current.delete(streamId);
            return null;
          }
          return {
            sendText: (data) => {
              if (desktopListeners.current.has(streamId)) sendDesktopCommand({ type: "text", streamId, data });
            },
            sendBinary: (base64) => {
              if (desktopListeners.current.has(streamId)) sendDesktopCommand({ type: "binary", streamId, base64 });
            },
            close: (code, reason) => {
              if (!desktopListeners.current.delete(streamId)) return;
              sendDesktopCommand({ type: "close", streamId, code, reason });
            },
          };
        },
      }),
      [enqueue, sendViewCommand, sendDesktopCommand, backgroundLane],
    );

    // A page that loads again, such as after Android ends its renderer, has none of the commands.
    // The page takes later states from the handle only, so it gets the current one before its commands.
    // A second load means that the system ended the page's web process, such as in the background.
    const pageLoads = useRef(0);
    const handleReady = useCallback(async () => {
      pageLoads.current += 1;
      const outstanding = mailbox.outstanding();
      supportLog.add(
        "info",
        "connection",
        `${latest.current.props.hostId} page ready, load ${pageLoads.current}, ${outstanding.length} commands waiting`,
      );
      sendActive(latest.current.props.active);
      deliverCommands(outstanding);
    }, [sendActive, deliverCommands, mailbox]);
    const handleCommandResult = useCallback(
      async (result: RemoteTeamCommandResult) => {
        mailbox.receive(result);
      },
      [mailbox],
    );
    // The page must load and make its key before it asks for a ticket, and the ticket needs the
    // session. The session does not need the key, so the first connect asks for it while the page
    // loads. The account service gives the active session again, so the peer gets the same session
    // as with its own request, one round trip sooner.
    const earlySession = useRef<{
      hostId: string;
      directory: RemoteTeamDirectoryClient;
      sessionId: Promise<string | null>;
    } | null>(null);
    const earlySessionAsked = useRef(false);
    useEffect(() => {
      if (!props.active || earlySessionAsked.current) return;
      earlySessionAsked.current = true;
      earlySession.current = {
        hostId: props.hostId,
        directory: props.directory,
        sessionId: runTeamEffect(props.directory.startSession(props.hostId)).catch(() => null),
      };
    }, [props.active, props.hostId, props.directory]);
    const [actions] = useState(() => ({
      endSession: (sessionId: string) => runTeamEffect(latest.current.props.directory.endSession(sessionId)),
      getBootstrap: async (hostId: string, clientPublicKey: string, existingSessionId: string | null) => {
        const { directory } = latest.current.props;
        const early = earlySession.current;
        earlySession.current = null;
        const earlySessionId =
          existingSessionId === null && early?.hostId === hostId && early.directory === directory
            ? await early.sessionId
            : null;
        // A failed early request leaves the bootstrap as it was: it asks for the session itself.
        if (earlySessionId === null)
          return runTeamEffect(directory.createBootstrap(hostId, clientPublicKey, existingSessionId));
        // A session that ended meanwhile gets a new one in `createBootstrap`. As there, a failed
        // ticket ends the session that the bootstrap asked for.
        return runTeamEffect(directory.createBootstrap(hostId, clientPublicKey, earlySessionId)).catch(
          async (error: unknown) => {
            await runTeamEffect(directory.endSession(earlySessionId)).catch(() => undefined);
            throw error;
          },
        );
      },
      onUploadProgress: async ({ commandId, sent, total }: RemoteUploadProgress) =>
        uploadListeners.current.get(commandId)?.(total > 0 ? sent / total : 1),
      onAccountProfileChanged: () => latest.current.refreshProfile(),
      onBrowserViewEvent: async (event: BrowserViewBridgeEvent) => {
        const listener = viewListeners.current.get(event.viewId);
        if (event.type === "ended") viewListeners.current.delete(event.viewId);
        listener?.(event);
      },
      onRemoteDesktopEvent: async (event: RemoteDesktopRelayEvent) => {
        const listener = desktopListeners.current.get(event.streamId);
        if (event.type === "closed") desktopListeners.current.delete(event.streamId);
        listener?.(event);
      },
      onAccountServersChanged: async () => latest.current.props.onMembershipChanged?.(),
      onConnectionUpdate: async (update: RemoteTeamConnectionUpdate) => latest.current.props.onConnectionUpdate(update),
      onDiagnostic: async ({ hostId, step, detail }: RemoteTeamDiagnostic) =>
        supportLog.add(
          step === "failed" || step === "stalled" || step === "signal-error" ? "warn" : "info",
          "connection",
          `${hostId} peer ${step}${detail ? `: ${detail}` : ""}`,
        ),
      onNetworkRestored: async () => latest.current.props.onNetworkRestored?.(),
      onTeamEvent: async (hostId: string, event: RemoteTeamEvent) => latest.current.props.onTeamEvent(hostId, event),
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
