import { BROWSER_SECRET_RESPONSE_PATH } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { BROWSER_SECRET_VAULT_ROUTES } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import {
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { LIVE_VOICE_ROUTES } from "@openbot/contracts/team-protocol/live-voice-v1";
import { PENDING_APPROVAL_ROUTES } from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PHONE_FEEDBACK_ROUTES } from "@openbot/contracts/team-protocol/phone-feedback-v1";
import { isQueueEditRoute, QueueEditRejectedError } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteTeamDirectoryClient } from "@openbot/team-client";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import {
  createRemoteCommandMailbox,
  type RemoteDownloadProgress,
  type RemoteDownloadWatch,
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
import { File, FileMode } from "expo-file-system";
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
import { uploadCancelled } from "@/features/workspace/model/upload-cancels";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { currentText } from "@/shared/lib/text";

import RemoteTeamBridge, { type RemoteTeamBridgeHandle } from "./remote-team-bridge.dom";

export interface RemoteTeamTransportRef {
  connect(hostId: string, hostPublicKey: string): Promise<{ kept: boolean }>;
  disconnect(): Promise<void>;
  networkChanged(): void;
  request<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
    onUploadProgress?: (fraction: number) => void,
    largeDownload?: RemoteLargeDownload,
    download?: RemoteDownloadWatch,
  ): Promise<T>;
  openBrowserView(
    options: Omit<BrowserViewBridgeOpen, "viewId">,
    listener: (event: BrowserViewBridgeEvent) => void,
  ): RemoteBrowserViewSession | null;
  fetchRaw(
    method: string,
    path: string,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
  ): Promise<{ status: number; body: unknown }>;
  openRemoteDesktopStream(path: string, listener: (event: RemoteDesktopRelayEvent) => void): RemoteDesktopStream | null;
}

export type RemoteDesktopConnection = Pick<RemoteTeamTransportRef, "fetchRaw" | "openRemoteDesktopStream">;

export interface RemoteDesktopStream {
  sendText(data: string): void;
  sendBinary(base64: string): void;
  close(code: number, reason: string): void;
}

interface RemoteTeamTransportProps {
  hostId: string;
  active: boolean;
  directory: RemoteTeamDirectoryClient;
  onConnectionUpdate: (update: RemoteTeamConnectionUpdate) => void;
  onDiagnostic?: (step: RemoteTeamDiagnostic["step"], detail: string | undefined) => void;
  onMembershipChanged?: () => Promise<void>;
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
      downloadSize?: number;
    };

const partialFile = (uri: string) => new File(`${uri}.part`);

function removePartialFile(uri: string) {
  try {
    const part = partialFile(uri);
    if (part.exists) part.delete();
  } catch {}
}

async function keepDownloadedFile(uri: string, size: number) {
  const file = new File(uri);
  if (file.exists && file.size === size) return removePartialFile(uri);
  try {
    const part = partialFile(uri);
    if (part.size !== size) throw new Error(sourceText("error.remote.downloadIncompleteRetry"));
    await part.move(file, { overwrite: true });
  } catch (error) {
    removePartialFile(uri);
    throw error;
  }
}

function savedTo(result: RemoteTeamCommandResult, uri: string) {
  const file = isDynamicRecord(result.body) ? result.body.file : undefined;
  return result.ok && isDynamicRecord(file) && file.ref === uri;
}

function liveVoiceErrorText(path: string, status: number, body: unknown): string | null {
  if (path === LIVE_VOICE_ROUTES.start && status >= 500) return sourceText("error.voice.live.hostFailed");
  if (path !== LIVE_VOICE_ROUTES.start && path !== LIVE_VOICE_ROUTES.stop) return null;
  return isDynamicRecord(body) && isString(body.error) && body.error ? body.error : null;
}

function liveVoiceHostFailure(path: string, reference: string | undefined): string | null {
  return path === LIVE_VOICE_ROUTES.start && reference?.startsWith("host/500/")
    ? sourceText("error.voice.live.hostFailed")
    : null;
}

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

const GATHERING_STALLS_BEFORE_NEW_BRIDGE = 2;

