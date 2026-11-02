"use dom";

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteTeamPeer,
  decodeRemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";
import { createTeamRequestId } from "@openbot/team-client/request-id";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef } from "react";
import { type BrowserViewBridgeEvent, createBrowserViewBridge } from "@/features/browser/model/browser-view-bridge";

type BridgeJson = Parameters<DOMImperativeFactory[string]>[0];

/** The native side's handle on this page. A command crosses as JSON and is read again here. */
export type RemoteTeamBridgeHandle = {
  browserView: (command: BridgeJson) => void;
  /**
   * Team commands to run: each new one, and all outstanding ones again when the page says it is
   * ready. A command whose ID the page has already had does not run again.
   */
  teamCommands: (commands: BridgeJson) => void;
  /**
   * The foreground state, before the commands that follow it. The `active` prop arrives through a
   * render, so a `connect` sent at a return to the app ran before it and failed as in the background.
   */
  setActive: (active: BridgeJson) => void;
};

interface RemoteTeamBridgeProps extends RemoteTeamPeerActions {
  ref?: Ref<RemoteTeamBridgeHandle>;
  active: boolean;
  onCommandResult: (result: RemoteTeamCommandResult) => Promise<void>;
  /** The page can take commands. It calls this once per load, after its handle is registered. */
  onReady?: () => Promise<void>;
  onBrowserViewEvent?: (event: BrowserViewBridgeEvent) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

/**
 * How many command IDs the page keeps. The native side sends the outstanding commands again when the
 * page is ready, and its first commands can arrive before that, or finish before the repeat comes.
 */
const KNOWN_COMMAND_LIMIT = 1_000;

/** The host's own error text for a refused request, such as a view the host cannot open. */
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
  ...callbacks
}: RemoteTeamBridgeProps) {
  const browserViewEvent = useRef(onBrowserViewEvent);
  browserViewEvent.current = onBrowserViewEvent;
  const browserView = useRef<ReturnType<typeof createBrowserViewBridge> | null>(null);
  const actions = useRef<RemoteTeamPeerActions>(callbacks);
  actions.current = {
    ...callbacks,
    onHostStreamData: (data) => browserView.current?.receive(data),
    onConnectionUpdate: async (update) => {
      if (update.state !== "online") browserView.current?.disconnect(update.message);
      await callbacks.onConnectionUpdate(update);
    },
  };
  const runtime = useRef<ReturnType<typeof createRemoteTeamPeer> | null>(null);
  if (!runtime.current) runtime.current = createRemoteTeamPeer(actions);
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
  const commandResult = useRef(onCommandResult);
  commandResult.current = onCommandResult;
  const runCommands = useRef<((commands: unknown) => void) | null>(null);
  if (!runCommands.current) {
    const knownCommandIds = new Set<string>();
    const answer = (result: RemoteTeamCommandResult) => void commandResult.current(result);
    runCommands.current = (commands) => {
      if (!Array.isArray(commands)) return;
      for (const value of commands) {
        const { command, commandId } = decodeRemoteTeamCommand(value);
        if (commandId === null || knownCommandIds.has(commandId)) continue;
        knownCommandIds.add(commandId);
        // A set keeps insertion order, so the first ID is the oldest.
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
  // The handle and the first prop both send the state. A repeated state must not run a second return.
  const appliedActive = useRef<boolean | null>(null);
  const applyActive = useRef<((value: unknown) => void) | null>(null);
  if (!applyActive.current)
    applyActive.current = (value) => {
      if (typeof value !== "boolean" || appliedActive.current === value) return;
      appliedActive.current = value;
      peer.setActive(value);
    };
  const setActive = applyActive.current;

  useDOMImperativeHandle<RemoteTeamBridgeHandle>(
    ref ?? null,
    () => ({ browserView: views.command, teamCommands, setActive }),
    [views, teamCommands, setActive],
  );

  // After the handle effect above, so the native side knows the handle before it sends the commands.
  // In Expo Go on Android `onReady` arrives with the second props; see expo-go-dom.ts.
  const readySent = useRef(false);
  useEffect(() => {
    if (!onReady || readySent.current) return;
    readySent.current = true;
    void onReady();
  }, [onReady]);

  // The first state of a page that loads. After it, the handle sends each state before its commands,
  // and a prop render that arrives later carries an older state.
  useEffect(() => {
    if (appliedActive.current === null) setActive(active);
  }, [active, setActive]);

  // The WebView has no network details, but it sends `online` when the phone gets a network again.
  useEffect(() => {
    const restore = () => peer.networkRestored();
    window.addEventListener("online", restore);
    return () => window.removeEventListener("online", restore);
  }, [peer]);

  useEffect(
    () => () => {
      browserView.current?.disconnect(null);
      void peer.dispose();
    },
    [peer],
  );
  return null;
}
