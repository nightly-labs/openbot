"use dom";

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_WEB_CLIENT_PROTOCOL } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteTeamPeer,
  decodeRemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamEvent,
  type RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";
import { createTeamRequestId } from "@openbot/team-client/request-id";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef } from "react";
import { type BrowserViewBridgeEvent, createBrowserViewBridge } from "@/features/browser/model/browser-view-bridge";
import {
  createRemoteDesktopRelay,
  type RemoteDesktopRelayEvent,
} from "@/features/remote-desktop/model/remote-desktop-relay";

type BridgeJson = Parameters<DOMImperativeFactory[string]>[0];

export type RemoteTeamBridgeHandle = {
  browserView: (command: BridgeJson) => void;
  remoteDesktop: (command: BridgeJson) => void;
  teamCommands: (commands: BridgeJson) => void;
  setActive: (active: BridgeJson) => void;
  networkChanged: (value: BridgeJson) => void;
  cancelUpload: (value: BridgeJson) => void;
};

interface RemoteTeamBridgeProps extends Omit<RemoteTeamPeerActions, "onTeamEvent"> {
  ref?: Ref<RemoteTeamBridgeHandle>;
  active: boolean;
  onTeamEvents: (hostId: string, events: RemoteTeamEvent[]) => Promise<void>;
  onCommandResult: (result: RemoteTeamCommandResult) => Promise<void>;
  onReady?: () => Promise<void>;
  onBrowserViewEvent?: (event: BrowserViewBridgeEvent) => Promise<void>;
  onRemoteDesktopEvent?: (event: RemoteDesktopRelayEvent) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

const KNOWN_COMMAND_LIMIT = 1_000;
const TEAM_EVENT_BATCH_MS = 16;

function createTeamEventBatch(deliver: (hostId: string, events: RemoteTeamEvent[]) => Promise<void>) {
  let pending: { hostId: string; events: RemoteTeamEvent[] }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failure: { error: unknown } | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const runs = pending;
    pending = [];
    for (const run of runs)
      void deliver(run.hostId, run.events).catch((error: unknown) => {
        failure ??= { error };
      });
  };
  return {
    push(hostId: string, event: RemoteTeamEvent) {
      if (failure) {
        const { error } = failure;
        failure = null;
        throw error;
      }
      const last = pending.at(-1);
      if (last?.hostId === hostId) last.events.push(event);
      else pending.push({ hostId, events: [event] });
      timer ??= setTimeout(flush, TEAM_EVENT_BATCH_MS);
    },
    flush,
  };
}

function requestError(body: unknown): string {
  return isDynamicRecord(body) && isString(body.error) && body.error
    ? body.error
    : sourceText("error.remote.serverRequestFailed");
}

