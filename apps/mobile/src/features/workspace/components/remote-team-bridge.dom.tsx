"use dom";

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteTeamPeer,
  type RemoteTeamCommand,
  type RemoteTeamCommandResult,
  type RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";
import { createTeamRequestId } from "@openbot/team-client/request-id";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef } from "react";
import { type BrowserViewBridgeEvent, createBrowserViewBridge } from "@/features/browser/model/browser-view-bridge";

/** The native side's handle on this page. A command crosses as JSON and is read again here. */
export type RemoteTeamBridgeHandle = {
  browserView: (command: Parameters<DOMImperativeFactory[string]>[0]) => void;
};

interface RemoteTeamBridgeProps extends RemoteTeamPeerActions {
  ref?: Ref<RemoteTeamBridgeHandle>;
  commands: RemoteTeamCommand[];
  active: boolean;
  onCommandResult: (result: RemoteTeamCommandResult) => Promise<void>;
  onBrowserViewEvent?: (event: BrowserViewBridgeEvent) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

// Missing in Expo Go on Android until the props come again; see expo-go-dom.ts.
const NO_COMMANDS: RemoteTeamCommand[] = [];

/** The host's own error text for a refused request, such as a view the host cannot open. */
function requestError(body: unknown): string {
  return isDynamicRecord(body) && isString(body.error) && body.error
    ? body.error
    : sourceText("error.remote.serverRequestFailed");
}

export default function RemoteTeamBridge({
  ref,
  commands = NO_COMMANDS,
  active,
  onCommandResult,
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
  const processedCommandIds = useRef(new Set<string>());

  useDOMImperativeHandle<RemoteTeamBridgeHandle>(ref ?? null, () => ({ browserView: views.command }), [views]);

  useEffect(() => {
    peer.setActive(active);
  }, [active, peer]);

  // The WebView has no network details, but it sends `online` when the phone gets a network again.
  useEffect(() => {
    const restore = () => peer.networkRestored();
    window.addEventListener("online", restore);
    return () => window.removeEventListener("online", restore);
  }, [peer]);

  useEffect(() => {
    const currentIds = new Set(commands.map((command) => command.id));
    for (const id of processedCommandIds.current) {
      if (!currentIds.has(id)) processedCommandIds.current.delete(id);
    }
    for (const command of commands) {
      if (processedCommandIds.current.has(command.id)) continue;
      processedCommandIds.current.add(command.id);
      void peer.execute(command).then(onCommandResult);
    }
  }, [commands, onCommandResult, peer]);

  useEffect(
    () => () => {
      browserView.current?.disconnect(null);
      void peer.dispose();
    },
    [peer],
  );
  return null;
}
