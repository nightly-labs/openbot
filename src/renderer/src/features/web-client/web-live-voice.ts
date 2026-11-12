import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { startLiveVoice, stopLiveVoice, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import type { CodexLivePort } from "../conversation/stores/codex-live-conversation-store";

const WEB_LIVE_VOICE_STORAGE_KEY = "openbot:web-live-voice";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * Whether voice conversations in this browser use Codex live voice of the connected host. It is off
 * until the user turns it on, as on the desktop, because the voice then goes to OpenAI. Reading
 * `window.localStorage` throws when the browser blocks storage, so it is read inside the guard.
 */
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
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches every open chat at once. */
export function useWebLiveVoice(): () => boolean {
  return webLiveVoice;
}

export function setWebLiveVoice(enabled: boolean): void {
  try {
    window.localStorage.setItem(WEB_LIVE_VOICE_STORAGE_KEY, String(enabled));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = enabled;
  }
  setWebLiveVoiceSignal(enabled);
}

/**
 * Codex live voice with `live-voice-v1` of the connected host. The host's Codex answers the WebRTC
 * offer of this page, so the audio goes from this browser to OpenAI and does not pass the host. The
 * transcript and the end come as `live-voice` events of this member's event connection.
 */
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
