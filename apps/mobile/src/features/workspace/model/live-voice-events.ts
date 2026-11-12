import type { LiveVoiceEvent } from "@openbot/contracts/team-protocol/live-voice-v1";

type LiveVoiceListener = (serverId: string, event: LiveVoiceEvent) => void;

const listeners = new Set<LiveVoiceListener>();

/**
 * The GPT live voice events of the hosts. A host sends them only to the member who started the
 * session, so the conversation that started it is the only reader. Nothing keeps them.
 */
export function publishLiveVoiceEvent(serverId: string, event: LiveVoiceEvent): void {
  for (const listener of listeners) listener(serverId, event);
}

/** Calls `listener` with each live voice event until the returned function runs. */
export function subscribeLiveVoiceEvents(listener: LiveVoiceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
