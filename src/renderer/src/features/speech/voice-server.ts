import type { VoiceServerSettings } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { speechPort } from "./speech-port";

const [server, setServer] = createSignal<VoiceServerSettings | null | undefined>(undefined);
let loaded: Promise<void> | undefined;

function followVoiceServer(): Promise<void> {
  if (!loaded) {
    const voice = speechPort().voice;
    voice.onServerSettings((next) => setServer(next));
    loaded = voice.getServer().then(
      (next) => {
        setServer((current) => (current === undefined ? next : current));
      },
      () => undefined,
    );
  }
  return loaded;
}

export function voiceServer(): VoiceServerSettings | null | undefined {
  void followVoiceServer();
  return server();
}

export function voiceServerLoaded(): Promise<void> {
  return followVoiceServer();
}
