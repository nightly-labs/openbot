import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { startLiveVoice, stopLiveVoice, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import type { CodexLivePort } from "../conversation/stores/codex-live-conversation-store";

const WEB_LIVE_VOICE_STORAGE_KEY = "openbot:web-live-voice";

let unsavedPreference: boolean | undefined;

function readWebLiveVoice(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(WEB_LIVE_VOICE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const [webLiveVoice, setWebLiveVoiceSignal] = createSignal(readWebLiveVoice());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== WEB_LIVE_VOICE_STORAGE_KEY) return;
  setWebLiveVoiceSignal(readWebLiveVoice());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useWebLiveVoice(): () => boolean {
  return webLiveVoice;
}

export function setWebLiveVoice(enabled: boolean): void {
  try {
    window.localStorage.setItem(WEB_LIVE_VOICE_STORAGE_KEY, String(enabled));
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = enabled;
  }
  setWebLiveVoiceSignal(enabled);
}

export function webLiveVoicePort(
  request: () => TeamApiRequest,
  onHostEvent: (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void,
): CodexLivePort {
  return {
    startLive: (input) =>
      runTeamEffect(
        startLiveVoice(request(), { agentId: input.agentId, sdp: input.sdp }).pipe(
          Effect.mapError((error) => error.cause),
        ),
      ),
    stopLive: (input) =>
      runTeamEffect(stopLiveVoice(request(), input.sessionId).pipe(Effect.mapError((error) => error.cause))),
    onLiveEvent: (listener) =>
      onHostEvent((event) => {
        if (event.type !== "live-voice") return;
        listener(
          event.kind === "transcript"
            ? { type: "transcript", sessionId: event.sessionId, role: event.role, text: event.text, final: event.final }
            : { type: "ended", sessionId: event.sessionId, error: event.error },
        );
      }),
  };
}
