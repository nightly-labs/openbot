import type { VoiceServerSettings } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { clearSpokenAudioCache } from "./speech-playback";
import { speechPort } from "./speech-port";

const [server, setServer] = createSignal<VoiceServerSettings | null | undefined>(undefined);
let following = false;

function speechRouteChanged(
  previous: VoiceServerSettings | null | undefined,
  next: VoiceServerSettings | null,
): boolean {
  if (previous === undefined) return false;
  return (
    (previous?.routes.speech === true) !== (next?.routes.speech === true) ||
    previous?.routes.speechModel !== next?.routes.speechModel ||
    previous?.routes.voice !== next?.routes.voice
  );
}

function applyServer(next: VoiceServerSettings | null): void {
  const previous = server();
  setServer(next);
  if (speechRouteChanged(previous, next)) clearSpokenAudioCache();
}

export function voiceServer(): VoiceServerSettings | null | undefined {
  if (!following) {
    following = true;
    const voice = speechPort().voice;
    voice.onServerSettings(applyServer);
    void voice.getServer().then(
      (next) => {
        if (server() === undefined) applyServer(next);
      },
      () => undefined,
    );
  }
  return server();
}