export default function RemoteTeamBridge({
  ref,
  active,
  onCommandResult,
  onReady,
  onBrowserViewEvent,
  onRemoteDesktopEvent,
  onTeamEvents,
  ...callbacks
}: RemoteTeamBridgeProps) {
  const teamEvents = useRef(onTeamEvents);
  teamEvents.current = onTeamEvents;
  const eventBatch = useRef<ReturnType<typeof createTeamEventBatch> | null>(null);
  eventBatch.current ??= createTeamEventBatch((hostId, events) => teamEvents.current(hostId, events));
  const pendingEvents = eventBatch.current;
  const browserViewEvent = useRef(onBrowserViewEvent);
  browserViewEvent.current = onBrowserViewEvent;
  const remoteDesktopEvent = useRef(onRemoteDesktopEvent);
  remoteDesktopEvent.current = onRemoteDesktopEvent;
  const browserView = useRef<ReturnType<typeof createBrowserViewBridge> | null>(null);
  const remoteDesktop = useRef<ReturnType<typeof createRemoteDesktopRelay> | null>(null);
  const queueTeamEvent = async (hostId: string, event: RemoteTeamEvent) => pendingEvents.push(hostId, event);
  const afterTeamEvents = <Args extends unknown[]>(callback: ((...args: Args) => Promise<void>) | undefined) =>
    callback &&
    (async (...args: Args) => {
      pendingEvents.flush();
      await callback(...args);
    });
  const actions = useRef<RemoteTeamPeerActions>({ ...callbacks, onTeamEvent: queueTeamEvent });
  actions.current = {
    ...callbacks,
    onTeamEvent: queueTeamEvent,
    onUploadProgress: afterTeamEvents(callbacks.onUploadProgress),
    onDownloadProgress: afterTeamEvents(callbacks.onDownloadProgress),
    onAccountProfileChanged: afterTeamEvents(callbacks.onAccountProfileChanged),
    onAccountServersChanged: afterTeamEvents(callbacks.onAccountServersChanged),
    onHostStreamData: (data) => {
      browserView.current?.receive(data);
      remoteDesktop.current?.receive(data);
    },
    onConnectionUpdate: async (update) => {
      pendingEvents.flush();
      if (update.state !== "online") {
        browserView.current?.disconnect(update.message);
        remoteDesktop.current?.disconnect(update.message);
      }
      await callbacks.onConnectionUpdate(update);
    },
  };
  const runtime = useRef<ReturnType<typeof createRemoteTeamPeer> | null>(null);
  if (!runtime.current) runtime.current = createRemoteTeamPeer(actions, { clientProtocol: TEAM_WEB_CLIENT_PROTOCOL });
  const peer = runtime.current;
  if (!browserView.current)
    browserView.current = createBrowserViewBridge(
      (data) => peer.sendHostStreamData(data),
      async (method, path, body) => {
        const result = await peer.execute({
          id: createTeamRequestId((size) => crypto.getRandomValues(new Uint8Array(size))),
          type: "request",
          method,
          path,
          body: body ?? {},
        });
        if (!result.ok) throw new Error(result.error ?? sourceText("error.remote.serverRequestFailed"));
        if (result.status !== undefined && result.status >= 400) throw new Error(requestError(result.body));
        return result.body;
      },
      (event) => void browserViewEvent.current?.(event),
    );
  const views = browserView.current;
  if (!remoteDesktop.current)
    remoteDesktop.current = createRemoteDesktopRelay(
      (data) => peer.sendHostStreamData(data),
      (event) => void remoteDesktopEvent.current?.(event),
    );
  const desktopStreams = remoteDesktop.current;
  const commandResult = useRef(onCommandResult);
  commandResult.current = onCommandResult;
  const runCommands = useRef<((commands: unknown) => void) | null>(null);
  if (!runCommands.current) {
    const knownCommandIds = new Set<string>();
    const answer = (result: RemoteTeamCommandResult) => {
      pendingEvents.flush();
      void commandResult.current(result);
    };
    runCommands.current = (commands) => {
      if (!Array.isArray(commands)) return;
      for (const value of commands) {
        const { command, commandId } = decodeRemoteTeamCommand(value);
        if (commandId === null || knownCommandIds.has(commandId)) continue;
        knownCommandIds.add(commandId);
        if (knownCommandIds.size > KNOWN_COMMAND_LIMIT)
          for (const oldest of knownCommandIds) {
            knownCommandIds.delete(oldest);
            break;
          }
        if (command) void peer.execute(command).then(answer);
        else answer({ commandId, ok: false, error: sourceText("error.remote.operationFailed") });
      }
    };
  }
  const teamCommands = runCommands.current;
  const appliedActive = useRef<boolean | null>(null);
  const applyActive = useRef<((value: unknown) => void) | null>(null);
  if (!applyActive.current)
    applyActive.current = (value) => {
      if (typeof value !== "boolean" || appliedActive.current === value) return;
      appliedActive.current = value;
      peer.setActive(value);
    };
  const setActive = applyActive.current;
  const networkChanged = useRef(() => peer.networkMoved()).current;
  const cancelUpload = useRef(() => {
    void peer.cancelUpload().catch(() => undefined);
  }).current;

  useDOMImperativeHandle<RemoteTeamBridgeHandle>(
    ref ?? null,
    () => ({
      browserView: views.command,
      remoteDesktop: desktopStreams.command,
      teamCommands,
      setActive,
      networkChanged,
      cancelUpload,
    }),
    [views, desktopStreams, teamCommands, setActive, networkChanged, cancelUpload],
  );

  const readySent = useRef(false);
  useEffect(() => {
    if (!onReady || readySent.current) return;
    readySent.current = true;
    void onReady();
  }, [onReady]);

  useEffect(() => {
    if (appliedActive.current === null) setActive(active);
  }, [active, setActive]);

  useEffect(() => {
    const restore = () => peer.networkRestored();
    window.addEventListener("online", restore);
    return () => window.removeEventListener("online", restore);
  }, [peer]);

  useEffect(
    () => () => {
      pendingEvents.flush();
      browserView.current?.disconnect(null);
      remoteDesktop.current?.disconnect(null);
      void peer.dispose();
    },
    [peer, pendingEvents],
  );
  return null;
}
