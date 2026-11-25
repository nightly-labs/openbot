import { type NativeModule, requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";

export interface CarPlayAgentItem {
  key: string;
  name: string;
  detail?: string;
  picture?: string;
  unread: boolean;
}

export interface CarPlayHome {
  title: string;
  message?: string;
  pinnedTitle: string;
  newTitle: string;
  agentsTitle: string;
  pinned: CarPlayAgentItem[];
  fresh: CarPlayAgentItem[];
  quiet: CarPlayAgentItem[];
}

export type CarPlayVoiceState = "listening" | "muted" | "thinking" | "speaking" | "offline" | "unavailable";

export type CarPlayVoiceText = Record<CarPlayVoiceState, string>;

export type CarPlayVoiceFrames = Record<CarPlayVoiceState, string[]>;

declare class CarPlayModule extends NativeModule<{
  onCarPlayConnection: (event: { connected: boolean }) => void;
  onCarPlayOpen: (event: { key: string }) => void;
  onCarPlayVoiceEnd: () => void;
  onCarPlayMute: () => void;
}> {
  isConnected(): Promise<boolean>;
  setHome(home: CarPlayHome): Promise<void>;
  showVoice(text: CarPlayVoiceText, state: CarPlayVoiceState, frames: CarPlayVoiceFrames): Promise<void>;
  setVoiceState(state: CarPlayVoiceState): Promise<void>;
  setVoiceFrames(frames: CarPlayVoiceFrames): Promise<void>;
  setVoiceMuted(muted: boolean): Promise<void>;
  hideVoice(): Promise<void>;
}

const native = requireOptionalNativeModule<CarPlayModule>("OpenBotCarPlay");

export const carPlaySupported = native !== null;

let connected = false;
let installed = false;
const connectionListeners = new Set<() => void>();
const openListeners = new Set<(key: string) => void>();
const voiceEndListeners = new Set<() => void>();
const muteListeners = new Set<() => void>();

function setConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const notify of connectionListeners) notify();
}

function report(action: string): (error: unknown) => void {
  return (error) => supportLog.add("warn", "app", `CarPlay ${action} failed: ${supportLogValue(error)}`);
}

export function installCarPlay(): void {
  if (installed || !native) return;
  installed = true;
  native.addListener("onCarPlayConnection", (event) => setConnected(event.connected));
  native.addListener("onCarPlayOpen", (event) => {
    for (const open of openListeners) open(event.key);
  });
  native.addListener("onCarPlayVoiceEnd", () => {
    for (const end of voiceEndListeners) end();
  });
  native.addListener("onCarPlayMute", () => {
    for (const mute of muteListeners) mute();
  });
  native.isConnected().then(setConnected, report("connection check"));
}

function subscribeConnection(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

function connectionSnapshot(): boolean {
  return connected;
}

export function useCarPlayConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, connectionSnapshot, connectionSnapshot);
}

export function onCarPlayOpen(listener: (key: string) => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function onCarPlayVoiceEnd(listener: () => void): () => void {
  voiceEndListeners.add(listener);
  return () => voiceEndListeners.delete(listener);
}

export function onCarPlayMute(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export const carPlay = {
  setHome(home: CarPlayHome): void {
    native?.setHome(home).catch(report("home update"));
  },
  showVoice(text: CarPlayVoiceText, state: CarPlayVoiceState, frames: CarPlayVoiceFrames): void {
    native?.showVoice(text, state, frames).catch(report("voice start"));
  },
  setVoiceState(state: CarPlayVoiceState): void {
    native?.setVoiceState(state).catch(report("voice state"));
  },
  setVoiceFrames(frames: CarPlayVoiceFrames): void {
    native?.setVoiceFrames(frames).catch(report("voice pictures"));
  },
  setVoiceMuted(muted: boolean): void {
    native?.setVoiceMuted(muted).catch(report("voice mute"));
  },
  hideVoice(): void {
    native?.hideVoice().catch(report("voice end"));
  },
};
