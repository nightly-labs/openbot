import {
  decodeWatchCommand,
  WATCH_PROTOCOL_VERSION,
  type WatchCommand,
  type WatchResult,
  type WatchSnapshot,
} from "@openbot/contracts/watch-protocol";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";
import { endWatchWake, startWatchWake } from "./model/watch-awake";
import { revokeWatchSession, type WatchAccountCredential } from "./model/watch-pairing";

interface WatchLinkState {
  supported: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

declare class WatchModule extends NativeModule<{
  onWatchCommand: (event: { id: string; command: string }) => void;
  onWatchState: (event: WatchLinkState) => void;
}> {
  readonly supported: boolean;
  state(): WatchLinkState;
  updateContext(payload: string): void;
  respond(id: string, result: string): void;
}

const native = requireOptionalNativeModule<WatchModule>("OpenBotWatch");

export const watchSupported = native?.supported === true;

export type WatchCommandHandler = (command: WatchCommand) => Promise<WatchResult>;

const NO_WATCH: WatchLinkState = { supported: false, paired: false, installed: false, reachable: false };
let linkState: WatchLinkState = NO_WATCH;
const stateListeners = new Set<() => void>();
let handler: WatchCommandHandler | null = null;
const waiting: { id: string; command: string }[] = [];
let installed = false;

function readState(): WatchLinkState {
  if (!native) return NO_WATCH;
  try {
    return native.state();
  } catch {
    return NO_WATCH;
  }
}

function setLinkState(next: WatchLinkState) {
  if (
    next.supported === linkState.supported &&
    next.paired === linkState.paired &&
    next.installed === linkState.installed &&
    next.reachable === linkState.reachable
  )
    return;
  linkState = next;
  for (const listener of stateListeners) listener();
}

function reply(id: string, result: WatchResult) {
  native?.respond(id, JSON.stringify(result));
}

function run(id: string, text: string) {
  const command = decodeWatchCommand(text);
  if (!command || !handler) {
    reply(id, { ok: false, error: "failed", message: "" });
    return;
  }
  const execute = handler;
  startWatchWake();
  execute(command)
    .catch((): WatchResult => ({ ok: false, error: "failed", message: "" }))
    .then((result) => reply(id, result))
    .finally(endWatchWake);
}

export function installWatch(): void {
  if (installed || !native) return;
  installed = true;
  native.addListener("onWatchCommand", ({ id, command }) => {
    if (handler) run(id, command);
    else waiting.push({ id, command });
  });
  native.addListener("onWatchState", (next) => setLinkState(next));
  setLinkState(readState());
}

export function setWatchCommandHandler(next: WatchCommandHandler): () => void {
  handler = next;
  for (const entry of waiting.splice(0)) run(entry.id, entry.command);
  return () => {
    if (handler === next) handler = null;
  };
}

export function useWatchInstalled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    () => linkState.paired && linkState.installed,
  );
}

let sent: string | null = null;

export function sendWatchSnapshot(snapshot: WatchSnapshot): void {
  if (!native) return;
  const { generatedAt: _generatedAt, ...content } = snapshot;
  const key = JSON.stringify(content);
  if (key === sent) return;
  sent = key;
  native.updateContext(JSON.stringify(snapshot));
}

export function watchSnapshotText(snapshot: WatchSnapshot): string {
  return JSON.stringify(snapshot);
}

const watchKeys = new Map<string, string>();
const pairedSessions = new Map<string, WatchAccountCredential>();

export function rememberWatchKeys(entries: readonly { serverId: string; watchKey: string }[]): void {
  for (const { serverId, watchKey } of entries) watchKeys.set(serverId, watchKey);
}

export function knownWatchKey(serverId: string): string | undefined {
  return watchKeys.get(serverId);
}

export function rememberWatchSession(credential: WatchAccountCredential, watchSessionId: string): void {
  pairedSessions.set(watchSessionId, { apiUrl: credential.apiUrl, sessionToken: credential.sessionToken });
}

function forgetWatchSessions() {
  watchKeys.clear();
  const paired = [...pairedSessions];
  pairedSessions.clear();
  for (const [watchSessionId, credential] of paired) {
    void revokeWatchSession(credential, watchSessionId).catch(() => undefined);
  }
}

export function resetWatch(): void {
  forgetWatchSessions();
  if (!native) return;
  handler = null;
  for (const entry of waiting.splice(0)) reply(entry.id, { ok: false, error: "failed", message: "" });
  sent = null;
  native.updateContext(
    JSON.stringify({
      version: WATCH_PROTOCOL_VERSION,
      state: "signedOut",
      generatedAt: Date.now(),
    } satisfies WatchSnapshot),
  );
}