export const RemoteTeamTransport = memo(
  forwardRef<RemoteTeamTransportRef, RemoteTeamTransportProps>(function RemoteTeamTransport(props, ref) {
    const { refreshProfile } = useMobileSession();
    const latest = useRef({ props, refreshProfile });
    latest.current = { props, refreshProfile };

    const bridge = useRef<RemoteTeamBridgeHandle>(null);
    const deliverCommands = useCallback((commands: RemoteTeamCommand[]) => {
      const teamCommands = bridge.current?.teamCommands;
      if (typeof teamCommands === "function" && commands.length > 0) teamCommands(commands);
    }, []);
    const sendActive = useCallback((active: boolean) => {
      const setActive = bridge.current?.setActive;
      if (typeof setActive === "function") setActive(active);
    }, []);
    useEffect(() => sendActive(props.active), [props.active, sendActive]);
    const mailboxRef = useRef<ReturnType<typeof createRemoteCommandMailbox> | null>(null);
    if (!mailboxRef.current) mailboxRef.current = createRemoteCommandMailbox((command) => deliverCommands([command]));
    const mailbox = mailboxRef.current;
    const hostIdRef = useRef<string | null>(null);
    useEffect(() => () => mailbox.dispose(), [mailbox]);
    const backgroundReads = useRef<ReturnType<typeof createRequestLimiter> | null>(null);
    backgroundReads.current ??= createRequestLimiter(BACKGROUND_READS_IN_FLIGHT);
    const backgroundLane = backgroundReads.current;

    const viewListeners = useRef(new Map<string, (event: BrowserViewBridgeEvent) => void>());
    const sendViewCommand = useCallback((command: BrowserViewBridgeCommand) => {
      const browserView = bridge.current?.browserView;
      if (typeof browserView !== "function") return false;
      browserView(command);
      return true;
    }, []);

    const desktopListeners = useRef(new Map<string, (event: RemoteDesktopRelayEvent) => void>());
    const sendDesktopCommand = useCallback((command: RemoteDesktopRelayCommand) => {
      const remoteDesktop = bridge.current?.remoteDesktop;
      if (typeof remoteDesktop !== "function") return false;
      remoteDesktop(command);
      return true;
    }, []);

    const uploadListeners = useRef(new Map<string, (fraction: number) => void>());
    const downloadListeners = useRef(new Map<string, (received: number, total: number) => void>());
    const uploadFiles = useRef(new Map<string, number>());
    const downloadFiles = useRef(new Set<string>());
    const enqueue = useCallback(
      (
        next: RemoteTeamCommandInput,
        onUploadProgress?: (fraction: number) => void,
        onDownloadProgress?: (received: number, total: number) => void,
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
                  timeoutMs: remoteWorkspaceReadTimeout(next.method, next.path),
                  ...(next.path === INSTANCE_TRANSFER_ROUTES.export
                    ? { largeDownload: { maxBytes: INSTANCE_TRANSFER_REMOTE_BYTES, mimeType: "application/zip" } }
                    : next.largeDownload
                      ? { largeDownload: next.largeDownload }
                      : {}),
                  ...(next.downloadSize === undefined ? {} : { downloadSize: next.downloadSize }),
                }
              : { id, type: "disconnect" };
        const fileRef = command.type === "request" ? command.upload?.file?.ref : undefined;
        const saved = command.type === "request" ? command.largeDownload : undefined;
        const savedFile = saved?.file;
        if (!onUploadProgress && !onDownloadProgress && !fileRef && !savedFile) return mailbox.send(command);
        if (onUploadProgress) uploadListeners.current.set(id, onUploadProgress);
        if (onDownloadProgress) downloadListeners.current.set(id, onDownloadProgress);
        if (fileRef) uploadFiles.current.set(fileRef, (uploadFiles.current.get(fileRef) ?? 0) + 1);
        if (savedFile) downloadFiles.current.add(savedFile);
        const sent =
          saved && savedFile
            ? mailbox.send(command).then(
                async (result) => {
                  downloadFiles.current.delete(savedFile);
                  if (savedTo(result, savedFile)) await keepDownloadedFile(savedFile, saved.maxBytes);
                  else removePartialFile(savedFile);
                  return result;
                },
                (error: unknown) => {
                  downloadFiles.current.delete(savedFile);
                  removePartialFile(savedFile);
                  throw error;
                },
              )
            : mailbox.send(command);
        return sent.finally(() => {
          uploadListeners.current.delete(id);
          downloadListeners.current.delete(id);
          if (savedFile) downloadFiles.current.delete(savedFile);
          if (!fileRef) return;
          const count = (uploadFiles.current.get(fileRef) ?? 1) - 1;
          if (count > 0) uploadFiles.current.set(fileRef, count);
          else uploadFiles.current.delete(fileRef);
        });
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
          download?: RemoteDownloadWatch,
        ): Promise<T> => {
          const started = Date.now();
          const send = () =>
            enqueue(
              { type: "request", method, path, body, upload, largeDownload, downloadSize: download?.size },
              onUploadProgress,
              download?.onProgress,
            );
          const result = await (isBackgroundRead(method, path) ? backgroundLane(send) : send());
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
            throw referencedError(
              liveVoiceHostFailure(path, result.reference) ??
                result.error ??
                sourceText("error.remote.serverRequestFailed"),
              result.reference,
            );
          if (result.status === 409 && isQueueEditRoute(method, path))
            throw new QueueEditRejectedError(currentText().t("mobile.workspace.error.queueEditRejected"));
          if (
            result.status === 409 &&
            method === "POST" &&
            (path === TEAM_API_ROUTES.respond.approval ||
              path === PENDING_APPROVAL_ROUTES.read ||
              path === PHONE_FEEDBACK_ROUTES.send)
          )
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
          if (result.status === 409 && method === "POST" && path === TEAM_API_ROUTES.respond.prompt)
            throw new InactiveRequestError(currentText().t("mobile.workspace.error.formUnavailable"));
          if (
            result.status === 409 &&
            method === "POST" &&
            (path === BROWSER_SECRET_RESPONSE_PATH || path === BROWSER_SECRET_VAULT_ROUTES.respond)
          )
            throw new InactiveRequestError(currentText().t("mobile.chat.browserSecret.ended"));
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

    const pageLoads = useRef(0);
    const [bridgeKey, setBridgeKey] = useState(0);
    const gatheringStalls = useRef(0);
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
    const uploadFile = (ref: string) => {
      if (!uploadFiles.current.has(ref)) throw new Error("The file is not part of an upload.");
      if (uploadCancelled(ref)) {
        const cancelUpload = bridge.current?.cancelUpload;
        if (typeof cancelUpload === "function") cancelUpload(null);
        throw new Error("The upload was cancelled.");
      }
      return new File(ref);
    };
    const [actions] = useState(() => ({
      digestUploadFile: async (ref: string) => uploadFile(ref).digest("SHA-256"),
      writeDownloadFile: async ({ ref, base64, append }: { ref: string; base64: string; append: boolean }) => {
        if (!downloadFiles.current.has(ref)) throw new Error("The file is not part of a download.");
        await partialFile(ref).write(base64, { encoding: "base64", append });
      },
      readUploadFile: async ({ ref, offset, length }: { ref: string; offset: number; length: number }) => {
        const handle = uploadFile(ref).open(FileMode.ReadOnly);
        try {
          handle.offset = offset;
          return bytesToBase64(await handle.readBytes(length));
        } finally {
          handle.close();
        }
      },
      endSession: (sessionId: string) => runTeamEffect(latest.current.props.directory.endSession(sessionId)),
      getBootstrap: async (hostId: string, clientPublicKey: string, existingSessionId: string | null) => {
        const { directory } = latest.current.props;
        const early = earlySession.current;
        earlySession.current = null;
        const earlySessionId =
          existingSessionId === null && early?.hostId === hostId && early.directory === directory
            ? await early.sessionId
            : null;
        if (earlySessionId === null)
          return runTeamEffect(directory.createBootstrap(hostId, clientPublicKey, existingSessionId));
        return runTeamEffect(directory.createBootstrap(hostId, clientPublicKey, earlySessionId)).catch(
          async (error: unknown) => {
            await runTeamEffect(directory.endSession(earlySessionId)).catch(() => undefined);
            throw error;
          },
        );
      },
      onUploadProgress: async ({ commandId, sent, total }: RemoteUploadProgress) =>
        uploadListeners.current.get(commandId)?.(total > 0 ? sent / total : 1),
      onDownloadProgress: async ({ commandId, received, total }: RemoteDownloadProgress) =>
        downloadListeners.current.get(commandId)?.(received, total),
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
      onDiagnostic: async ({ hostId, step, detail }: RemoteTeamDiagnostic) => {
        supportLog.add(
          step === "failed" ||
            step === "stalled" ||
            step === "signal-error" ||
            step === "ice-candidate-error" ||
            step === "ice-gathering-stalled"
            ? "warn"
            : "info",
          "connection",
          `${hostId} peer ${step}${detail ? `: ${detail}` : ""}`,
        );
        if (step === "authenticated") gatheringStalls.current = 0;
        if (step === "ice-gathering-stalled") {
          gatheringStalls.current += 1;
          if (gatheringStalls.current >= GATHERING_STALLS_BEFORE_NEW_BRIDGE) {
            gatheringStalls.current = 0;
            supportLog.add("warn", "connection", `${hostId} new page after ICE gathering stalls`);
            setBridgeKey((key) => key + 1);
          }
        }
        latest.current.props.onDiagnostic?.(step, detail);
      },
      onNetworkRestored: async () => latest.current.props.onNetworkRestored?.(),
      onTeamEvents: async (hostId: string, events: RemoteTeamEvent[]) => {
        const { onTeamEvent } = latest.current.props;
        let failure: { error: unknown } | null = null;
        for (const event of events) {
          try {
            onTeamEvent(hostId, event);
          } catch (error) {
            failure ??= { error };
          }
        }
        if (failure) throw failure.error;
      },
    }));

    return (
      <RemoteTeamBridge
        key={bridgeKey}
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
