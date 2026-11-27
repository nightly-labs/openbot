import type { LiveVoiceEvent } from "@openbot/contracts/team-protocol/live-voice-v1";

type LiveVoiceListener = (serverId: string, event: LiveVoiceEvent) => void;

const listeners = new Set<LiveVoiceListener>();

export function publishLiveVoiceEvent(serverId: string, event: LiveVoiceEvent): void {
  for (const listener of listeners) listener(serverId, event);
}

export function subscribeLiveVoiceEvents(listener: LiveVoiceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
